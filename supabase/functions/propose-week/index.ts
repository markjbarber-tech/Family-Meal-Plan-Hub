// Rebuild of MENU_AUTOMATION.md's Job A (weekly proposal) as a Supabase-native equivalent.
// The old job ran externally on a 3-hourly system cron, editing household.json and baking a
// WEEK_DATA constant into index.html, then git-pushing to GitHub Pages -- an architecture the
// Supabase re-platform (see legacy/Code.gs.snapshot and the other 3 edge functions) already
// left behind for every other action. This is its replacement: triggered by pg_cron (see the
// propose_week_daily job), it iterates every household, and for any household where it's
// Saturday in Sydney and a proposal hasn't already gone out today, rolls the current week into
// history and drafts a fresh one.
//
// Unlike the other 3 edge functions, this one was originally built with no signed-in caller to
// forward a JWT from -- pg_cron invokes it, not a browser -- so it authenticates via a shared
// secret (CRON_SECRET) and uses the service_role key internally to read/write across all
// households, bypassing RLS deliberately (the same way a trusted server-side job would).
//
// Onboarding's Completion screen (see index.html) needs to trigger this same generation logic
// for exactly one household -- the caller's own -- synchronously, from the browser, under a
// real user session. Rather than duplicate proposeForHousehold()'s logic in a second function,
// this adds a second auth branch: a valid user JWT is accepted as an alternative to
// CRON_SECRET, using the same RLS-scoped-client pattern as the other 3 functions (forwarded
// Authorization header, auth.getUser() to identify the caller) so it can only ever operate on
// that user's own household -- never a body-supplied household_id, and always forced (no
// Saturday/last_proposed_date gate), since onboarding always wants immediate generation.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = "https://jpofeslziyjbysotycfl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_psBedalpZIlxs5DaGQPf1g_yJ49IdI8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CATEGORY_KEYS = ["produce", "meat_deli", "dairy", "pantry", "frozen", "other"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SLOTS = ["dinner", "lunch", "snack"];

function trimIngredients(list: any[]) {
  if (!list || !list.length) return [];
  return list.map((ing) => ({
    name: String((ing && ing.name) || ""),
    quantity: ing && typeof ing.quantity === "number" ? ing.quantity : null,
    unit: String((ing && ing.unit) || ""),
    category: ing && CATEGORY_KEYS.includes(ing.category) ? ing.category : "other",
    display: String((ing && (ing.display || ing.name)) || ""),
  }));
}

function trimMeal(mealObj: any, mealType: string) {
  const out: any = { name: mealObj.name, ingredients: trimIngredients(mealObj.ingredients) };
  if (mealType === "dinner") {
    out.new_or_repeat = mealObj.new === false ? "repeat" : (mealObj.new_or_repeat || "new");
    out.authored_by = mealObj.authored_by || "";
    out.method = mealObj.method || [];
    out.prep_time = mealObj.prep_time || "";
    out.cook_time = mealObj.cook_time || "";
    if (mealObj.hands_off_time) out.hands_off_time = mealObj.hands_off_time;
    if (mealObj.prep_ahead_note) out.prep_ahead_note = mealObj.prep_ahead_note;
  }
  return out;
}

async function callClaude(systemPrompt: string, userPrompt: string, maxTokens = 8000) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) throw new Error("Anthropic API error: " + (await resp.text()));
  const json = await resp.json();
  let text: string | null = null;
  for (const block of json.content || []) {
    if (block.type === "text") { text = block.text; break; }
  }
  if (text == null) throw new Error("No text block in Anthropic response");
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    // A handful of real failures on regenerate-meal (2026-08-16, same callClaude pattern)
    // showed otherwise fully complete, well-formed JSON cut off missing only the final closing
    // brace, at lengths far short of maxTokens. Retry once with a brace appended before giving
    // up; only masks exactly this one specific, observed defect shape, not JSON errors in general.
    if (!text.endsWith("}")) {
      try { return JSON.parse(text + "}"); } catch { /* fall through to the original error */ }
    }
    throw new Error("Could not parse Claude response as JSON: " + String(e));
  }
}

