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
- `current_week` — the week currently live on the Hub (`status` is `"proposed"` while open for feedback)

Run `git pull` first, in case anything changed since last time.

## Job A — weekly proposal

1. Get today's date in Sydney time: `TZ=Australia/Sydney date +%A` (day name) and `TZ=Australia/Sydney date +%F` (date).
2. Read `last_proposed_date` from `household.json` (add it with value `null` if it's not there yet).
3. Only proceed if BOTH: today is Saturday in Sydney time, AND `last_proposed_date` is not today's date (this stops it from re-proposing every 3 hours all Saturday).
4. If those conditions aren't met, skip Job A entirely and move to Job B.
5. If they are met: this is a genuine weekly proposal. Move `current_week` into `week_history` (trim it to `{week_id, date_range, dinners: [list of dinner names]}` to keep the file small — keep at most the last 8 entries in `week_history`). Draft a brand-new 7-day plan (dinners/lunches/snacks) for the Monday through Sunday starting the next Monday, as the new `current_week`, `status: "proposed"`:
   - Determine the current Australian season from today's date (winter Jun–Aug = hot meals, summer Dec–Feb = grilled/salads, shoulder seasons = judgment) and bias accordingly.
   - Original board-authored recipes for every dinner, credited to advisor personas — no external recipe links.
   - Respect all of `household`'s dislikes and notes.
   - Keep the leftover-lunch day-after rule (Tuesday's lunch uses Monday's dinner leftovers, etc.) — Monday's lunch can draw on the previous week's Sunday dinner leftovers.
   - Prioritise anything in `household.use_up_this_week` for Monday–Wednesday, then clear that list.
   - Build a shopping list grouped by supermarket section (produce, meat_deli, dairy, pantry, frozen, other).
6. Regenerate `index.html`: replace its `WEEK_DATA` constant with the new `current_week` and `PRINCIPLES_TEXT` with `household.key_principles`, keeping everything else in the file exactly as-is (feedback box, Log buttons, recipe pages, shopping-list copy button, `FEEDBACK_ENDPOINT` unchanged).
7. Set `last_proposed_date` in `household.json` to today's date.
8. Validate before committing: extract the `<script>...</script>` contents of `index.html` to a temp file and run `node --check` on it — if `node` isn't installed on this machine, skip this check and just note it in the summary rather than blocking the push.
9. `git add household.json index.html`, commit with a message like "Propose week of <date range>", and `git push`.

## Job B — feedback watch

1. Fetch the feedback sheet as JSON:
   ```
   curl -s "https://script.google.com/macros/s/AKfycbwQXFwbeGLuhF8XA08NpEiWmCRscGNjxTt0wN3lGc73Pk-7PXLPMwU4dexHaRbQDRAWMw/exec?action=feedback&key=family-menu-2026"
   ```
   Returns `{"status":"ok","rows":[...]}` — each row has `timestamp`, `type`, `week_id`, `plan_feedback`, `use_up_ingredients`, etc.
2. Read `.menu-state.json` (create it with `{"last_processed_feedback_at": null}` if missing). Keep only rows where: `type` is exactly `"review_feedback"` (never `"meal_feedback"` — those are per-meal post-cook logs from the Hub's "Log" buttons — and never `"principles_update"`, which Job C handles instead; none of these should ever trigger a plan rewrite), `week_id` matches `current_week.week_id` (re-read `household.json` fresh if Job A just changed it), `current_week.status` is `"proposed"`, and `timestamp` is newer than `last_processed_feedback_at`.
3. **If nothing new:** update `.menu-state.json`'s `last_processed_feedback_at` to the newest timestamp seen (so old rows are never re-checked), commit that alone if it changed, and stop. Most runs end here — not a failure.
4. **If there's new feedback:** combine the `plan_feedback` and `use_up_ingredients` text from all new rows (oldest to newest) and:
   - Revise `current_week`'s affected day(s) to address it, respecting `household`'s preferences throughout.
   - Work newly-listed use-up ingredients into Monday–Wednesday where realistic.
   - Add a short note to `current_week.board_notes` on what changed and why.
   - Rebuild `current_week.shopping_list` to match.
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
