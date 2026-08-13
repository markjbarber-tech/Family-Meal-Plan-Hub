#!/usr/bin/env python3
"""One-off migration: household.json + feedback_export.json -> Supabase.

Run once. Reads credentials from .env in the repo root, and the household
UID is passed as a CLI arg (the real auth.users id created via normal
sign-up in the live app -- this script never creates accounts or handles
passwords, it only populates application data for an account that already
exists).
"""
import json
import os
import sys
import urllib.request
import urllib.error

REPO = "/Users/Mark/Family-Meal-Plan-Hub"


def load_env():
    env = {}
    with open(os.path.join(REPO, ".env")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v
    return env


def rest_call(base_url, service_key, method, path, body=None, prefer=None):
    url = f"{base_url}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", service_key)
    req.add_header("Authorization", f"Bearer {service_key}")
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on {method} {path}: {e.read().decode()}", file=sys.stderr)
        raise


def main():
    if len(sys.argv) != 2:
        print("usage: migrate_household.py <household_uid>", file=sys.stderr)
        sys.exit(1)
    household_id = sys.argv[1]

    env = load_env()
    base_url = env["SUPABASE_URL"]
    service_key = env["SUPABASE_SERVICE_ROLE_KEY"]

    with open(os.path.join(REPO, "household.json")) as f:
        hh = json.load(f)

    with open("/Users/Mark/.claude/jobs/64a201f9/tmp/feedback_export.json") as f:
        feedback_raw = json.load(f)["rows"]

    h = hh["household"]

    # 1. households row
    rest_call(base_url, service_key, "POST", "households", {
        "id": household_id,
        "household_name": "The Barber Household",
        "adults": h["adults"],
        "kids": h["kids"],
        "allergies_or_restrictions": h["allergies_or_restrictions"],
        "key_principles": h["key_principles"],
        "likes": h["likes"],
        "dislikes": h["dislikes"],
        "pantry_staples": h["pantry_staples"],
        "use_up_this_week": h["use_up_this_week"],
        "last_board_review_date": hh["last_board_review_date"],
        "last_proposed_date": hh["last_proposed_date"],
    }, prefer="return=minimal")
    print("households: inserted")

    # Set onboarding_completed_at separately via PATCH (now() needs to be a
    # real timestamp, not a literal string, so use postgres 'now()' via a
    # raw SQL-style header trick isn't available over PostgREST -- just send
    # an ISO timestamp computed client-side instead.)
    import datetime
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rest_call(base_url, service_key, "PATCH", f"households?id=eq.{household_id}",
              {"onboarding_completed_at": now_iso}, prefer="return=minimal")
    print("households: onboarding_completed_at set")

    # 2. board_of_advisors
    persona_key_map = {
        "The Weeknight Realist": "weeknight_realist",
        "The Flavor Explorer": "flavor_explorer",
        "The Veg-Forward Stylist": "veg_forward_stylist",
        "The Child Nutritionist": "child_nutritionist",
        "The Family GP / Dietician": "family_gp",
    }
    customizable = {"flavor_explorer", "veg_forward_stylist"}
    boa_rows = []
    for advisor in hh["board_of_advisors"]:
        pkey = persona_key_map[advisor["name"]]
        boa_rows.append({
            "household_id": household_id,
            "persona_key": pkey,
            "name": advisor["name"],
            "philosophy": advisor["philosophy"],
            "is_customizable": pkey in customizable,
        })
    rest_call(base_url, service_key, "POST", "board_of_advisors", boa_rows, prefer="return=minimal")
    print(f"board_of_advisors: inserted {len(boa_rows)} rows")

    # 3. favourites
    fav_rows = []
    for fav in hh["favourites"]:
        fav_rows.append({
            "household_id": household_id,
            "name": fav["name"],
            "authored_by": fav.get("authored_by"),
            "recipe": fav["recipe"],
            "saved_at": fav["saved_at"],
            "requested_for_next_week": fav["requested_for_next_week"],
        })
    rest_call(base_url, service_key, "POST", "favourites", fav_rows, prefer="return=minimal")
    print(f"favourites: inserted {len(fav_rows)} rows")

    # 4. weeks (1 row) -- need the generated id back for meals
    cw = hh["current_week"]
    week_result = rest_call(base_url, service_key, "POST", "weeks", {
        "household_id": household_id,
        "week_id": cw["week_id"],
        "date_range": cw["date_range"],
        "pantry_ingredients": cw["pantry_ingredients"],
        "budget_saver_mode": cw["budget_saver_mode"],
        "board_notes": cw["board_notes"],
        "is_current": True,
    }, prefer="return=representation")
    week_row_id = week_result[0]["id"]
    print(f"weeks: inserted, id={week_row_id}")

    # 5. meals -- unpack days[] into day x slot rows
    meal_rows = []
    for day in cw["days"]:
        day_name = day["day"]
        for slot in ("dinner", "lunch", "snack"):
            info = day.get(slot)
            if not info:
                continue
            meal_rows.append({
                "week_id": week_row_id,
                "day": day_name,
                "slot": slot,
                "name": info.get("name"),
                "ingredients": info.get("ingredients", []),
                "method": info.get("method"),
                "source": info.get("source"),
                "new_or_repeat": info.get("new_or_repeat"),
                "authored_by": info.get("authored_by"),
                "prep_time": info.get("prep_time"),
                "cook_time": info.get("cook_time"),
                "hands_off_time": info.get("hands_off_time"),
                "prep_ahead_note": info.get("prep_ahead_note"),
            })
    rest_call(base_url, service_key, "POST", "meals", meal_rows, prefer="return=minimal")
    print(f"meals: inserted {len(meal_rows)} rows")

    # 6. feedback -- only real history rows (meal_feedback / review_feedback /
    # principles_update), excluding test/diagnostic rows from earlier
    # verification work this session.
    keep_types = {"meal_feedback", "review_feedback", "principles_update"}
    fb_rows = []
    for r in feedback_raw:
        if r["type"] not in keep_types:
            continue
        if str(r.get("week_id", "")).startswith("test-diagnostic"):
            continue
        fb_rows.append({
            "household_id": household_id,
            "type": r["type"],
            "week_id": r.get("week_id") or None,
            "day": r.get("day") or None,
            "meal": r.get("meal") or None,
            "meal_name": r.get("meal_name") or None,
            "kids_ate_it": r.get("kids_ate_it") or None,
            "parent_rating": int(r["parent_rating"]) if r.get("parent_rating") not in (None, "") else None,
            "note": r.get("note") or None,
            "plan_feedback": r.get("plan_feedback") or None,
            "use_up_ingredients": r.get("use_up_ingredients") or None,
            "pantry_ingredients": r.get("pantry_ingredients") or None,
            "budget_saver_mode": (r.get("budget_saver_mode") if r.get("budget_saver_mode") in (True, False) else None),
            "source_url": r.get("source_url") or None,
            "ingredients_json": r.get("ingredients_json") or None,
            "created_at": r["timestamp"],
        })
    rest_call(base_url, service_key, "POST", "feedback", fb_rows, prefer="return=minimal")
    print(f"feedback: inserted {len(fb_rows)} rows (of {len(feedback_raw)} raw rows, filtered to history-relevant types)")

    print("\nMigration complete.")


if __name__ == "__main__":
    main()
