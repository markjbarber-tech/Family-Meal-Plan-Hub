// Ported from Code.gs's previewExternalRecipe() (legacy/Code.gs.snapshot) -- faithful port of the
// prompt text, not a rewrite. Pure parsing: fetches a URL, strips it to text, asks Claude to
// extract a title + ingredient list (never method text -- copyright constraint). No DB writes.
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
    throw new Error("Could not parse Claude response as JSON: " + String(e));
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

    const { url } = await req.json();
    if (!url) return jsonResponse({ status: "error", message: "Missing url" }, 400);

    const pageResp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!pageResp.ok) {
      return jsonResponse({ status: "error", message: `That page returned an error (status ${pageResp.status})` }, 400);
    }
    const html = await pageResp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000);
    if (!text) return jsonResponse({ status: "error", message: "That page had no readable content" }, 400);

    const systemPrompt = "You extract a recipe title and ingredient list from raw web page text. " +
      "You must respond with ONLY a single valid JSON object — no markdown fences, no commentary. " +
      "Never include any method, instructions, or steps text in your response — copyright constraint, title and ingredients only. You may include a stated prep time and/or cook time if the page states them — never invent one if it does not.";
    const userPrompt = "Extract the recipe title and ingredient list from this page text. " +
      'If this does not look like a recipe page, respond with {"error": "not a recipe page"}. ' +
      "Best-effort parse vague quantities (e.g. \"a pinch of salt\") rather than skipping the ingredient. " +
      'Respond with this exact JSON shape: {"title": "...", "ingredients": [{"name":"...", "quantity": <number or null>, ' +
      '"unit":"...", "category":"produce|meat_deli|dairy|pantry|frozen|other","display":"natural prose form, e.g. \'2 cloves garlic, minced\'"}], "prep_time": "... omit this field if the page does not state one", "cook_time": "... omit this field if the page does not state one"}.' +
      "\n\nPage text:\n" + text;

    const parsed = await callClaude(systemPrompt, userPrompt, 2500);
    if (!parsed || parsed.error || !parsed.title || !parsed.ingredients || !parsed.ingredients.length) {
      return jsonResponse({ status: "error", message: "Couldn't read a recipe from that page" }, 400);
    }

    return jsonResponse({
      status: "ok",
      recipe: {
        title: String(parsed.title),
        ingredients: trimIngredients(parsed.ingredients),
        source_url: url,
        prep_time: parsed.prep_time,
        cook_time: parsed.cook_time,
      },
    });
  } catch (e) {
    return jsonResponse({ status: "error", message: e.message }, 500);
  }
});
