// Ported from Code.gs's generateSingleMeal()/regenerateMealSlot() (legacy/Code.gs.snapshot) --
// faithful port of the prompt text, not a rewrite. Generates one replacement meal for a single
// day/slot and writes it directly into the `meals` table (RLS-scoped to the caller's own
// household via their forwarded JWT -- no service_role key used here).
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

// Mirrors Code.gs's trimMeal() -- output shape for a dinner (this function is dinner/lunch/snack
// aware since callers only ever regenerate one slot at a time).
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
    // A handful of real failures (2026-08-16) showed otherwise fully complete, well-formed JSON
    // -- every field present, correctly quoted and comma-separated -- cut off missing only the
    // final closing brace, at lengths far short of maxTokens (so not a token-budget truncation).
    // Retry once with a brace appended before giving up; only masks exactly this one specific,
    // observed defect shape, not JSON errors in general.
    if (!text.endsWith("}")) {
      try { return JSON.parse(text + "}"); } catch { /* fall through to the original error */ }
    }
    throw new Error("Could not parse Claude response as JSON: " + String(e));
  }
}

// Mirrors Code.gs's getDishFeedbackStats(): proven requires at least half the recorded
// reactions to be yes/mostly, and more positives than nos.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ status: "error", message: "Missing Authorization header" }, 401);

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return jsonResponse({ status: "error", message: "Unauthorized" }, 401);
    const householdId = user.id;

    const { day, meal } = await req.json();
    if (!day || !meal) return jsonResponse({ status: "error", message: "Missing day or meal" }, 400);

    const { data: households, error: hErr } = await supabaseClient.from("households").select("*").limit(1);
    if (hErr) throw hErr;
    const household = households && households[0];
    if (!household) return jsonResponse({ status: "error", message: "No household found" }, 404);

    const { data: advisorRows, error: aErr } = await supabaseClient.from("board_of_advisors").select("*");
    if (aErr) throw aErr;
    // Only {name, philosophy} -- matches the original prompt's shape exactly. Passing the extra
    // persona_key/is_customizable columns confused the model into using persona_key for
    // "authored_by" attribution instead of the human-readable name.
    const advisors = (advisorRows || []).map((a: any) => ({ name: a.name, philosophy: a.philosophy }));

    const { data: weeks, error: wErr } = await supabaseClient.from("weeks").select("*").eq("is_current", true).limit(1);
    if (wErr) throw wErr;
    const week = weeks && weeks[0];
    if (!week) return jsonResponse({ status: "error", message: "No current week found" }, 404);

    const { data: meals, error: mErr } = await supabaseClient.from("meals").select("*").eq("week_id", week.id);
    if (mErr) throw mErr;

    const excludeMeal = (meals || []).find((m: any) => m.day === day && m.slot === meal);
    const excludeName = excludeMeal ? excludeMeal.name : null;
    const otherMealNames = (meals || [])
      .filter((m: any) => m.name && !(m.day === day && m.slot === meal))
      .map((m: any) => m.name);

    const { data: feedbackRows, error: fErr } = await supabaseClient
      .from("feedback").select("meal_name, kids_ate_it, parent_rating").eq("household_id", householdId).eq("type", "meal_feedback");
    if (fErr) throw fErr;
    const dishStats = computeDishStats(feedbackRows || []);
    const dishReputationLines = Object.keys(dishStats).map((name) => {
      const s = dishStats[name];
      return `- "${name}": ${s.status} (yes=${s.yes} mostly=${s.mostly} no=${s.no})` +
        (s.avg_parent_rating != null ? `, avg parent rating ${s.avg_parent_rating}/5` : "");
    });

    const householdInfo = {
      adults: household.adults, kids: household.kids,
      allergies_or_restrictions: household.allergies_or_restrictions,
      key_principles: household.key_principles, likes: household.likes, dislikes: household.dislikes,
      pantry_staples: household.pantry_staples, use_up_this_week: household.use_up_this_week,
    };

    const systemPrompt = "You are the meal-planning board (five personas: Weeknight Realist, Flavor Explorer, " +
      "Veg-Forward Stylist, Child Nutritionist, Family GP/Dietician) generating a single replacement " + meal +
      " for one day of a family's weekly meal plan. " +
      "You must respond with ONLY a single valid JSON object — no markdown fences, no commentary before or after.";

    const userPrompt = "Household info:\n" + JSON.stringify(householdInfo, null, 2) +
      "\n\nBoard of advisors (credit dinners to these personas):\n" + JSON.stringify(advisors, null, 2) +
      "\n\nGenerate a " + meal + " for " + day + "." +
      (excludeName ? ` Do not suggest "${excludeName}" again — it was just removed from this slot.` : "") +
      (otherMealNames.length ? "\n\nOther meals already in this week (avoid repeating any of these): " + otherMealNames.join(", ") : "") +
      (dishReputationLines.length ? '\n\nHistorical dish feedback (from every "Log" submission ever made, any week) — prefer repeating a "proven" dish over a fresh idea when it fits, and avoid reintroducing a poorly-received ("new" status with mostly "no") dish in the same format:\n' + dishReputationLines.join("\n") : "") +
      (week.pantry_ingredients && week.pantry_ingredients.length ? "\n\nPrioritise building this meal around these pantry ingredients the family wants used: " +
        week.pantry_ingredients.join(", ") + ". If any conflicts with a stated allergy/dislike, don't force it in — mention the conflict in your board_note instead." : "") +
      (week.budget_saver_mode ? "\n\nBudget Saver Mode is on — if realistic, chain this meal's base off another meal already in the week to shrink the week's shopping list." : "") +
      (meal === "dinner" ? '\n\nEvery ingredient named or implied anywhere in the method must appear in the ingredients array with a real quantity — nothing introduced mid-method that was not listed upfront, and no vague amounts. If this dinner needs a componentized or prep-ahead ingredient (something that itself needs advance prep, like cold cooked rice for a fried rice dish), give it its own early method step with explicit day-before timing rather than assuming it is ready to use, and set prep_ahead_note to a short instruction describing that step (omit the field entirely when there is no such step). Give prep_time and cook_time as separate figures (e.g. "15 min"), plus hands_off_time only for a genuine passive period like marinating or resting (omit it, not an empty string, when there is not one).' : "") +
      "\n\nRespond with this exact JSON shape" + (meal === "dinner"
        ? ':\n{"name": "...", "new": true, "authored_by": "...", "ingredients": [{"name":"...","quantity":<number>,"unit":"...","category":"produce|meat_deli|dairy|pantry|frozen|other","display":"..."}], "method": ["...", "..."], "prep_time": "...", "cook_time": "...", "hands_off_time": "... (omit if none)", "prep_ahead_note": "... (omit if none)","board_note": "one sentence on what this is and why"}'
        : ' (no method or authored_by needed for lunch/snack):\n{"name": "...", "ingredients": [{"name":"...","quantity":<number>,"unit":"...","category":"produce|meat_deli|dairy|pantry|frozen|other","display":"..."}], "board_note": "one sentence on what this is and why"}');

    // 2000 (original Code.gs budget) then 3000 both proved too tight -- a live failure on
    // 2026-08-16 captured the raw response mid-truncation: every field was fully written
    // (17 ingredients, 7 method steps, board_note) and the response was cut off missing only
    // the final closing brace, meaning 3000 just barely wasn't enough for a verbose-but-normal
    // dinner. Real headroom this time rather than another value tuned to just barely fit.
    const result = await callClaude(systemPrompt, userPrompt, 6000);
    if (!result || !result.name || !result.ingredients) {
      return jsonResponse({ status: "error", message: "The board did not return a usable meal — try again." }, 502);
    }
    const trimmed = trimMeal(result, meal);
    const boardNote = result.board_note || "";

    const upsertRow: any = {
      week_id: week.id, day, slot: meal,
      name: trimmed.name, ingredients: trimmed.ingredients,
      method: trimmed.method || null, source: null,
      new_or_repeat: trimmed.new_or_repeat || null, authored_by: trimmed.authored_by || null,
      prep_time: trimmed.prep_time || null, cook_time: trimmed.cook_time || null,
      hands_off_time: trimmed.hands_off_time || null, prep_ahead_note: trimmed.prep_ahead_note || null,
    };
    const { error: upsertErr } = await supabaseClient.from("meals").upsert(upsertRow, { onConflict: "week_id,day,slot" });
    if (upsertErr) throw upsertErr;

    const today = new Date().toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", month: "short", day: "numeric" });
    const newBoardNotes = (week.board_notes || "") +
      ` UPDATE (${today}): Added a new ${meal} for ${day} (${trimmed.name})` + (boardNote ? ` — ${boardNote}` : "") + ".";
    const { error: notesErr } = await supabaseClient.from("weeks").update({ board_notes: newBoardNotes }).eq("id", week.id);
    if (notesErr) throw notesErr;

    return jsonResponse({ status: "ok", meal: trimmed });
  } catch (e) {
    return jsonResponse({ status: "error", message: e.message }, 500);
  }
});
