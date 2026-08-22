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
//
// 2026-08-22: switched from an incremental "only touch what changed" revision (fast, but not
// what the family actually wanted -- they explicitly asked for an entirely fresh plan every
// Refresh, not small patches) to a genuine full-week redraft. That reintroduces the large-output,
// long-generation-time shape that previously caused slow responses and real "idle timeout (150s)"
// failures, so the actual Claude call + DB write now run in the background via
// EdgeRuntime.waitUntil() instead of blocking the HTTP response -- see Deno.serve below. The
// client polls weeks.regeneration_status/regeneration_error instead of waiting on one long
// request; see index.html's runRegenerate().
import { createClient } from "jsr:@supabase/supabase-js@2";

// Declared, not imported -- EdgeRuntime is a global the Supabase Edge Runtime injects at
// execution time, not part of standard Deno types. waitUntil() lets this function return its
// HTTP response immediately while a promise keeps running in the background afterward; it's
// Supabase's documented pattern for exactly this "kick off long work, respond right away" case.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

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
  const startedAt = Date.now();
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
  // Left in place after the 2026-08-22 rewrite so a future slow call can actually be diagnosed
  // from Supabase's function logs instead of guessed at again.
  console.log(`[callClaude] ${Date.now() - startedAt}ms, usage=${JSON.stringify(json.usage)}`);
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

