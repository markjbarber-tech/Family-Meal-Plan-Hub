# The Weekly Board — UX Specification

Visual direction: Dawn Glass (water palette). This document defines behavior, not styling — see `weekly-board-v2.html` for the finished visual reference.

## Navigation
Three tabs: **Plan** (default) · **Shopping** · **Recipe**. Tab state is local/ephemeral — not persisted across sessions.

## Plan tab

### Review box
**Superseded by `weekly-board-single-state-prd.md`** — there is no proposed/published `status` field any more; a week is live, editable, and open to feedback the moment it's generated, and stays that way (no separate publish step, no email draft). Current behavior:
- Always visible for the current week — not gated by any status.
- Collapsed/compact by default (a low-emphasis single-line toggle), since it's now a permanent fixture rather than a temporary review-window banner. Expands on tap to reveal the full form; collapses back on request.
- Combines three inputs behind one "Send feedback" button: free-text plan feedback, a free-text "What ingredients do you already have?" field (see `weekly-board-sticky-nav-ingredients-prd.md`), and the Budget Saver Mode toggle. Submitting is an explicit button action, not auto-save on blur.
- This submit action is the *only* thing that triggers a full-week regeneration — day-card Yes/Mostly/No feedback stamps never do (they only save that day's feedback for the proven/new-attempt computation).

### Scoreboard
- Header strip showing count of proven vs. new-attempt days for the current week.
- Computed by counting each day card's derived status (see below) — not manually set.

### Day card status (proven / new attempt)
Auto-computed per dish, not set manually:
- **Proven**: the dish (or clearly the same dish/close variant) has been served before, AND its feedback history is predominantly `"yes"` or `"mostly"`.
- **New attempt**: first time this dish has appeared, OR prior attempts have predominantly negative (`"no"`) feedback, OR it's a meaningfully different format of a previously-poor-performing dish (e.g. salmon reattempted as crumbed fingers instead of patties).
- This computation runs against the full `meal_plans` feedback history in `household_meal_data.json`, not just the current week.

### Feedback stamps (Yes / Mostly / No)
- One stamp row per day card, under the dinner line.
- **Saves instantly on tap** — no separate submit action. Writes directly to that day's feedback record in shared storage.
- Selecting a new stamp overwrites the previous selection for that day (single-select, not additive).
- Stamp state should reflect whatever was last saved when the page loads (not always blank) — read from storage on init.
- This is the same visible-to-both-parents shared record as feedback always was (i.e. no separate personal/shared distinction needed here — feedback is inherently a household record).

## Shopping tab

### Checkbox state
- **Shared/synced** across both parents' devices — use `window.storage.set(key, value, true)` (shared scope).
- Storage key should be scoped to the current `week_id` (e.g. `shopping:2026-W33`), not a single reused key — this means a new week naturally starts with everything unchecked, satisfying the "auto-reset on publish" requirement without needing an explicit reset action.
- Old weeks' shopping-list storage keys can be left as-is (no cleanup needed) — they simply stop being read once the week rolls over.

### Copy to clipboard
- Unchanged from current prototype: copies the full list (grouped by category) as plain text, reflecting current check state is not required — copy the full list regardless of what's checked (this is a "take to the store" action, not a "copy what's left" action). If a "copy only unchecked items" mode would be more useful in practice, flag it for the next iteration rather than assuming now.

## Recipe tab
- Day picker (Mon–Sun) at top, selecting which day's recipe displays below.
- Shows dinner recipe only (ingredients + method) with advisor byline, matching current prototype.
- Not in scope for this pass: lunch/snack recipes, printing/export. Flag as a possible future addition if it comes up.

## Data source
- All content (`WEEK`, `SHOPPING`) must be read from persistent storage / the household data source at load time — the hardcoded arrays in the prototype file were for visual review only and must be replaced with live data reads before this goes further.
- Empty/loading state: if no week data is found for the current period, show a simple "No plan generated yet" message in place of the day cards rather than an empty screen.

## Out of scope for this pass
- Lunch/snack recipe views
- Printing or exporting the plan
- Historical week browsing (viewing past weeks' plans from this UI)