function computeDishStats(rows: any[]) {
  const stats: Record<string, any> = {};
  rows.forEach((r) => {
    if (r.type !== "meal_feedback" || !r.meal_name) return;
    const key = r.meal_name;
    if (!stats[key]) stats[key] = { yes: 0, mostly: 0, no: 0, total: 0, ratingSum: 0, ratingCount: 0 };
    const s = stats[key];
    if (r.kids_ate_it === "yes") { s.yes++; s.total++; }
    else if (r.kids_ate_it === "mostly") { s.mostly++; s.total++; }
    else if (r.kids_ate_it === "no") { s.no++; s.total++; }
    if (r.parent_rating) { s.ratingSum += Number(r.parent_rating); s.ratingCount++; }
  });
  Object.keys(stats).forEach((key) => {
    const s = stats[key];
    const positive = s.yes + s.mostly;
    s.status = s.total > 0 && positive >= s.total / 2 && positive > s.no ? "proven" : "new";
    s.avg_parent_rating = s.ratingCount ? Math.round((s.ratingSum / s.ratingCount) * 10) / 10 : null;
    delete s.ratingSum;
    delete s.ratingCount;
  });
  return stats;
}

// Sydney-local "today" as a plain Date (midnight UTC on that calendar day) -- every date
// computation below (weekday gate, ISO week id, the new week's Mon-Sun range) is relative to
// this, not the server's UTC clock, since "Saturday" only means anything in the household's
// own timezone.
function sydneyToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00Z`);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

// ISO 8601 week number (Monday-start, week 1 = the week containing the year's first Thursday).
function isoWeekId(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function formatDateRange(monday: Date, sunday: Date): string {
  const fmtShort = (d: Date) => d.toLocaleDateString("en-AU", { timeZone: "UTC", month: "short", day: "numeric" });
  const year = sunday.getUTCFullYear();
  return `${fmtShort(monday)} - ${fmtShort(sunday)}, ${year}`;
}

// Southern-hemisphere seasonal bias, matching MENU_AUTOMATION.md Job A exactly.
function seasonNote(month: number): string {
  if (month === 6 || month === 7 || month === 8) return "It's winter in the Southern Hemisphere -- bias toward hot, warming meals.";
  if (month === 12 || month === 1 || month === 2) return "It's summer in the Southern Hemisphere -- bias toward grilled dishes and salads, lighter meals.";
  return "It's a shoulder season in the Southern Hemisphere -- use judgement on hot vs light meals.";
}

async function proposeForHousehold(supabase: any, household: any, todaySydney: Date, force: boolean) {
  const todayStr = isoDate(todaySydney);
  if (!force) {
    const weekday = todaySydney.getUTCDay(); // 0=Sun ... 6=Sat
    if (weekday !== 6) return { household_id: household.id, status: "skipped", reason: "not Saturday" };
    if (household.last_proposed_date === todayStr) return { household_id: household.id, status: "skipped", reason: "already proposed today" };
  }

  const { data: currentWeeks, error: cwErr } = await supabase
    .from("weeks").select("*").eq("household_id", household.id).eq("is_current", true).limit(1);
  if (cwErr) throw cwErr;
  const outgoingWeek = currentWeeks && currentWeeks[0];

  let outgoingSundayDinner: any = null;
  if (outgoingWeek) {
    const { data: outgoingMeals, error: omErr } = await supabase
      .from("meals").select("*").eq("week_id", outgoingWeek.id);
    if (omErr) throw omErr;
    outgoingSundayDinner = (outgoingMeals || []).find((m: any) => m.day === "Sunday" && m.slot === "dinner" && m.name) || null;
    const recentDinnerNames = (outgoingMeals || []).filter((m: any) => m.slot === "dinner" && m.name).map((m: any) => m.name);
    outgoingWeek._recentDinnerNames = recentDinnerNames;
  }

  const { data: advisorRows, error: aErr } = await supabase.from("board_of_advisors").select("*").eq("household_id", household.id);
  if (aErr) throw aErr;
  const advisors = (advisorRows || []).map((a: any) => ({ name: a.name, philosophy: a.philosophy }));

  const { data: feedbackRows, error: fErr } = await supabase
    .from("feedback").select("meal_name, kids_ate_it, parent_rating").eq("household_id", household.id).eq("type", "meal_feedback");
  if (fErr) throw fErr;
  const dishStats = computeDishStats(feedbackRows || []);
  const dishReputationLines = Object.keys(dishStats).map((name) => {
    const s = dishStats[name];
    return `- "${name}": ${s.status} (yes=${s.yes} mostly=${s.mostly} no=${s.no})` +
      (s.avg_parent_rating != null ? `, avg parent rating ${s.avg_parent_rating}/5` : "");
  });

  const { data: requestedFavourites, error: favErr } = await supabase
    .from("favourites").select("*").eq("household_id", household.id).eq("requested_for_next_week", true);
  if (favErr) throw favErr;

  // Always the *next* Monday, never today even if today happens to be one -- this only ever
  // runs on a real Saturday in production (2 days out), but the force override above can call
  // it on any weekday for a manual run, so the offset has to be generic rather than a fixed +2.
  const weekday = todaySydney.getUTCDay(); // 0=Sun ... 6=Sat
  const daysUntilMonday = ((8 - weekday) % 7) || 7;
  const monday = addDays(todaySydney, daysUntilMonday);
  const sunday = addDays(monday, 6);
  const newWeekId = isoWeekId(monday);
  const dateRange = formatDateRange(monday, sunday);

  const householdInfo = {
    adults: household.adults, kids: household.kids,
    allergies_or_restrictions: household.allergies_or_restrictions,
    key_principles: household.key_principles, likes: household.likes, dislikes: household.dislikes,
    pantry_staples: household.pantry_staples, use_up_this_week: household.use_up_this_week,
  };

  const systemPrompt = "You are the meal-planning board (five personas: Weeknight Realist, Flavor Explorer, " +
    "Veg-Forward Stylist, Child Nutritionist, Family GP/Dietician) drafting a brand-new weekly meal plan for a family, " +
    "from scratch. You must respond with ONLY a single valid JSON object — no markdown fences, no commentary before or after.";

  const userPrompt = "Household info:\n" + JSON.stringify(householdInfo, null, 2) +
    "\n\nBoard of advisors (credit dinners to these personas):\n" + JSON.stringify(advisors, null, 2) +
    `\n\nDraft a brand-new 7-day plan (week_id: ${newWeekId}, date_range: ${dateRange}, Monday through Sunday).` +
    "\n\n" + seasonNote(monday.getUTCMonth() + 1) +
    (requestedFavourites && requestedFavourites.length
      ? "\n\nThe family has requested these saved favourites be included this week — each one MUST appear verbatim " +
        "(exact name, authored_by, and recipe content — do not rewrite or reinterpret the dish) as a dinner on some day this week. " +
        "Convert each favourite's ingredient list (plain prose lines) into the required structured ingredients array without changing " +
        'quantities or wording. Fit as many as sensibly possible across the 7 days if there\'s more than one:\n' +
        JSON.stringify(requestedFavourites.map((f: any) => ({ name: f.name, authored_by: f.authored_by, recipe: f.recipe })), null, 2)
      : "") +
    (dishReputationLines.length
      ? '\n\nHistorical dish feedback (from every "Log" submission ever made, any week) — prefer repeating a "proven" dish over a ' +
        'fresh idea when it fits (don\'t be shy about a repeat just because it was used recently, but also don\'t repeat the same ' +
        'dinner every single week — use judgement on spacing), and avoid reintroducing a poorly-received ("new" status with mostly ' +
        '"no") dish in the same format — if the underlying ingredient/concept is still worth persisting with, consider a meaningfully ' +
        "different format instead of the exact dish that flopped:\n" + dishReputationLines.join("\n")
      : "") +
    (outgoingWeek && outgoingWeek._recentDinnerNames && outgoingWeek._recentDinnerNames.length
      ? "\n\nDinners already served last week (avoid repeating any of these so soon): " + outgoingWeek._recentDinnerNames.join(", ")
      : "") +
    (outgoingSundayDinner
      ? `\n\nLast week's Sunday dinner was "${outgoingSundayDinner.name}" — Monday's lunch this week may draw on it as leftovers if that fits the leftover-lunch rule below.`
      : "") +
    "\n\nKeep the leftover-lunch day-after rule (Tuesday's lunch uses Monday's dinner leftovers, etc. — Monday's lunch can draw on " +
    "last week's Sunday dinner leftovers per the note above if given). Original board-authored recipes for every other dinner " +
    "(besides any requested favourites above), credited to advisor personas — no external recipe links. Respect all stated " +
    "allergies/dislikes. " +
    'Give every present meal a structured "ingredients" array: [{"name":"...","quantity":<number>,"unit":"...",' +
    '"category":"produce|meat_deli|dairy|pantry|frozen|other","display":"natural prose form, e.g. \'2 cloves garlic, minced\'"}] ' +
    '— leftover-based lunches/snacks get "ingredients": []. Dinners also get a "method" array of prose steps. ' +
    "Every ingredient named or implied anywhere in the method must appear in the ingredients array for that dinner, with a real " +
    "quantity — nothing introduced mid-method that was not listed upfront, and no vague amounts. If a dinner needs a componentized " +
    "or prep-ahead ingredient (something that itself needs advance prep, like cold cooked rice for a fried rice dish), give it its " +
    "own early method step with explicit day-before timing rather than assuming it is ready to use, and set the prep_ahead_note " +
    "field on that dinner to a short instruction describing that step (omit the field entirely when there is no such step). " +
    'Give every dinner prep_time and cook_time as separate figures (e.g. "15 min"), plus hands_off_time only for a genuine passive ' +
    "period like marinating or resting (omit it, not an empty string, when there is not one). Respond with this exact JSON shape " +
    "(all 7 days, and do not include a shopping_list — it is computed separately):\n" +
    "{\n" +
    '  "days": [ { "day": "Monday", "dinner": {"name": "...", "new": true, "authored_by": "...", "ingredients": [...], "method": ["..."], "prep_time": "...", "cook_time": "...", "hands_off_time": "... (omit if none)", "prep_ahead_note": "... (omit if none)"}, "lunch": {"name": "...", "ingredients": [...]}, "snack": {"name": "...", "ingredients": [...]} }, ... ],\n' +
    '  "board_note": "one or two sentences on what this week is and why (mention any included favourites)"\n' +
    "}";

  // Drafting all 7 days from scratch (21 meal slots, each with full ingredients/method/timing)
  // is the largest payload of any of these functions -- the 8000-token default that's enough
  // for regenerate-now's partial revisions truncates here, and even 16000 wasn't always enough
  // for a fully verbose week (a real onboarding test truncated past 16000 -- see commit
  // history), so this has real headroom rather than a value tuned to just barely fit.
  const plan = await callClaude(systemPrompt, userPrompt, 24000);
  if (!plan || !plan.days || !Array.isArray(plan.days) || plan.days.length !== 7) {
    return { household_id: household.id, status: "error", message: "The board did not return a usable plan." };
  }

  if (outgoingWeek) {
    const { error: rolloverErr } = await supabase.from("weeks").update({ is_current: false }).eq("id", outgoingWeek.id);
    if (rolloverErr) throw rolloverErr;
  }

  const { data: newWeekRows, error: nwErr } = await supabase.from("weeks").insert({
    household_id: household.id, week_id: newWeekId, date_range: dateRange, is_current: true,
    pantry_ingredients: [], budget_saver_mode: false, board_notes: plan.board_note || "New week proposed.",
  }).select();
  if (nwErr) throw nwErr;
  const newWeek = newWeekRows[0];

  const mealRows: any[] = [];
  DAY_NAMES.forEach((day) => {
    const d = plan.days.find((x: any) => x.day === day) || {};
    SLOTS.forEach((slot) => {
      const info = d[slot];
      if (!info) {
        mealRows.push({
          week_id: newWeek.id, day, slot, name: null, ingredients: [], method: null, source: null,
          new_or_repeat: null, authored_by: null, prep_time: null, cook_time: null, hands_off_time: null, prep_ahead_note: null,
        });
        return;
      }
      const trimmed = trimMeal(info, slot);
      mealRows.push({
        week_id: newWeek.id, day, slot,
        name: trimmed.name, ingredients: trimmed.ingredients,
        method: trimmed.method || null, source: null,
        new_or_repeat: trimmed.new_or_repeat || null, authored_by: trimmed.authored_by || null,
        prep_time: trimmed.prep_time || null, cook_time: trimmed.cook_time || null,
        hands_off_time: trimmed.hands_off_time || null, prep_ahead_note: trimmed.prep_ahead_note || null,
      });
    });
  });
  const { error: mealsErr } = await supabase.from("meals").insert(mealRows);
  if (mealsErr) throw mealsErr;

  if (requestedFavourites && requestedFavourites.length) {
    const { error: favUpdateErr } = await supabase.from("favourites")
      .update({ requested_for_next_week: false })
      .in("id", requestedFavourites.map((f: any) => f.id));
    if (favUpdateErr) throw favUpdateErr;
  }

  const { error: hhErr } = await supabase.from("households").update({ last_proposed_date: todayStr }).eq("id", household.id);
  if (hhErr) throw hhErr;

  return { household_id: household.id, status: "ok", week_id: newWeekId, date_range: dateRange };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCronCall = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

    let body: any = {};
    try { body = await req.json(); } catch { /* no body (plain pg_cron call) */ }

    if (isCronCall) {
      const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      // household_id/force are an operator override (still behind CRON_SECRET, not a public
      // surface) for triggering a specific household's proposal on demand -- outside the
      // Saturday/last_proposed_date gate -- rather than only on the daily schedule. Useful both
      // for manual runs and for testing the gate logic itself.
      let householdsQuery = supabase.from("households").select("*");
      if (body.household_id) householdsQuery = householdsQuery.eq("id", body.household_id);
      const { data: households, error: hErr } = await householdsQuery;
      if (hErr) throw hErr;

      const todaySydney = sydneyToday();
      const results = [];
      for (const household of households || []) {
        try {
          results.push(await proposeForHousehold(supabase, household, todaySydney, !!body.force));
        } catch (e) {
          results.push({ household_id: household.id, status: "error", message: (e as Error).message });
        }
      }
      return jsonResponse({ status: "ok", results });
    }

    // Not a cron call -- try it as a real signed-in user (onboarding's Completion screen).
    // RLS-scoped client on the forwarded JWT, same pattern as the other 3 edge functions --
    // this can only ever see/write the caller's own household, so body.household_id is never
    // consulted here at all, not just ignored.
    if (!authHeader) return jsonResponse({ status: "error", message: "Unauthorized" }, 401);
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ status: "error", message: "Unauthorized" }, 401);

    const { data: households, error: hErr } = await supabase.from("households").select("*").limit(1);
    if (hErr) throw hErr;
    const household = households && households[0];
    if (!household) return jsonResponse({ status: "error", message: "No household found" }, 404);

    const todaySydney = sydneyToday();
    const result = await proposeForHousehold(supabase, household, todaySydney, true);
    return jsonResponse({ status: "ok", results: [result] });
  } catch (e) {
    return jsonResponse({ status: "error", message: (e as Error).message }, 500);
  }
});
