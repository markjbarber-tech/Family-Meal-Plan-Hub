# The Weekly Board — Product Requirements: Defaults, Loading States & a Bug Fix

Four items scoped via stakeholder interview. Follows `weekly-board-design-system.md`, which has been updated alongside this doc with a new Motion entry for the loading component described below.

---

## Item 1: Default meal planning principles

**Context**: A household with nothing set in Settings > Meal planning principles needs sensible defaults rather than an empty list.

### Requirements
- Default principles list ships with **5 options total**, of which **3 are pre-checked**:
  - ✅ Low-cleanup/simple weeknight meals (pre-checked)
  - ✅ Balanced nutrition — protein variety, veg included (pre-checked)
  - ✅ Introduce variety across the week (pre-checked)
  - ⬜ Budget-conscious by default (available, unchecked)
  - ⬜ Kid-friendly formats prioritized (available, unchecked)
- All 5 are checkboxes the user can freely toggle on/off — the 3 "pre-checked" ones are just the shipped default state, not locked.
- A **free-text field** is also available on this same screen for the household to add any additional principle not covered by the 5 presets, matching the free-text pattern already used for the existing (non-default) household's principles.
- This applies to Settings > Meal planning principles specifically. **Out of scope for this item**: a broader new-user onboarding flow. This will surface again when onboarding (PRD Feature 5, prior document) is designed — for now, this default set is what a household with no principles configured sees on that Settings page.

---

## Item 2: Automated plan generation with no meal history

**Context**: Document how the meal plan generation behaves for a household that hasn't uploaded any meal history yet (new household, or existing one before their first upload).

### Requirements
- **No special first-week caution** — generation proceeds normally from whatever is stated in the household profile (likes/dislikes, kids' ages/notes, allergies) and the active meal planning principles (defaults or custom). There is no "safe mode" or mainstream-only constraint applied just because history is empty.
- Every dish in a plan generated with no supporting history **defaults to "new attempt" status** on its day card — this is a direct consequence of the existing proven/new-attempt computation rule (proven requires prior serving + predominantly positive feedback; with zero history, nothing qualifies as proven yet). No new logic needed here beyond confirming the existing rule degrades gracefully to this state.
- The board-of-advisors "avoid recent repeats" constraint has nothing to check against on a first generation — this is expected and not an error state; it simply has no effect until some history (via feedback or the meal history upload journey) exists.
- This state is expected to be short-lived in practice: the Plan-page prompt to upload meal history (from the prior Settings/history PRD) is precisely the nudge meant to get a household out of this state quickly.

---

## Item 3: Loading animation for long-wait journeys

### Visual component (documented in the design system)
A single reusable loading component: a soft pulsing/rippling shape in `--teal`, tying into the app's water theme, shown together with a short plain-text label describing what's happening (e.g. "Generating your plan...", "Reading that recipe...", "Signing you in..."). One component, reused everywhere a wait applies — not a different spinner per feature. Respects `prefers-reduced-motion` (falls back to a static shape + text, no pulsing).

### Journeys that use it
- Initial weekly plan generation
- Meal regeneration (the "+" button on an empty slot, Feature 1 of the prior features PRD)
- External recipe fetch — both instances: adding a recipe link to an empty meal slot (Feature 2), and the optional recipe link on a meal-history upload entry (Settings/history PRD)
- Sign-in / account creation (Feature 5 of the prior features PRD)

### Explicit exception
- **Pull-to-refresh (Feature 3, prior features PRD) does not use this component.** It keeps its existing lightweight behavior as already specified: a brief native-style indicator during the check, then a plain toast ("Updated" / "Up to date") — no dedicated branded loading animation for this one action.

---

## Item 4: Bug fix — recipe page scroll position

**Current behavior**: Tapping a meal item on the Plan page navigates to that meal's recipe view, but the view loads scrolled to the **bottom** of the page.

**Required behavior**: The recipe view must load scrolled to the **top** of the page every time it's opened, regardless of how it's reached (from a Plan-page tap, from the Recipe tab's day picker, or any other entry point).
