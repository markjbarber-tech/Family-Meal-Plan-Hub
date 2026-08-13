# The Weekly Board — Product Requirements: Sticky Navigation & Combined Ingredients Input

Two UI changes, scoped via stakeholder interview. Follows `weekly-board-design-system.md`.

---

## Item 1: Sticky tab bar

**User story**: As a user, I want to switch between Plan, Shopping, and Recipe from anywhere on the page, without having to scroll back to the top first.

### Requirements
- The Plan / Shopping / Recipe tab bar stays fixed in place as the user scrolls, on all three tabs.
- **Only the tab bar is sticky** — the header above it (title/date, settings icon) scrolls away normally and is not fixed.
- Content beneath the tab bar should have enough top padding/margin once the bar is fixed so scrolled content doesn't run underneath it.
- Standard sticky-header treatment: the bar should keep its current visual styling (glass pill, existing shadow/blur) once fixed — it shouldn't flatten or restyle itself just because it's pinned.

---

## Item 2: Combine "use-up ingredients" and "pantry ingredients" into one field

**Context**: There are currently two separate ingredient-related inputs that serve overlapping purposes:
- The review box's prompt about fridge/pantry items that need using up.
- The separate "pantry ingredients to build around" free-text field from the budget-planning feature.

These merge into a single field.

### Requirements
- Both inputs become **one field**: **"What ingredients do you already have?"**
- This lives in the same place the review box currently does — inside the "Anything to flag before this plan goes out?" review box, shown **only while the week's status is "proposed"** (same visibility rule as before; disappears once published).
- The review box's existing **"Send feedback" button** is the trigger point: when clicked, whatever is in the combined ingredients field (along with the rest of the review box's existing free-text feedback) is passed into the meal plan regeneration logic for that week.
- **Backend logic must be combined**, not just the UI: the regenerated plan should treat this field's contents the same way the old "use-up ingredients" logic worked (prioritized into the plan) — there's no longer a separate code path for "budget pantry list" vs. "use-up ingredients." One field, one downstream effect.
- **Budget Saver Mode remains a separate, distinct toggle** (unaffected by this change) — it still layers on top of whatever's in this combined ingredients field, chaining meals off shared bases when enabled. This item only merges the two *ingredient list* inputs, not the Budget Saver Mode toggle itself.

### Edge cases
- Field can be left empty — regeneration proceeds normally without any ingredient prioritization if nothing is entered.
- If the field previously (pre-merge) had separate saved values for "use-up" and "pantry" content from prior weeks, no migration behavior is specified here — this only defines the new, merged going-forward behavior.
