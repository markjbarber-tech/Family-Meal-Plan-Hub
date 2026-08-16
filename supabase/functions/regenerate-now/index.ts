// Ported from Code.gs's regenerateMealPlan() (legacy/Code.gs.snapshot) -- faithful port of the
// prompt text, not a rewrite. Revises the current week based on new review_feedback and
// principles_update rows logged since the plan was generated, then writes the result directly
// into `meals`/`weeks` (RLS-scoped to the caller's own household via their forwarded JWT).
//
// The old watermark (`.menu-state.json` on GitHub, tracking "already processed this feedback
// row") is replaced by a simpler check: any review_feedback/principles_update row created after
// weeks.created_at is "new" relative to the current plan -- no separate watermark storage needed.
// key_principles is also no longer re-derived from a feedback row's free text here, since
// principles edits already write straight to households.key_principles when saved (see
// index.html's Settings save handler) -- this function just reads the already-current value.
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

// Mirrors Code.gs's trimMeal() exactly, including the external-recipe passthrough branch --
// the AI is told to leave source-linked dinners as-is or replace them outright, never invent a
// method for one, so an unchanged one round-trips through with its `source` field intact.
function trimMeal(mealObj: any, mealType: string) {
  const out: any = { name: mealObj.name, ingredients: trimIngredients(mealObj.ingredients) };
  if (mealType === "dinner") {
    if (mealObj.source && mealObj.source.type === "external_url") {
      out.source = { type: "external_url", url: mealObj.source.url };
    } else {
      out.new_or_repeat = mealObj.new === false ? "repeat" : (mealObj.new_or_repeat || "new");
      out.authored_by = mealObj.authored_by || "";
      out.method = mealObj.method || [];
      out.prep_time = mealObj.prep_time || "";
      out.cook_time = mealObj.cook_time || "";
      if (mealObj.hands_off_time) out.hands_off_time = mealObj.hands_off_time;
      if (mealObj.prep_ahead_note) out.prep_ahead_note = mealObj.prep_ahead_note;
    }
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

    const { data: mealRows, error: mErr } = await supabaseClient.from("meals").select("*").eq("week_id", week.id);
    if (mErr) throw mErr;

    // Reconstruct the currentWeek.days[] shape the original prompt embeds verbatim.
    const days = DAY_NAMES.map((day) => {
      const dayObj: any = { day };
      SLOTS.forEach((slot) => {
        const m = (mealRows || []).find((x: any) => x.day === day && x.slot === slot);
        if (!m || !m.name) { dayObj[slot] = null; return; }
        const info: any = { name: m.name, ingredients: m.ingredients || [] };
        if (m.source) info.source = m.source;
        else {
          if (m.method) info.method = m.method;
          if (m.new_or_repeat) info.new_or_repeat = m.new_or_repeat;
          if (m.authored_by) info.authored_by = m.authored_by;
          if (m.prep_time) info.prep_time = m.prep_time;
          if (m.cook_time) info.cook_time = m.cook_time;
          if (m.hands_off_time) info.hands_off_time = m.hands_off_time;
          if (m.prep_ahead_note) info.prep_ahead_note = m.prep_ahead_note;
        }
        dayObj[slot] = info;
      });
      return dayObj;
    });
    const currentWeek = {
      week_id: week.week_id, date_range: week.date_range,
      pantry_ingredients: week.pantry_ingredients || [], budget_saver_mode: !!week.budget_saver_mode,
      board_notes: week.board_notes, days,
    };

    // "New since this plan was generated" -- replaces the old GitHub-file watermark.
    const { data: newFeedback, error: fErr } = await supabaseClient
      .from("feedback").select("*").eq("household_id", householdId)
      .in("type", ["review_feedback", "principles_update"]).gt("created_at", week.last_regenerated_at)
      .order("created_at", { ascending: true });
    if (fErr) throw fErr;

    const newReviewFeedback = (newFeedback || []).filter((r: any) => r.type === "review_feedback" && r.week_id === week.week_id);
    const newPrinciplesUpdates = (newFeedback || []).filter((r: any) => r.type === "principles_update");
    // Refresh plan always regenerates now, whether or not anything new was logged -- clicking it
    // with no pending feedback means "give me a fresh alternative take on this week," not "do
    // nothing." Whether there's real feedback to incorporate still matters for which instruction
    // paragraph goes into the prompt below (revise-around-feedback vs. free-variety-swap).
    const hasNewFeedback = !!(newReviewFeedback.length || newPrinciplesUpdates.length);

    if (newReviewFeedback.length) {
      const latestReview = newReviewFeedback[newReviewFeedback.length - 1];
      if (typeof latestReview.pantry_ingredients === "string") {
        currentWeek.pantry_ingredients = latestReview.pantry_ingredients.split(",").map((s: string) => s.trim()).filter(Boolean);
      }
      if (typeof latestReview.budget_saver_mode === "boolean") {
        currentWeek.budget_saver_mode = latestReview.budget_saver_mode;
      }
    }

    const combinedFeedback = newReviewFeedback.map((r: any) => r.plan_feedback || "").join("\n");

    const { data: feedbackRows, error: dfErr } = await supabaseClient
      .from("feedback").select("meal_name, kids_ate_it, parent_rating").eq("household_id", householdId).eq("type", "meal_feedback");
    if (dfErr) throw dfErr;
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
      "Veg-Forward Stylist, Child Nutritionist, Family GP/Dietician) revising a family's current weekly meal plan. " +
      "You must respond with ONLY a single valid JSON object — no markdown fences, no commentary before or after.";

    const userPrompt = "Household info:\n" + JSON.stringify(householdInfo, null, 2) +
      "\n\nBoard of advisors (credit dinners to these personas):\n" + JSON.stringify(advisors, null, 2) +
      `\n\nCurrent week being revised (week_id: ${currentWeek.week_id}, date_range: ${currentWeek.date_range}):\n` + JSON.stringify(currentWeek, null, 2) +
      (combinedFeedback ? "\n\nNew family feedback to incorporate:\n" + combinedFeedback : "") +
      (currentWeek.pantry_ingredients && currentWeek.pantry_ingredients.length ? "\n\nPrioritise building meals around these pantry ingredients the family wants used: " +
        currentWeek.pantry_ingredients.join(", ") + ". If any of them conflicts with a stated allergy/dislike, don't force it in — mention the conflict in your board_note instead of silently including or dropping it." : "") +
      (currentWeek.budget_saver_mode ? "\n\nBudget Saver Mode is on — where realistic, chain a shared base across two or more meals this week to shrink the shopping list (e.g. bolognese sauce Monday into lasagna Wednesday)." : "") +
      (dishReputationLines.length ? '\n\nHistorical dish feedback (from every "Log" submission ever made, any week) — ' +
        'if you touch a dinner below, prefer repeating a "proven" dish over a fresh idea when it fits, and avoid reintroducing ' +
        'a poorly-received ("new" status with mostly "no") dish in the same format:\n' + dishReputationLines.join("\n") : "") +
      (hasNewFeedback
        ? "\n\nRevise ONLY the days/meals that need to change to address the feedback above and/or the " +
          "(possibly updated) household principles above — leave every other day exactly as it was unless it " +
          "truly needs to change. A day's dinner/lunch/snack may be null (an empty slot the family removed on purpose) " +
          "— leave it null unless the feedback specifically asks you to fill it. "
        : "\n\nThe family has not left any new feedback or principle changes since this plan was generated — they " +
          "clicked Refresh simply wanting a fresh alternative take on the week, not a fix for anything specific. Feel " +
          "free to swap out any board-authored meal for variety, even without a complaint driving the change, while " +
          "still respecting the household principles, historical dish reputation, and pantry/Budget Saver settings " +
          "above. A day's dinner/lunch/snack may be null (an empty slot the family removed on purpose) — leave it null. ") +
      "Keep the leftover-lunch day-after rule intact (Tuesday lunch = Monday dinner leftovers, etc.). " +
      'Never invent a method for a meal that has a "source" field (an externally-linked recipe the family added ' +
      "themselves) — leave every one of those exactly as it is. " +
      'Give every present meal a structured "ingredients" array: [{"name":"...","quantity":<number>,"unit":"...",' +
      '"category":"produce|meat_deli|dairy|pantry|frozen|other","display":"natural prose form, e.g. \'2 cloves garlic, minced\'"}] ' +
      '— leftover-based lunches/snacks get "ingredients": []. Dinners also get a "method" array of prose steps. ' +
      "Every ingredient named or implied anywhere in the method must appear in the ingredients array for that dinner, with a real quantity — nothing introduced mid-method that was not listed upfront, and no vague amounts. If a dinner needs a componentized or prep-ahead ingredient (something that itself needs advance prep, like cold cooked rice for a fried rice dish), give it its own early method step with explicit day-before timing rather than assuming it is ready to use, and set the prep_ahead_note field on that dinner to a short instruction describing that step (omit the field entirely when there is no such step). Give every dinner prep_time and cook_time as separate figures (e.g. \"15 min\"), plus hands_off_time only for a genuine passive period like marinating or resting (omit it, not an empty string, when there is not one). " +
      "Original board-authored recipes only, no external recipe links. Respond with this exact JSON shape (all 7 days, " +
      "even unchanged ones, and do not include a shopping_list — it is computed separately):\n" +
      "{\n" +
      '  "days": [ { "day": "Monday", "dinner": {"name": "...", "new": true, "authored_by": "...", "ingredients": [...], "method": ["..."], "prep_time": "...", "cook_time": "...", "hands_off_time": "... (omit if none)", "prep_ahead_note": "... (omit if none)"}, "lunch": {"name": "...", "ingredients": [...]}, "snack": {"name": "...", "ingredients": [...]} }, ... ],\n' +
      '  "board_note": "one or two sentences on what changed and why",\n' +
      '  "commit_summary": "a short one-line summary suitable as a git commit message"\n' +
      "}";

    // This asks for the same shape as propose-week's full-week generation (all 7 days, every
    // slot, even unchanged ones) -- propose-week needed 24000 tokens for that shape after a real
    // truncation failure, yet this call was still on callClaude's untouched 8000 default. Found
    // while investigating a similar truncation bug in regenerate-meal (2026-08-16) -- same
    // pattern, fixed here before it caused an identical live failure on Refresh plan.
    const plan = await callClaude(systemPrompt, userPrompt, 24000);
    if (!plan || !plan.days || !Array.isArray(plan.days)) {
      return jsonResponse({ status: "error", message: "The board did not return a usable plan — try again." }, 502);
    }

    const upsertRows: any[] = [];
    plan.days.forEach((d: any) => {
      SLOTS.forEach((slot) => {
        const info = d[slot];
        if (!info) {
          upsertRows.push({
            week_id: week.id, day: d.day, slot, name: null, ingredients: [], method: null, source: null,
            new_or_repeat: null, authored_by: null, prep_time: null, cook_time: null, hands_off_time: null, prep_ahead_note: null,
          });
          return;
        }
        const trimmed = trimMeal(info, slot);
        upsertRows.push({
          week_id: week.id, day: d.day, slot,
          name: trimmed.name, ingredients: trimmed.ingredients,
          method: trimmed.method || null, source: trimmed.source || null,
          new_or_repeat: trimmed.new_or_repeat || null, authored_by: trimmed.authored_by || null,
          prep_time: trimmed.prep_time || null, cook_time: trimmed.cook_time || null,
          hands_off_time: trimmed.hands_off_time || null, prep_ahead_note: trimmed.prep_ahead_note || null,
        });
      });
    });
    const { error: upsertErr } = await supabaseClient.from("meals").upsert(upsertRows, { onConflict: "week_id,day,slot" });
    if (upsertErr) throw upsertErr;

    const today = new Date().toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", month: "short", day: "numeric" });
    const newBoardNotes = (week.board_notes || "") + ` UPDATE (${today}): ` + (plan.board_note || "Refreshed via on-demand regenerate.");
    const { error: weekUpdateErr } = await supabaseClient.from("weeks").update({
      pantry_ingredients: currentWeek.pantry_ingredients, budget_saver_mode: currentWeek.budget_saver_mode, board_notes: newBoardNotes,
      last_regenerated_at: new Date().toISOString(),
    }).eq("id", week.id);
    if (weekUpdateErr) throw weekUpdateErr;

    return jsonResponse({ status: "ok", summary: plan.board_note });
  } catch (e) {
    return jsonResponse({ status: "error", message: e.message }, 500);
  }
});
