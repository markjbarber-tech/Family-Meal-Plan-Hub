# Family Menu Hub — automation

This file is instructions for Claude Code to follow every time it's run on a schedule in this repo. It does TWO jobs, both fully automatic, both ending in a `git push` straight to GitHub Pages — no manual upload, ever.

- **Job A — weekly proposal**: once a week, draft next week's meal plan and push it live.
- **Job B — feedback watch**: any time, check whether the family has left "changes/concerns" or "use up these ingredients" feedback on the Hub, and if so, revise the current plan and push the update.

Run both jobs, every time this file is invoked (every 3 hours). Each is independent — do Job A's check first, then Job B's check, regardless of what happened in the other.

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
2. Read `.menu-state.json` (create it with `{"last_processed_feedback_at": null}` if missing). Keep only rows where: `type` is exactly `"review_feedback"` (never `"meal_feedback"` — those are per-meal post-cook logs from the Hub's "Log" buttons and must never trigger a rewrite), `week_id` matches `current_week.week_id` (re-read `household.json` fresh if Job A just changed it), `current_week.status` is `"proposed"`, and `timestamp` is newer than `last_processed_feedback_at`.
3. **If nothing new:** update `.menu-state.json`'s `last_processed_feedback_at` to the newest timestamp seen (so old rows are never re-checked), commit that alone if it changed, and stop. Most runs end here — not a failure.
4. **If there's new feedback:** combine the `plan_feedback` and `use_up_ingredients` text from all new rows (oldest to newest) and:
   - Revise `current_week`'s affected day(s) to address it, respecting `household`'s preferences throughout.
   - Work newly-listed use-up ingredients into Monday–Wednesday where realistic.
   - Add a short note to `current_week.board_notes` on what changed and why.
   - Rebuild `current_week.shopping_list` to match.
   - Regenerate `index.html` the same way as Job A step 6, and validate with `node --check` the same way as Job A step 8.
   - Update `.menu-state.json`.
   - `git add household.json index.html .menu-state.json`, commit with a message describing what changed, `git push`.

## Always finish with

One short summary line covering both jobs, e.g. "No proposal due, no new feedback." or "Proposed week of Aug 17–23. No new feedback." or "No proposal due. Updated Tuesday & Wednesday dinners per feedback, pushed."

## Notes

- `household.json` is the single source of truth. `index.html` is always generated from it, never edited by hand.
- The Google Sheet is the permanent record of every feedback submission ever made — `.menu-state.json` only needs the watermark.
- Only `review_feedback` triggers a rewrite, never `meal_feedback`.