// Everything past the synchronous claim in Deno.serve below -- fetching context, calling Claude,
// writing the result -- happens here, kicked off via EdgeRuntime.waitUntil() so it's free to take
// as long as a genuine full-week redraft needs without the HTTP response waiting on it. Always
// resolves regeneration_status back to "idle" (with regeneration_error set on failure) so the
// client's poll in index.html has something to land on either way.
async function regenerateWeek(supabaseClient: any, householdId: string, household: any, week: any) {
  try {
    const { data: advisorRows, error: aErr } = await supabaseClient.from("board_of_advisors").select("*");
    if (aErr) throw aErr;
    // Only {name, philosophy} -- matches the original prompt's shape exactly. Passing the extra
    // persona_key/is_customizable columns confused the model into using persona_key for
    // "authored_by" attribution instead of the human-readable name.
    const advisors = (advisorRows || []).map((a: any) => ({ name: a.name, philosophy: a.philosophy }));

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

    // The persona roster is no longer fixed (Settings > Board of advisors lets the household
    // rename, add, or remove any of them) -- naming a specific headcount/list here would go
    // stale the moment they do. The actual current roster is given in full below, in the
    // "Board of advisors" block of userPrompt.
    const systemPrompt = "You are the meal-planning board — a panel of named advisor personas (listed below, with what " +
      "each one cares about) — drafting an entirely fresh weekly meal plan for a family, replacing their current one. " +
      "You must respond with ONLY a single valid JSON object — no markdown fences, no commentary before or after.";

    const userPrompt = "Household info:\n" + JSON.stringify(householdInfo, null, 2) +
      "\n\nBoard of advisors (credit dinners to these personas):\n" + JSON.stringify(advisors, null, 2) +
      `\n\nWeek being replaced (week_id: ${currentWeek.week_id}, date_range: ${currentWeek.date_range}) -- shown for ` +
      "reference only, so you can avoid pointlessly repeating the exact same dinner on the exact same day and see " +
      "which slots the family has intentionally left empty:\n" + JSON.stringify(currentWeek, null, 2) +
      (combinedFeedback ? "\n\nNew family feedback to incorporate:\n" + combinedFeedback : "") +
      (currentWeek.pantry_ingredients && currentWeek.pantry_ingredients.length ? "\n\nPrioritise building meals around these pantry ingredients the family wants used: " +
        currentWeek.pantry_ingredients.join(", ") + ". If any of them conflicts with a stated allergy/dislike, don't force it in — mention the conflict in your board_note instead of silently including or dropping it." : "") +
      (currentWeek.budget_saver_mode ? "\n\nBudget Saver Mode is on — where realistic, chain a shared base across two or more meals this week to shrink the shopping list (e.g. bolognese sauce Monday into lasagna Wednesday)." : "") +
      (dishReputationLines.length ? '\n\nHistorical dish feedback (from every "Log" submission ever made, any week) — ' +
        'prefer repeating a "proven" dish over a fresh idea when it fits, and avoid reintroducing ' +
        'a poorly-received ("new" status with mostly "no") dish in the same format:\n' + dishReputationLines.join("\n") : "") +
      (hasNewFeedback
        ? "\n\nMake sure the feedback above (and/or the possibly-updated household principles above) is clearly " +
          "reflected in the new plan — but you are not limited to only the specific day/meal it mentions: this is a " +
          "full refresh of the whole week, not a targeted patch. "
        : "\n\nThe family has not left any new feedback or principle changes since this plan was generated — they " +
          "clicked Refresh simply wanting an entirely fresh take on the week. Use your own judgement for what to " +
          "draft, guided by the household principles, historical dish reputation, and pantry/Budget Saver settings " +
          "above. ") +
      "Keep the leftover-lunch day-after rule intact (Tuesday lunch = Monday dinner leftovers, etc.). " +
      'Never invent a method for a meal that has a "source" field (an externally-linked recipe the family added ' +
      "themselves) — leave every one of those exactly as it is by simply not including it below at all. " +
      'Give every meal you include below a structured "ingredients" array: [{"name":"...","quantity":<number>,"unit":"...",' +
      '"category":"produce|meat_deli|dairy|pantry|frozen|other","display":"natural prose form, e.g. \'2 cloves garlic, minced\'"}] ' +
      '— leftover-based lunches/snacks get "ingredients": []. Dinners also get a "method" array of prose steps. ' +
      "Every ingredient named or implied anywhere in the method must appear in the ingredients array for that dinner, with a real quantity — nothing introduced mid-method that was not listed upfront, and no vague amounts. If a dinner needs a componentized or prep-ahead ingredient (something that itself needs advance prep, like cold cooked rice for a fried rice dish), give it its own early method step with explicit day-before timing rather than assuming it is ready to use, and set the prep_ahead_note field on that dinner to a short instruction describing that step (omit the field entirely when there is no such step). Give every dinner prep_time and cook_time as separate figures (e.g. \"15 min\"), plus hands_off_time only for a genuine passive period like marinating or resting (omit it, not an empty string, when there is not one). " +
      "Original board-authored recipes only, no external recipe links. " +
      "IMPORTANT — this is a full refresh, not an incremental edit: draft a freshly-considered dinner (and any " +
      "lunch/snack affected by the leftover-day-after rule) for every day of the week and include ALL of them in " +
      "your response below, even ones that happen to land close to what was there before. The only things to leave " +
      "OUT of your response are: (a) any meal with a \"source\" field (external recipe link — never touch those), " +
      "and (b) a slot that is empty on purpose and the family is not asking you to fill (leave those out too, " +
      "rather than inventing something for them). Respond with this exact JSON shape:\n" +
      "{\n" +
      '  "changes": [ { "day": "Monday", "slot": "dinner", "meal": {"name": "...", "new": true, "authored_by": "...", "ingredients": [...], "method": ["..."], "prep_time": "...", "cook_time": "...", "hands_off_time": "... (omit if none)", "prep_ahead_note": "... (omit if none)"} }, { "day": "Wednesday", "slot": "lunch", "meal": null } ],\n' +
      '  "board_note": "one or two sentences on what this fresh week is and why",\n' +
      '  "commit_summary": "a short one-line summary suitable as a git commit message"\n' +
      "}\n" +
      '"slot" is one of "dinner"/"lunch"/"snack" and "day" is one of Monday..Sunday. "meal": null means that slot ' +
      "should stay/become empty on purpose — only include a null entry if you are actively emptying a slot that " +
      "currently has something in it because the feedback asked for that.";

    // Full-week drafting (all ~21 slots, same shape as propose-week's from-scratch generation)
    // needs the same real headroom propose-week was tuned to after a genuine truncation failure.
    // This runs via waitUntil() (see Deno.serve below), so a slower full-week response no longer
    // risks the platform's ~150s idle-response timeout the way it did when this call had to
    // complete before the HTTP response could be sent.
    const plan = await callClaude(systemPrompt, userPrompt, 24000);
    if (!plan || !plan.changes || !Array.isArray(plan.changes)) {
      throw new Error("The board did not return a usable plan — try again.");
    }

    // Keyed by day|slot so a duplicate entry from the AI overwrites rather than producing two
    // rows for the same conflict target in one upsert (Postgres errors on that, not just wastes
    // effort). Anything the AI left out entirely (external-recipe meals, intentionally-empty
    // slots) is simply never touched here.
    const changesByKey = new Map<string, any>();
    plan.changes.forEach((change: any) => {
      if (!change || !DAY_NAMES.includes(change.day) || !SLOTS.includes(change.slot)) return;
      changesByKey.set(`${change.day}|${change.slot}`, change);
    });

    const upsertRows: any[] = [];
    changesByKey.forEach(({ day, slot, meal: info }) => {
      if (!info) {
        upsertRows.push({
          week_id: week.id, day, slot, name: null, ingredients: [], method: null, source: null,
          new_or_repeat: null, authored_by: null, prep_time: null, cook_time: null, hands_off_time: null, prep_ahead_note: null,
        });
        return;
      }
      const trimmed = trimMeal(info, slot);
      upsertRows.push({
        week_id: week.id, day, slot,
        name: trimmed.name, ingredients: trimmed.ingredients,
        method: trimmed.method || null, source: trimmed.source || null,
        new_or_repeat: trimmed.new_or_repeat || null, authored_by: trimmed.authored_by || null,
        prep_time: trimmed.prep_time || null, cook_time: trimmed.cook_time || null,
        hands_off_time: trimmed.hands_off_time || null, prep_ahead_note: trimmed.prep_ahead_note || null,
      });
    });
    if (upsertRows.length) {
      const { error: upsertErr } = await supabaseClient.from("meals").upsert(upsertRows, { onConflict: "week_id,day,slot" });
      if (upsertErr) throw upsertErr;
    }

    const today = new Date().toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", month: "short", day: "numeric" });
    const newBoardNotes = (week.board_notes || "") + ` UPDATE (${today}): ` + (plan.board_note || "Refreshed via on-demand regenerate.");
    const { error: weekUpdateErr } = await supabaseClient.from("weeks").update({
      pantry_ingredients: currentWeek.pantry_ingredients, budget_saver_mode: currentWeek.budget_saver_mode, board_notes: newBoardNotes,
      last_regenerated_at: new Date().toISOString(),
      regeneration_status: "idle", regeneration_error: null, regeneration_summary: plan.board_note || null,
    }).eq("id", week.id);
    if (weekUpdateErr) throw weekUpdateErr;
  } catch (e) {
    // Best-effort -- if even this update fails, the row is stuck on regeneration_status='pending'
    // forever, which is why the client's poll in index.html also has its own give-up timeout
    // rather than trusting this to always succeed.
    try {
      await supabaseClient.from("weeks").update({
        regeneration_status: "idle", regeneration_error: (e as Error).message || "Unknown error",
      }).eq("id", week.id);
    } catch { /* nothing more we can do here */ }
  }
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

    const { data: weeks, error: wErr } = await supabaseClient.from("weeks").select("*").eq("is_current", true).limit(1);
    if (wErr) throw wErr;
    const week = weeks && weeks[0];
    if (!week) return jsonResponse({ status: "error", message: "No current week found" }, 404);

    // Atomically claim the regeneration slot -- only proceeds if this week wasn't already
    // mid-regeneration, so a duplicate Refresh click (or the review box's own call firing while
    // the top button's call is still running) can't kick off two concurrent Claude calls against
    // the same week and race each other on the final upsert.
    const { data: claimed, error: claimErr } = await supabaseClient
      .from("weeks")
      .update({ regeneration_status: "pending", regeneration_error: null, regeneration_summary: null })
      .eq("id", week.id).eq("regeneration_status", "idle")
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) {
      return jsonResponse({ status: "error", message: "A regeneration is already in progress for this week — hang tight, it'll pick up shortly." }, 409);
    }

    // Everything past this point can legitimately take well over Supabase's ~150s idle-response
    // timeout now that a full week is drafted fresh every time rather than just the changed
    // meals -- so it runs after the response below via waitUntil() instead of blocking it. The
    // client polls weeks.regeneration_status/regeneration_error instead of waiting on this HTTP
    // call directly; see index.html's runRegenerate().
    EdgeRuntime.waitUntil(regenerateWeek(supabaseClient, householdId, household, week));

    return jsonResponse({ status: "ok", message: "started" });
  } catch (e) {
    return jsonResponse({ status: "error", message: e.message }, 500);
  }
});
