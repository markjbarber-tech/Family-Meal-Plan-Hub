# Family Menu Hub — automation

This file is instructions for Claude Code to follow every time it's run on a schedule in this repo. It does THREE jobs, all fully automatic, all ending in a `git push` straight to GitHub Pages — no manual upload, ever.

- **Job A — weekly proposal**: once a week, draft next week's meal plan and push it live.
- **Job B — feedback watch**: any time, check whether the family has left "changes/concerns" or "use up these ingredients" feedback on the Hub, and if so, revise the current plan and push the update.
- **Job C — principles update watch**: any time, check whether the family has edited the meal planning principles directly on the Hub's principles page, and if so, apply the edit to `household.json` and push the update.

Run all three jobs, every time this file is invoked (every 3 hours). Each is independent — do Job A's check first, then Job B's, then Job C's, regardless of what happened in the others.

## Shared setup

Read `household.json` in this repo first. It contains:
- `household` — the family's people, likes, dislikes, principles (Maddie: lactose intolerant, dislikes tomatoes; Hamish: picky, avoid broccoli-forward mains/salmon patties/roast veg stacks/pie fillings; full details in the file)
- `board_of_advisors` — five meal-planning personas to credit recipes to (Weeknight Realist, Flavor Explorer, Veg-Forward Stylist, Child Nutritionist, Family GP/Dietician)
- `current_week` — the week currently live on the Hub (`status` is `"proposed"` while open for feedback). Each day has `dinner`/`lunch`/`snack`, any of which may be `null` (an empty slot the family removed via the Hub, left empty on purpose — never auto-filled by this job). Each present meal has `name` and a structured `ingredients` array (`{name, quantity, unit, category, display}` — `category` is one of `produce`/`meat_deli`/`dairy`/`pantry`/`frozen`/`other`; leftover-based lunches use `ingredients: []` since their ingredients were already counted under the dinner they reuse). Dinners additionally have `new_or_repeat`, `authored_by`, and `method` (an array of prose steps) — unless the dinner came from the Hub's "Add from a link" flow, in which case it has a `source: {type:"external_url", url}` instead of `method` (no method text is ever stored for those — copyright — the Hub links out to the source instead). `current_week` also carries `pantry_ingredients` (array of strings) and `budget_saver_mode` (boolean) — both **reset to `[]`/`false` on every new weekly proposal**, since they're a per-week setting the family re-sets from the Hub's Plan tab, not a standing preference.
- `favourites` — recipes the family has saved from past weeks via the Hub's ❤️ Favourites page. Each has `id`, `name`, `authored_by`, `recipe` `{ingredients, method}` (plain prose arrays here — favourites are a saved snapshot, independent of the structured shopping-list ingredients above), `saved_at`, and `requested_for_next_week` (a boolean the family sets from that page to request it be guaranteed a spot in the next proposed week)

There is no `shopping_list` field on `current_week` any more — the Hub computes the shopping list live in the browser by summing every present meal's `ingredients`, so this job never authors or maintains one.

Run `git pull` first, in case anything changed since last time.

## Job A — weekly proposal

