// New action (2026-10-19): the family often has a rough idea for a meal -- "beef mince tacos,
// like a classic 90s crunchy taco dinner" -- without a finished recipe or a link to one. This
// function takes that free-text idea, uses Claude's web_search tool to research a real approach
// rather than guessing, and returns a full proposed recipe in the same shape regenerate-meal
// produces. Stateless and preview-only like preview-external-recipe -- no DB write happens here;
// index.html shows the proposal, and the family can either approve it (a plain mechanical write,
// same pattern as the external-link flow) or send feedback to re-run this function for another
// pass, carrying the previous proposal forward so Claude revises instead of starting over.
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

// Mirrors regenerate-meal's trimMeal() exactly -- same output shape per meal type.
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

async function callClaude(systemPrompt: string, userPrompt: string, maxTokens = 8000, tools?: any[]) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const body: any = {
    model: "claude-sonnet-5",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
  if (tools) body.tools = tools;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error("Anthropic API error: " + (await resp.text()));
  const json = await resp.json();
  // web_search is a server-executed tool -- Anthropic runs the searches and feeds results back
  // to the model within this same response, so the content array can contain several tool-use /
  // tool-result blocks (and sometimes interstitial text) before the real answer. Take the LAST
  // text block, not the first, so search chatter never gets parsed as the JSON reply.
  let text: string | null = null;
  for (const block of json.content || []) {
    if (block.type === "text") text = block.text;
  }
  if (text == null) throw new Error("No text block in Anthropic response");
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    // After a web_search round the model sometimes prefaces the JSON with a transition sentence
    // in the SAME text block (e.g. "Now I have enough information to put this together:{...}")
    // despite the system prompt saying the final message must be only JSON -- not a markdown
    // fence (already stripped above), just leading/trailing prose around the object. Extract the
    // outermost {...} substring and parse that before giving up.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
    }
    // Same brace-retry resilience as the other 3 functions -- a handful of real failures showed
    // otherwise complete JSON cut off missing only the final closing brace.
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

    const { day, meal, idea, previous, feedback } = await req.json();
    if (!day || !meal) return jsonResponse({ status: "error", message: "Missing day or meal" }, 400);
    if (!idea || !String(idea).trim()) return jsonResponse({ status: "error", message: "Missing idea" }, 400);

    const { data: households, error: hErr } = await supabaseClient.from("households").select("*").limit(1);
    if (hErr) throw hErr;
    const household = households && households[0];
    if (!household) return jsonResponse({ status: "error", message: "No household found" }, 404);

    const { data: advisorRows, error: aErr } = await supabaseClient.from("board_of_advisors").select("*");
    if (aErr) throw aErr;
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

    // Same leftover-lunch day-after context as regenerate-meal, for the (unlikely but possible)
    // case where the family's "idea" is itself leftovers-shaped.
    let prevDinnerName: string | null = null;
    if (meal === "lunch") {
      const dayIdx = DAY_NAMES.indexOf(day);
      if (dayIdx > 0) {
        const prevDinner = (meals || []).find((m: any) => m.day === DAY_NAMES[dayIdx - 1] && m.slot === "dinner");
        if (prevDinner && prevDinner.name) prevDinnerName = prevDinner.name;
      }
    }

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

    const systemPrompt = "You are the meal-planning board — researching a specific meal idea a family member has in " +
      "mind, for one day's " + meal + " as part of their weekly meal plan. Use the web_search tool to look up real " +
      "recipes, techniques, or context relevant to their idea before answering, so your proposal reflects something " +
      "that actually exists and works, not a guess. Once you have researched enough, your FINAL message must be ONLY " +
      "a single valid JSON object — no markdown fences, no commentary before or after it (earlier messages made while " +
      "researching may contain ordinary text, but the very last thing you say must be exactly that JSON object).";

    const userPrompt = "Household info:\n" + JSON.stringify(householdInfo, null, 2) +
      "\n\nBoard of advisors (credit a dinner to one of these personas):\n" + JSON.stringify(advisors, null, 2) +
      `\n\nThe family has an idea for ${day}'s ${meal}: "${String(idea).trim()}"` +
      (excludeName ? ` — replacing "${excludeName}", which was just removed from this slot.` : ".") +
      (otherMealNames.length ? "\n\nOther meals already in this week (avoid repeating any of these): " + otherMealNames.join(", ") : "") +
      (dishReputationLines.length ? '\n\nHistorical dish feedback (from every "Log" submission ever made, any week) — prefer repeating a "proven" dish over a fresh idea when it fits, and avoid reintroducing a poorly-received ("new" status with mostly "no") dish in the same format:\n' + dishReputationLines.join("\n") : "") +
      (week.pantry_ingredients && week.pantry_ingredients.length ? "\n\nPrioritise building this meal around these pantry ingredients the family wants used: " +
        week.pantry_ingredients.join(", ") + ". If any conflicts with a stated allergy/dislike, don't force it in — mention the conflict in your research_note instead." : "") +
      (week.budget_saver_mode ? "\n\nBudget Saver Mode is on — if realistic, chain this meal's base off another meal already in the week to shrink the week's shopping list." : "") +
      (meal === "dinner" ? '\n\nEvery ingredient named or implied anywhere in the method must appear in the ingredients array with a real quantity — nothing introduced mid-method that was not listed upfront, and no vague amounts. If this dinner needs a componentized or prep-ahead ingredient (something that itself needs advance prep, like cold cooked rice for a fried rice dish), give it its own early method step with explicit day-before timing rather than assuming it is ready to use, and set prep_ahead_note to a short instruction describing that step (omit the field entirely when there is no such step). Give prep_time and cook_time as separate figures (e.g. "15 min"), plus hands_off_time only for a genuine passive period like marinating or resting (omit it, not an empty string, when there is not one).' : "") +
      (meal === "lunch"
        ? (prevDinnerName
            ? `\n\n${day}'s preceding dinner is "${prevDinnerName}" — only treat this as leftovers (set "is_leftover": true, "ingredients": []) if that is actually what the family's idea describes; otherwise follow their idea as its own original dish and set "is_leftover": false.`
            : "\n\nThere is no dinner the day before this one in the current plan — follow the family's idea as its own original dish and set \"is_leftover\": false.")
        : "") +
      '\n\nAlso include a one-sentence "research_note" in your response: what you found or confirmed via search (a style, technique, dish name, or source that informed this), written conversationally for the family to read, not a citation.' +
      (previous
        ? `\n\nYou already proposed this for the idea above:\n${JSON.stringify(previous, null, 2)}\n\nThe family gave this feedback: "${String(feedback || "").trim()}"\nRevise your proposal to address the feedback. Search again with web_search if the feedback changes what you need to find (a different cuisine, dietary need, or technique) — otherwise refine based on what you already found.`
        : "") +
      "\n\nRespond with this exact JSON shape" + (meal === "dinner"
        ? ':\n{"name": "...", "new": true, "authored_by": "...", "ingredients": [{"name":"...","quantity":<number>,"unit":"...","category":"produce|meat_deli|dairy|pantry|frozen|other","display":"..."}], "method": ["...", "..."], "prep_time": "...", "cook_time": "...", "hands_off_time": "... (omit if none)", "prep_ahead_note": "... (omit if none)", "research_note": "..."}'
        : meal === "lunch"
          ? ' (no method or authored_by needed for lunch):\n{"name": "...", "ingredients": [{"name":"...","quantity":<number>,"unit":"...","category":"produce|meat_deli|dairy|pantry|frozen|other","display":"..."}], "is_leftover": true|false, "research_note": "..."}'
          : ' (no method or authored_by needed for snack):\n{"name": "...", "ingredients": [{"name":"...","quantity":<number>,"unit":"...","category":"produce|meat_deli|dairy|pantry|frozen|other","display":"..."}], "research_note": "..."}');

    // Real web_search tool traffic (queries + result snippets) adds meaningfully to the content
    // array on top of a normal dinner-shaped reply, so this gets more headroom than
    // regenerate-meal's plain 6000 for the same slot types.
    const result = await callClaude(
      systemPrompt,
      userPrompt,
      10000,
      [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    );
    if (!result || !result.name || !result.ingredients) {
      return jsonResponse({ status: "error", message: "Couldn't find a solid recipe for that idea — try rephrasing or being more specific." }, 502);
    }

    const trimmed: any = trimMeal(result, meal);
    if (meal === "lunch") trimmed.is_leftover = !!result.is_leftover;

    return jsonResponse({ status: "ok", meal: trimmed, note: result.research_note || "" });
  } catch (e) {
    return jsonResponse({ status: "error", message: e.message }, 500);
  }
});
