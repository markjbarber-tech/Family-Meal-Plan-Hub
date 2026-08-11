# Family Menu Hub — automated feedback check

This file is instructions for Claude Code to follow every time it's run on a schedule in this repo. It checks the Family Menu Hub's feedback sheet, and if the family has left new "changes/concerns" or "use up these ingredients" feedback on the currently proposed week, it rewrites the plan and pushes the update straight to GitHub Pages — no manual upload needed.

## What to do, every run

1. Run `git pull` first, in case anything changed since last time.

2. Read `household.json` in this repo. It contains: `household` (the family's people, likes, dislikes, principles), `board_of_advisors` (the meal-planning personas), and `current_week` (the week that's currently live on the Hub — its `status` field is `"proposed"` while it's still open for feedback, or `"published"` once the review window has closed).

3. Fetch the feedback sheet as JSON:
   ```
   curl -s "https://script.google.com/macros/s/AKfycbwQXFwbeGLuhF8XA08NpEiWmCRscGNjxTt0wN3lGc73Pk-7PXLPMwU4dexHaRbQDRAWMw/exec?action=feedback&key=family-menu-2026"
   ```
   This returns `{"status":"ok","rows":[...]}` — each row has `timestamp`, `type`, `week_id`, `plan_feedback`, `use_up_ingredients`, etc.

4. Read `.menu-state.json` in this repo (create it with `{"last_processed_feedback_at": null}` if it doesn't exist yet). Keep only feedback rows where:
   - `type` is exactly `"review_feedback"` (never act on `"meal_feedback"` rows — those are per-meal post-cook logs from the Hub's "Log" buttons, and must never trigger a plan rewrite)
   - `week_id` matches `household.json`'s `current_week.week_id`
   - `current_week.status` is `"proposed"` (skip entirely if it's already `"published"` — the review window is closed)
   - `timestamp` is newer than `last_processed_feedback_at`

5. **If there's nothing new:** just update `.menu-state.json`'s `last_processed_feedback_at` to the newest timestamp you saw (so old rows are never re-checked), commit that one small change if it changed, and stop. This will be the outcome most runs — that's expected, not a failure.

6. **If there is new feedback:** combine the `plan_feedback` and `use_up_ingredients` text from all new rows (oldest to newest) and:
   - Revise `current_week`'s days in `household.json` to address the feedback — respecting everything in `household.household` (dislikes, lactose intolerance, etc.) and `household.board_of_advisors`' styles.
   - Work any newly-listed use-up ingredients into Monday–Wednesday of the week where realistic.
   - Add a short note to `current_week.board_notes` saying what changed and why, so it's clear this was a feedback-driven revision.
   - Rebuild `current_week.shopping_list` to match.
   - Open `index.html` in this repo and replace its `WEEK_DATA` and `PRINCIPLES_TEXT` JS constants with the revised data (keep everything else in the file — the feedback box, the Log buttons, the recipe pages, the shopping list — exactly as it is).
   - Validate the JS is still syntactically correct: extract the `<script>...</script>` contents to a temp file and run `node --check` on it before committing.
   - Update `.menu-state.json`'s `last_processed_feedback_at`.
   - `git add household.json index.html .menu-state.json`, commit with a short message describing what changed (e.g. "Update plan: swap Tuesday dinner per feedback, add use-up ingredients"), and `git push`.

7. Print a one-line summary at the end either way (e.g. "No new feedback." or "Updated Tuesday & Wednesday dinners based on feedback, pushed to GitHub.") — this is what you'll see in your terminal or log file after each run.

## Notes

- Only `review_feedback` (the box at the top of the Hub) should ever cause a rewrite — never the per-meal Log buttons. This was an explicit requirement.
- Keep `household.json` as the single source of truth for the current week. `index.html` is generated from it, not the other way around.
- The Sheet itself (not this repo) is the permanent record of every piece of feedback ever submitted — `.menu-state.json` only needs to remember the watermark, not history.
