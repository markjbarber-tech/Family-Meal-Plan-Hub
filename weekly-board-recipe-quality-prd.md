# The Weekly Board — Product Requirements: Recipe Completeness Check & Time Estimates

Two related requirements for any recipe the app generates. Follows `weekly-board-design-system.md`.

---

## Requirement 1: Ingredient completeness check

**Context**: A real bug surfaced where a generated recipe's method called for "4 cups cold cooked rice," but rice never appeared in the ingredients list at all — so the shopping list and the cook were both missing it.

### Requirement
Before any generated recipe is saved or shown to the user, it must pass a completeness check:
- **Every ingredient named or implied in the method must appear in the ingredients list with a quantity.** Nothing should show up mid-method that wasn't listed up front.
- **Componentized / prep-ahead ingredients** — something that itself needs to be made or prepped in advance (like cold cooked rice for a fried rice dish, which needs to be cooked and cooled, ideally the day before, not made fresh in the same session) must be called out as its own early method step with its own timing, not silently assumed as a ready-to-use ingredient. E.g. "The day before: cook 4 cups rice and refrigerate uncovered so it dries out and separates." Don't let a recipe imply same-day prep for something that actually needs lead time.
- **Also surface it on the day-before plan itself, not just inside the recipe.** When a recipe has a prep-ahead step, the *previous* day's card on the Plan tab should show a short callout (e.g. Wednesday's card: "For tomorrow: cook 4 cups rice and refrigerate") so the household sees it while looking at that day, not only if they happen to open the next day's recipe in advance. This needs a `prep_ahead_note` field on the recipe (short instruction text, omitted if not applicable) that the Plan tab checks when rendering each day card — look one day ahead, and if that day's dinner has a `prep_ahead_note`, render it as a small callout on the current day's card.
  - **Edge case**: if Monday's dinner needs day-before prep, there's no prior-day card in the current week to show it on. Don't try to solve this by reaching into a previous week's data — instead, this is a case for the "review box" plain-text feedback/notes area to flag to the household directly when it comes up, since there's no natural UI slot for it otherwise.
- **Quantities implied but not stated** must be filled in — if a method step says "toss in the greens" but the ingredients list just says "spinach" with no amount, that's a failure of this check.

### Where this applies
- Initial weekly plan generation.
- Individual meal regeneration (the "+" button on an empty slot).
- Any other path that generates a full recipe (method + ingredients) from scratch.
- **Does not apply** to the external-recipe-via-URL feature — that feature only pulls an ingredient list from the source page and doesn't generate a method in-app, so there's no method to cross-check against.

### Implementation note
This should run as an explicit validation step on the generated recipe object before it's persisted or rendered — not just relied on as a byproduct of the generation prompt being careful. If a completeness check is feasible to implement programmatically (e.g. checking that every ingredient string referenced in method text has a corresponding ingredients-list entry), do that; otherwise this should be enforced through the generation step's own prompting/self-review before returning a result.

---

## Requirement 2: Prep time and cook time estimates

### Requirement
Every generated recipe includes a time estimate, broken into two figures — not a single combined number:
- **Prep time** — chopping, measuring, mixing, anything before heat is applied.
- **Cook time** — from first heat to plated.
- **Optional: hands-off time** — for a genuine passive period (marinating, dough resting, unattended oven roasting), note it separately rather than folding it into cook time as if it were active work. E.g. "Prep: 20 min · Cook: 10 min · Plus 25 min dough resting."

### Data model
Add to the recipe object: `prep_time` (string, e.g. `"15 min"`), `cook_time` (string), `hands_off_time` (string, optional — omit the field entirely if not applicable, don't send an empty string).

### Display
Shown on the recipe view, near the title/byline — a small, low-emphasis label (e.g. "Prep: 15 min · Cook: 25 min"), not a prominent banner. If `hands_off_time` is present, append it after cook time (e.g. "Prep: 20 min · Cook: 10 min · Plus 25 min resting").

### Where this applies
Same scope as Requirement 1 — anywhere the app generates a full recipe. The external-recipe-via-URL feature is a partial exception: if the source page states a prep/cook time, carry it over; if it doesn't, don't fabricate one.
