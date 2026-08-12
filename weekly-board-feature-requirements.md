# The Weekly Board — Product Requirements: Next Feature Set

Five features, scoped via stakeholder interview. Each section is written to be actioned directly by Claude Code. All UX must follow `weekly-board-design-system.md` (glass-card + tab shell, existing color tokens, Tabler outline icons, restrained motion, plain functional copy).

---

## Prerequisite: shopping list data model change

Features 1 and 2 both require the shopping list to track **which meal contributes which ingredient, in what quantity** — not just a flat category list as in the current prototype. Before either feature can be built:

- Each meal (dinner/lunch/snack) needs a structured ingredient list (name + quantity + unit), not just prose method text.
- The shopping list becomes a computed aggregation across all meals still in the week, summing quantities per ingredient across contributing meals.
- Removing a meal subtracts its quantity contribution per ingredient; if the resulting total is zero, the ingredient drops off the list entirely; if other meals still need it, it stays with the reduced quantity.

This is foundational — flag it as the first implementation step regardless of what order the features below are tackled in.

---

## Feature 1: Remove and regenerate a meal

**User story**: As a parent, I want to remove a planned meal from a slot — leaving it empty for a night out, or regenerating a new suggestion — without having to redo the whole week.

### UX flow
1. Each meal row (Lunch / Snack / Dinner) on a day card gets a remove action (Tabler `ti-trash`, small, only meaningfully visible on tap/hover — not cluttering the card at rest).
2. Tapping remove opens a confirmation (glass-card modal, matching design system): *"Remove [meal name] from [Day]'s [slot]?"* — Confirm / Cancel. No instant deletion.
3. On confirm: the slot becomes an empty state — a dashed-outline placeholder with a "+" button (Tabler `ti-plus`) and label like "Add a meal."
4. Shopping list recalculates immediately per the data model above: unique ingredients drop off, shared ingredients have their quantity reduced rather than removed.
5. **Empty stays empty** until the user acts — no auto-fill, no default meal assigned. This is a valid permanent state (e.g. the family is eating out).
6. Tapping "+" runs the **same full planning logic** used for the original weekly plan: board-of-advisors process, household likes/dislikes/allergies respected, avoids repeating meals already used recently (including the meal just removed).
7. The newly generated meal's ingredients are added into the shopping list aggregation (merging with existing quantities where ingredients overlap).

### Edge cases
- A day card with all three slots empty must still render correctly (not collapse or break layout).
- Regeneration must not immediately re-suggest the just-removed dish.
- If regeneration fails (e.g. no fetch available), show a clear retry state — never leave the slot in a broken/loading-forever state.

---

## Feature 2: Add a recipe from an external URL

**User story**: As a parent, I want to link a recipe I found online to a specific meal slot and have its ingredients folded into the shopping list, without retyping anything.

### UX flow
1. Only available on an **empty** slot. If a meal already occupies the slot, it must be removed first (Feature 1 flow).
2. The empty slot's "+" state offers two paths: "Generate a meal" (Feature 1) or "Add from a link."
3. User pastes a URL into a text input.
4. System fetches the page and extracts: recipe title, ingredient list (structured — name/quantity/unit where parseable). **Does not extract, store, or paraphrase the method text** — copyright constraint.
5. **Preview shown before committing**: title, ingredient list, source link — "Add this recipe?" Confirm / Cancel.
6. On confirm: the slot fills with the recipe title and ingredient list. The in-app recipe view for that meal shows the ingredients plus a prominent "View full recipe" link out to the original source for the method — no method steps rendered in-app.
7. Shopping list updates per the shared data model (merges with existing week ingredients).

### Edge cases
- URL isn't a recipe page, or the site blocks fetching: show an error state — "Couldn't read that page — try a different link, or generate a meal instead" — never a silent failure.
- Vague quantities in the source ("a pinch of salt") are still added best-effort; don't block on unparseable quantities.
- A newly added external recipe has no feedback history yet — it defaults to "new attempt" status on the day card (not "proven") until feedback comes in.

---

## Feature 3: Pull-to-refresh for app updates

**User story**: As a user, I want to pull down to make sure I'm on the latest version of the app.

### UX flow
1. Standard native pull-to-refresh gesture, available on **all three tabs** (Plan, Shopping, Recipe).
2. This checks for **app code/UI updates only** — it is explicitly not a data refresh (plan/shopping/feedback data refresh through normal load/storage reads, unrelated to this gesture).
3. On trigger: brief loading indicator (matching glass aesthetic), then a check against the backend for the latest deployed version.
4. **Always show a brief confirmation**, whichever the outcome:
   - Update found → app reloads latest code, then a plain toast like "Updated."
   - Already current → a plain toast like "Up to date."