1. Get today's date in Sydney time: `TZ=Australia/Sydney date +%A` (day name) and `TZ=Australia/Sydney date +%F` (date).
2. Read `last_proposed_date` from `household.json` (add it with value `null` if it's not there yet).
3. Only proceed if BOTH: today is Saturday in Sydney time, AND `last_proposed_date` is not today's date (this stops it from re-proposing every 3 hours all Saturday).
4. If those conditions aren't met, skip Job A entirely and move to Job B.
5. If they are met: this is a genuine weekly proposal. Move `current_week` into `week_history` (trim it to `{week_id, date_range, dinners: [list of dinner names]}` to keep the file small — keep at most the last 8 entries in `week_history`). Draft a brand-new 7-day plan (dinners/lunches/snacks) for the Monday through Sunday starting the next Monday, as the new `current_week`, `status: "proposed"`:
   - **First, check `household.favourites` for any entry with `requested_for_next_week: true`.** Each one MUST appear verbatim (exact name, authored_by, and recipe — do not rewrite or reinterpret it) as a dinner somewhere in the new week, before anything else is drafted. Fit as many as sensibly possible across the 7 days if there's more than one; use judgement on which day each lands on. After the week is built, set `requested_for_next_week` back to `false` on every favourite that was included (it stays saved for future reuse, just no longer pending) — mention in `board_notes` which favourite(s) were included and why.
   - **Then, fetch the feedback sheet as JSON** (same endpoint as Job B step 1 — reuse the response if already fetched this run):
     ```
     curl -s "https://script.google.com/macros/s/AKfycbwQXFwbeGLuhF8XA08NpEiWmCRscGNjxTt0wN3lGc73Pk-7PXLPMwU4dexHaRbQDRAWMw/exec?action=feedback&key=family-menu-2026"
     ```
     Filter to `type === "meal_feedback"` rows only — these are the per-meal "Log" button submissions (`day`, `meal`, `meal_name`, `kids_ate_it`: yes/mostly/no, `parent_rating`: 1-5, `note`), covering every week ever served, not just the current one. Group by `meal_name` (exact match) to build a per-dish reputation:
     - **Proven winners** (predominantly `yes`/`mostly` across its logged history): safe, and good, to repeat — don't be shy about bringing back a dish that's worked before just because it was recently used, but also don't repeat the exact same dinner every single week; use judgement on spacing.
     - **Poor performers** (predominantly `no`, or a low average `parent_rating`): avoid repeating in the same format. If the underlying ingredient/concept is still worth persisting with (e.g. a nutrition-forward food the household wants to keep offering per `key_principles`), consider a meaningfully different format instead of the exact dish that flopped (mirroring how salmon patties flopped but crumbed "fish fingers" didn't) — don't just avoid the ingredient outright.
     - Dishes with no logged feedback yet are simply new attempts — no penalty, no special treatment needed beyond normal variety.
     - Mention in `board_notes` when a choice was specifically informed by this history (a repeat winner, or a reformatted flop) — a brief note is enough, not a full explanation per dish.
   - Determine the current Australian season from today's date (winter Jun–Aug = hot meals, summer Dec–Feb = grilled/salads, shoulder seasons = judgment) and bias accordingly.
   - Original board-authored recipes for every other dinner, credited to advisor personas — no external recipe links.
   - Respect all of `household`'s dislikes and notes.
   - Keep the leftover-lunch day-after rule (Tuesday's lunch uses Monday's dinner leftovers, etc.) — Monday's lunch can draw on the previous week's Sunday dinner leftovers.
   - Prioritise anything in `household.use_up_this_week` for Monday–Wednesday, then clear that list.
   - **Give every present meal a structured `ingredients` array** — `[{name, quantity, unit, category, display}]` where `category` is one of `produce`/`meat_deli`/`dairy`/`pantry`/`frozen`/`other` and `display` is the natural prose form (e.g. `"2 cloves garlic, minced"`) shown in the Recipe tab. Leftover-based lunches/snacks get `ingredients: []`. Dinners also get a `method` array of prose steps. Don't author a shopping list separately — the Hub computes it live from these `ingredients` arrays.
   - Set `current_week.pantry_ingredients` to `[]` and `current_week.budget_saver_mode` to `false` on every new proposal — these are a per-week setting the family re-sets from the Hub each week, never carried over from the previous week.
6. Regenerate `index.html`: replace its `WEEK_DATA` constant with the new `current_week` (mirrored into the shape the page expects: dinner's `new_or_repeat` string becomes a `new` boolean, everything else — `ingredients`, `method`, `source`, `pantry_ingredients`, `budget_saver_mode` — carries straight across), `PRINCIPLES_TEXT` with `household.key_principles`, and `FAVOURITES` with `household.favourites` (only actually changes if step 5 cleared a `requested_for_next_week` flag, but keep it in sync every time regardless), keeping everything else in the file exactly as-is (feedback box, Log buttons, recipe pages, `FEEDBACK_ENDPOINT` unchanged).
7. Set `last_proposed_date` in `household.json` to today's date.
8. Validate before committing: extract the `<script>...</script>` contents of `index.html` to a temp file and run `node --check` on it — if `node` isn't installed on this machine, skip this check and just note it in the summary rather than blocking the push.
9. `git add household.json index.html`, commit with a message like "Propose week of <date range>", and `git push`.

## Job B — feedback watch

1. Fetch the feedback sheet as JSON:
   ```
   curl -s "https://script.google.com/macros/s/AKfycbwQXFwbeGLuhF8XA08NpEiWmCRscGNjxTt0wN3lGc73Pk-7PXLPMwU4dexHaRbQDRAWMw/exec?action=feedback&key=family-menu-2026"
   ```
   Returns `{"status":"ok","rows":[...]}` — each row has `timestamp`, `type`, `week_id`, `plan_feedback`, `use_up_ingredients`, `pantry_ingredients`, `budget_saver_mode`, etc.
2. Read `.menu-state.json` (create it with `{"last_processed_feedback_at": null}` if missing). Keep only rows where: `type` is exactly `"review_feedback"` (never `"meal_feedback"` — those are per-meal post-cook logs from the Hub's "Log" buttons — and never `"principles_update"`, which Job C handles instead; none of these should ever trigger a plan rewrite), `week_id` matches `current_week.week_id` (re-read `household.json` fresh if Job A just changed it), `current_week.status` is `"proposed"`, and `timestamp` is newer than `last_processed_feedback_at`.
3. **If nothing new:** update `.menu-state.json`'s `last_processed_feedback_at` to the newest timestamp seen (so old rows are never re-checked), commit that alone if it changed, and stop. Most runs end here — not a failure.
4. **If there's new feedback:** combine the `plan_feedback` and `use_up_ingredients` text from all new rows (oldest to newest) and:
   - Revise `current_week`'s affected day(s) to address it, respecting `household`'s preferences throughout, giving each changed meal a structured `ingredients` array the same way as Job A step 5 (leave unchanged days' `ingredients` exactly as they were).
   - Work newly-listed use-up ingredients into Monday–Wednesday where realistic.
   - If the newest row carries a `pantry_ingredients` or `budget_saver_mode` value, persist it onto `current_week.pantry_ingredients`/`current_week.budget_saver_mode` (split `pantry_ingredients` on commas into an array) and factor it into this revision — prefer building around listed pantry ingredients, and if Budget Saver Mode is on, look for a chance to chain a shared base across two or more meals this week. If a listed pantry ingredient conflicts with a stated allergy/dislike, don't force it in — mention the conflict in `board_notes` instead of silently including or dropping it.
   - Add a short note to `current_week.board_notes` on what changed and why.
   - Regenerate `index.html` the same way as Job A step 6, and validate with `node --check` the same way as Job A step 8.
   - Update `.menu-state.json`.
   - `git add household.json index.html .menu-state.json`, commit with a message describing what changed, `git push`.

## Job C — principles update watch

1. Fetch the feedback sheet as JSON (same endpoint and shape as Job B step 1 — reuse the response from this run if Job B already fetched it, otherwise fetch it fresh).
2. Read `.menu-state.json` (add `"last_processed_principles_update_at": null` if missing). Keep only rows where `type` is exactly `"principles_update"` and `timestamp` is newer than `last_processed_principles_update_at`.
3. **If nothing new:** update `.menu-state.json`'s `last_processed_principles_update_at` to the newest timestamp seen (so old rows are never re-checked), commit that alone if it changed (combine into the same commit as Job B's watermark update if both changed this run), and stop. Most runs end here — not a failure.
4. **If there's a new update:** take the single newest matching row's `plan_feedback` field — it holds the *entire* edited principles text as submitted from the Hub's principles page, and it fully replaces `household.key_principles`, it is not merged with the old list:
   - Split it into lines, strip any leading `"- "` from each, drop blank lines, and set the resulting array as `household.key_principles`.
   - Regenerate `index.html`'s `PRINCIPLES_TEXT` from the new list (one `"- "`-prefixed line per principle, same format as before), keeping everything else in the file exactly as-is, and validate with `node --check` the same way as Job A step 8.
   - Update `.menu-state.json`.
   - `git add household.json index.html .menu-state.json`, commit with a message like "Update meal planning principles per family edit", and `git push`.

## Always finish with

One short summary line covering all three jobs, e.g. "No proposal due, no new feedback, no principles update." or "Proposed week of Aug 17–23." or "No proposal due. Updated Tuesday & Wednesday dinners per feedback, pushed." or "Updated meal planning principles per family edit."

## Notes

- `household.json` is the single source of truth. `index.html` is always generated from it, never edited by hand.
- The Google Sheet is the permanent record of every feedback submission ever made — `.menu-state.json` only needs the watermarks.
- Only `review_feedback` triggers a plan rewrite (Job B); only `principles_update` triggers a principles rewrite (Job C); `meal_feedback` never triggers either.
- The principles page on the Hub is directly editable by the family (textarea + "Update" button) — edits post a `principles_update` row to the same feedback sheet Job B reads, which Job C then applies. There is deliberately no separate approval step; whatever is submitted there replaces `household.key_principles` outright next time this file runs.
- The Hub also has a "🔄 Refresh plan" button that bypasses the 3-hourly wait entirely: it POSTs a `regenerate_now` row and the Apps Script backend itself (not this scheduled job) calls the Anthropic API directly, revises `current_week`, and pushes to GitHub synchronously via the GitHub Contents API — all within the same request. Ignore `regenerate_now` rows in the feedback sheet; they're an audit-log entry only, already fully handled by the Apps Script before this file ever runs. That on-demand path advances the *same* `last_processed_feedback_at` / `last_processed_principles_update_at` watermarks in `.menu-state.json` that Jobs B and C use — always re-read `.menu-state.json` fresh (after `git pull`) rather than assuming this scheduled job is the only writer, so a button-triggered refresh in between runs is never redundantly reprocessed.
- The Hub's "❤️ Favourites" page lets the family save a dinner recipe from any week and request it for the next proposed week. Saving and requesting are both handled entirely by the Apps Script backend (writes straight to `household.favourites` and syncs `index.html`'s `FAVOURITES` constant) — this scheduled job never needs to process a sheet row for either action, it only needs to *read* `household.favourites` fresh each run (Job A step 5) and honour any `requested_for_next_week: true` entries, then clear the flag once included and keep `FAVOURITES` in `index.html` in sync (Job A step 6).
- The Hub's Plan tab shows a live "proven vs. new attempt" status badge per dinner and a shared/synced shopping checklist. Both are read and written directly by the page's own JS via two more Apps Script endpoints (`action=dish_stats` and `action=shopping_state` / `type=toggle_shopping_item`) — this scheduled job never touches either at read-time; the only place this job interacts with that data is Job A step 5's historical-feedback lookup (which reads the same underlying `meal_feedback` sheet rows directly via `action=feedback`, not through `dish_stats`).
- The shopping list itself is never authored anywhere, by this job or the Apps Script — the Hub computes it live in the browser by summing the `ingredients` array of every meal still present in `current_week.days` (removing a meal removes its ingredients from the list automatically; adding one merges its ingredients in). This job's only responsibility re: shopping is giving every meal it writes a correct structured `ingredients` array.
- The Hub lets the family remove a meal from a slot (leaving it empty — `dinner`/`lunch`/`snack` becomes `null`) or regenerate a single slot, and lets them add a recipe from an external URL to an empty slot. All three (`type=remove_meal`, `type=regenerate_meal`, `type=preview_external_recipe` + `type=add_external_recipe`) are handled entirely by the Apps Script backend synchronously within the request, the same way the Refresh-plan button is — this scheduled job never processes a sheet row for any of them and never needs to touch a `null` slot itself; it only needs to handle `null` gracefully if it reads `current_week.days` and finds one (leave it `null` unless the feedback being processed specifically addresses that slot).
- Externally-added recipes (via "Add from a link") have a `source: {type:"external_url", url}` on the meal instead of a `method` array, and no method text is ever fetched or stored for them (copyright) — if this job ever revises a day that happens to contain one, treat it like any other meal for planning purposes but don't invent a `method` for it if replacing it; either leave it as-is or replace it outright with a fresh board-authored meal (which does get a `method`).
- Pull-to-refresh (checking for a newer app-code deployment) is a client-side-only gesture on the Hub with no server or scheduled-job involvement at all — nothing for this job to do there.
