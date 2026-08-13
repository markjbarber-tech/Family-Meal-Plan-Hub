#!/usr/bin/env python3
import json
import os
import sys
import urllib.request

REPO = "/Users/Mark/Family-Meal-Plan-Hub"


def load_env():
    env = {}
    with open(os.path.join(REPO, ".env")) as f:
        for line in f:
            line = line.strip()
            if not line or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v
    return env


def get(base_url, service_key, path):
    req = urllib.request.Request(f"{base_url}/rest/v1/{path}")
    req.add_header("apikey", service_key)
    req.add_header("Authorization", f"Bearer {service_key}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def main():
    household_id = sys.argv[1]
    env = load_env()
    base_url = env["SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    with open(os.path.join(REPO, "household.json")) as f:
        original = json.load(f)

    households = get(base_url, key, f"households?id=eq.{household_id}")
    assert len(households) == 1, f"expected 1 household row, got {len(households)}"
    h = households[0]

    orig_h = original["household"]
    checks = [
        ("adults", h["adults"] == orig_h["adults"]),
        ("kids", h["kids"] == orig_h["kids"]),
        ("allergies_or_restrictions", h["allergies_or_restrictions"] == orig_h["allergies_or_restrictions"]),
        ("key_principles", h["key_principles"] == orig_h["key_principles"]),
        ("likes", h["likes"] == orig_h["likes"]),
        ("dislikes", h["dislikes"] == orig_h["dislikes"]),
        ("pantry_staples", h["pantry_staples"] == orig_h["pantry_staples"]),
        ("use_up_this_week", h["use_up_this_week"] == orig_h["use_up_this_week"]),
        ("last_board_review_date", h["last_board_review_date"] == original["last_board_review_date"]),
        ("last_proposed_date", h["last_proposed_date"] == original["last_proposed_date"]),
        ("onboarding_completed_at set", h["onboarding_completed_at"] is not None),
    ]

    boa = get(base_url, key, f"board_of_advisors?household_id=eq.{household_id}&order=persona_key")
    boa_names = sorted(a["name"] for a in boa)
    orig_boa_names = sorted(a["name"] for a in original["board_of_advisors"])
    checks.append(("board_of_advisors count", len(boa) == 5))
    checks.append(("board_of_advisors names match", boa_names == orig_boa_names))
    for a in boa:
        orig = next(o for o in original["board_of_advisors"] if o["name"] == a["name"])
        checks.append((f"  philosophy: {a['name']}", a["philosophy"] == orig["philosophy"]))
    fixed = {a["name"] for a in boa if not a["is_customizable"]}
    checks.append(("3 fixed personas", fixed == {"The Weeknight Realist", "The Child Nutritionist", "The Family GP / Dietician"}))

    favs = get(base_url, key, f"favourites?household_id=eq.{household_id}")
    checks.append(("favourites count", len(favs) == len(original["favourites"])))
    for f in favs:
        orig = next(o for o in original["favourites"] if o["name"] == f["name"])
        checks.append((f"  favourite recipe: {f['name']}", f["recipe"] == orig["recipe"]))
        checks.append((f"  favourite requested_for_next_week: {f['name']}", f["requested_for_next_week"] == orig["requested_for_next_week"]))

    weeks = get(base_url, key, f"weeks?household_id=eq.{household_id}")
    checks.append(("weeks count", len(weeks) == 1))
    w = weeks[0]
    cw = original["current_week"]
    checks.append(("week_id", w["week_id"] == cw["week_id"]))
    checks.append(("date_range", w["date_range"] == cw["date_range"]))
    checks.append(("budget_saver_mode", w["budget_saver_mode"] == cw["budget_saver_mode"]))
    checks.append(("board_notes", w["board_notes"] == cw["board_notes"]))
    checks.append(("is_current", w["is_current"] is True))

    meals = get(base_url, key, f"meals?week_id=eq.{w['id']}")
    expected_meal_count = sum(1 for d in cw["days"] for slot in ("dinner", "lunch", "snack") if d.get(slot))
    checks.append(("meals count", len(meals) == expected_meal_count))
    mismatches = []
    for d in cw["days"]:
        for slot in ("dinner", "lunch", "snack"):
            info = d.get(slot)
            if not info:
                continue
            m = next((x for x in meals if x["day"] == d["day"] and x["slot"] == slot), None)
            if m is None:
                mismatches.append(f"{d['day']}/{slot}: missing")
                continue
            if m["name"] != info["name"]:
                mismatches.append(f"{d['day']}/{slot}: name mismatch")
            if m["ingredients"] != info.get("ingredients", []):
                mismatches.append(f"{d['day']}/{slot}: ingredients mismatch")
            if m.get("method") != info.get("method"):
                mismatches.append(f"{d['day']}/{slot}: method mismatch")
    checks.append(("all meal rows match household.json", len(mismatches) == 0))
    if mismatches:
        for mm in mismatches:
            print("MISMATCH:", mm)

    feedback = get(base_url, key, f"feedback?household_id=eq.{household_id}")
    checks.append(("feedback rows present", len(feedback) == 11))

    print()
    all_ok = True
    for name, ok in checks:
        status = "OK" if ok else "FAIL"
        if not ok:
            all_ok = False
        print(f"[{status}] {name}")
    print()
    print("ALL CHECKS PASSED" if all_ok else "SOME CHECKS FAILED")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