5. Network failure during the check: a brief "Couldn't check for updates" message — never blocks the UI or leaves a stuck spinner.

### Edge cases
- Must not interfere with normal scroll behavior — respect standard pull-to-refresh gesture thresholds so it doesn't trigger accidentally.

---

## Feature 4: Budget-conscious ingredient reuse

**User story**: As a budget-conscious parent, I want to plan meals around ingredients I already want to use, and optionally turn on a mode that deliberately chains meals together to shrink the shopping list.

### Two mechanisms, usable together
1. **Pantry ingredient list** — free-text field where the user lists ingredients on hand or that they want the week built around (e.g. "chicken thighs, capsicum"). This constrains what meal generation reaches for.
2. **Budget Saver Mode** — a per-week toggle (off by default, does not persist as a standing preference — re-set each week). When on, meal generation deliberately chains a shared base across two or more meals that week (e.g. bolognese sauce Monday → lasagna Wednesday; roast beef Sunday → cottage pie Tuesday), reducing the number of distinct grocery items needed.

### UX flow
- Both controls live on the Plan tab, alongside the review box (same "before this week is finalized" input area).
- Both apply to: (a) the initial weekly plan generation, and (b) any individual meal regenerated later via Feature 1's "+" button — a regenerated meal should still respect that week's active pantry list and Budget Saver Mode setting.
- These are best-effort constraints, not hard guarantees — generation should prioritize using listed ingredients and chaining meals, but not sacrifice household likes/dislikes/allergies to force it.

### Edge cases
- If a listed pantry ingredient conflicts with a stated allergy/dislike (e.g. lists an ingredient a child is allergic to), flag it back to the user rather than silently ignoring or silently including it.

---

## Feature 5: Multi-tenant user profiles

**User story**: As a new family, I want to sign up, set up my own household's preferences, and have a private meal-planning space separate from anyone else using the app.

### Authentication
- Supported methods: email/password, Google sign-in, Apple sign-in, and passkey.
- Forgot-password flow: request reset → email sent with a secure reset link → user sets new password. Standard security practices (link expiry, single-use token) apply — not further specified here, follow standard practice.

### Account structure
- **One shared login per household** (not per individual parent) — matches the current single-household usage pattern. Both parents use the same account/login.
- Full data isolation between households — no household can see another's plans, preferences, feedback, or board of advisors.

### Onboarding flow for a new household
1. Create account (any supported auth method).
2. Household setup: adults' names, kids' names/ages, dietary restrictions/allergies, food likes/dislikes.
3. Planning principles: capture the household's own meal-planning principles (equivalent to the existing `key_principles` data).
4. Board of advisors setup:
   - Starts from the same 5-persona template used today: The Weeknight Realist, The Flavor Explorer, The Veg-Forward Stylist, The Child Nutritionist, The Family GP/Dietician.
   - **The Weeknight Realist, The Child Nutritionist, and The Family GP/Dietician stay fixed** — not user-customized.
   - Ask the new household about favorite chefs, cookbooks, food blogs, or cooking influencers they lean on for meal planning.
   - Use those answers to inform/re-flavor **The Flavor Explorer and The Veg-Forward Stylist** specifically — shifting their stated philosophy toward the household's actual cuisine/approach leanings (e.g. a household naming a lot of Southeast Asian cooking influences should see that reflected in those two personas' philosophy text).

### Migration note
- The existing household (Mark & Genevieve) becomes the first account under this system. Their existing data (household profile, principles, board of advisors, meal plan history) becomes that account's data on migration — exact migration mechanics are an implementation detail for Claude Code to determine, not specified further here.
- Architecture implication: the current model of a single public, no-login artifact link no longer fits once multiple private households exist — each household's Weekly Board needs to sit behind their own login rather than being a single shared public URL.

### Edge cases
- Passkey and password/social sign-in must be able to coexist on the same account (a user may set up a passkey later, not just at signup).
- New household's board-of-advisors customization step should feel optional/skippable — a family with no strong opinions on cooking influences should still get a sensible default (the unmodified 5-persona template) rather than being blocked from finishing onboarding.

---

## Suggested build order (not mandated, just a dependency note)

1. Shopping list data model change (prerequisite for 1 and 2)
2. Feature 1 (remove/regenerate)
3. Feature 2 (external recipe) — builds on the same empty-slot mechanic as Feature 1
4. Feature 4 (budget reuse) — plugs into the same generation logic Feature 1's "+" button uses
5. Feature 3 (pull-to-refresh) — independent, can be done anytime
6. Feature 5 (multi-tenant profiles) — largest architectural change, best done once the above are stable since it affects how all of them store and scope data
