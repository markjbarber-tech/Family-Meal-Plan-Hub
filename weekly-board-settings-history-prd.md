# The Weekly Board — Product Requirements: Settings Page & Meal History Upload

Two related features, scoped via stakeholder interview. Follows `weekly-board-design-system.md` (glass-card shell, existing color tokens, Tabler outline icons, restrained motion, plain functional copy).

---

## Feature 1: Settings page

**User story**: As a user, I want a dedicated settings page where I can manage the household's meal planning principles, accessed consistently from anywhere in the app.

### UX flow
1. A settings icon (Tabler outline, gear or profile-style icon — implementer's choice, consistent with existing icon sizing/color rules) sits top-right, present on **all tabs** (persistent header element, not per-tab).
2. Tapping it opens the Settings page. This is a new top-level view, not one of the existing three tabs — it replaces the current view (standard "navigate to settings" pattern, e.g. slide-in or full swap), with a clear way back (back arrow or close icon, top-left).
3. **Meal planning principles move here** from wherever they currently live — this becomes their sole home, editable in place on this page.
4. Settings page should be built with room to grow — this PRD only specifies principles living here now, but the page itself is the intended home for future settings (e.g. board of advisors editing, household profile, budget mode defaults) as those get built. Structure it as a page with distinct sections rather than a single flat form, so new sections can be added later without a redesign.

### Edge cases
- Settings icon must remain visible/reachable regardless of which tab the user is on or how far they've scrolled (fixed/sticky header position).
- Navigating away from Settings without saving an in-progress principles edit should not silently lose changes — standard save/confirm pattern applies (implementer's discretion on exact mechanism, e.g. autosave on blur vs. explicit save button, but data loss on accidental navigation is not acceptable).

---

## Feature 2: Meal history upload journey

**User story**: As a user, I want to add our family's past meals — including ones that predate this app — so the system has a richer picture of what's worked and what hasn't, without having to maintain a separate spreadsheet.

This replaces the current manual Google Sheet import process with an in-app free-text journey, accessible from Settings.

### Entry point
- A new section within the Settings page: "Meal history."
- A **prompt on the main Plan page** invites users into this journey (e.g. a dismissible-looking but persistent banner/card: "Add your family's meal history to improve meal plan generation" with a link into the upload journey).
- This prompt **stays visible until at least one meal has been uploaded**, then stops appearing — it is not a one-time dismissible notice.

### Upload flow (sequential, one meal at a time)
1. User starts the journey (from Settings or from the Plan-page prompt).
2. A form for one meal:
   - **Description** (free text, required) — what the meal was.
   - **Recipe link** (optional) — if provided, the system fetches the page and pulls ingredients into the meal's record, following the **same extraction rules as the external-recipe feature** (Feature 2 of the previous PRD): ingredients only, no reproduction of method text, method stays a link to the source.
   - **Feedback** (optional) — quick-tap Yes / Mostly / No stamps (same component as the Plan tab), **plus an optional free-text field** for more detail. If no feedback is given at all, **assume the meal was successful** (equivalent to a "Yes").
3. After submitting one meal, the user can immediately add another — same blank form appears. This repeats for as many meals as they want to add in one sitting.
4. A **Finish** button is available at any point (not just after a fixed number of entries) to end the session.
5. On Finish: user is taken back to the **main meal plan page** (Plan tab), and a dismissible pop-up appears explaining that:
   - This new information will be used to inform **next week's** automatically generated plan.
   - If they'd like the **current** week's plan to incorporate this new info instead of waiting, the pop-up tells them how to trigger that (i.e. pointing them to the existing "+" regenerate action per meal, or however regeneration is surfaced — implementer should reuse the existing regeneration mechanism rather than inventing a new one).

### Data handling
- Each uploaded historical meal is stored in the same underlying meal/feedback history data used for regular weekly feedback.
- **Uploaded meal history feeds into the proven/new-attempt status computation identically to regular weekly feedback** — no separate, lesser-weighted category. A dish uploaded via this journey with positive feedback should be just as eligible for "proven" status as one tracked through a normal week.

### Edge cases
- Recipe link fetch failure (blocked site, not a recipe page, etc.): same graceful error handling as the external-recipe feature — don't block saving the meal entry itself; the description and feedback should still save even if the link couldn't be parsed. Let the user know the link couldn't be read, and let them proceed without it.
- No artificial cap on number of meals added in one sitting or over time.
- A meal entered with only a description and no feedback and no link must still save successfully (description is the only required field).
