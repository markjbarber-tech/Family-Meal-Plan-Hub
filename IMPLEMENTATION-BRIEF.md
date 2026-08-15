# Implementation Brief: New User Onboarding — Family Menu Hub

**For:** Claude Code, working directly in the Family Menu Hub repository
**Companion documents:** `PRD-onboarding.md` (full requirements, acceptance criteria, open questions) and `onboarding-ux-flow.html` (reference mockup, also live at https://markjbarber-tech.github.io/discoveries/)

This brief is the practical build guide — it sequences the work, points at exactly what to reuse vs. build new, and gives a testable checklist. `PRD-onboarding.md` is the authoritative spec if anything here seems to conflict with it; this document exists to make that spec actionable, not to replace it.

---

## 0. Before writing any code

Read these first — several requirements below depend on what they say, and guessing instead of reading them is exactly the kind of drift this brief is trying to prevent:

1. **`weekly-board-design-system.md`** (the "Dawn Glass" spec) — the reference mockup does NOT follow this; it's an approximation built without access to this file. Every visual decision in the mockup (blur amounts, colors, card style) should be re-derived from the real spec, not copied from the mockup's CSS.
2. **The existing shared CSS classes in `index.html`** — `.util-btn`, `.review-submit-btn`, `.modal-backdrop`/`.modal`, `.stamp`, `.loading-indicator`, `day-card`/`meal-row`. Onboarding screens should extend these, not introduce parallel one-off styles.
3. **The existing "Add meal history" component's exact markup/JS** — Screen 3 reuses this as-is; know its current structure before wrapping it in an onboarding shell.
4. **The existing 5-checkbox-plus-free-text Principles component in Settings** — Screen 2 embeds this exactly as built.
5. **The propose-week generation logic and its existing force-override bypass** — the Completion step reuses this directly; find the existing bypass code path before writing a new one.
6. **The `households`, `board_of_advisors`, and `weeks` table schemas** — confirm column names/types match what's assumed below (`adults`, `kids`, `allergies_or_restrictions`, `likes`, `dislikes`, `pantry_staples`, `use_up_this_week`, `onboarding_completed_at`, `board_of_advisors.is_customizable`).
7. **Which of the 4 Supabase Edge Functions powers "Refresh plan"** — needed for the Completion step's synchronous generation call. See PRD Open Questions.

## 1. Suggested build order

The PRD marks all of this P0, but it doesn't all need to land in one PR. A sensible sequence, each step independently testable:

1. **Trigger/routing fix** — replace the "Your account isn't set up with a household yet" dead end with the router check (signed in + no `households` row → onboarding). This alone fixes a real bug even before any onboarding screens exist.
2. **Screen 1 (Welcome)** — static, no data dependencies, good first screen to get the visual style right on.
3. **Screen 2 ("Your household")** — required adults/kids steppers + optional quick fields + embedded Principles component + live preview panel. This is the biggest single screen; the mockup's `renderHousehold()`/`saveHousehold()` functions show the exact field set and validation behavior to mirror (structurally, not visually).
4. **Screen 3 ("Add a few recent meals")** — thinnest screen since it's mostly wrapping the existing Add-meal-history component with onboarding framing and copy.
5. **Screen 4 (Completion)** — the highest-risk screen: silent advisor seeding, synchronous generation reusing the force-override bypass, `onboarding_completed_at` write, and the full `loadHouseholdData()` reload on handoff. Build and test this against a household that already has Screen 2/3 data saved (via steps 3-4 above) before wiring the full end-to-end flow.
6. **Resumability + skip** — once all four screens exist, add the resume-point logic (no `households` row → Welcome/Screen 2; `households` row exists, `onboarding_completed_at` null → Screen 3) and skip behavior.
7. **Auth rainy-day coverage (Sections A/B/C)** — can be built in parallel with the above; independent of the onboarding screens themselves. Prioritize the Google auto-link investigation (Open Questions) early since it may require a Supabase Auth settings change, not just app code.

## 2. Screen-by-screen build notes

### Screen 1 — Welcome
- Static content, two CTAs (`Get started`, `Skip for now`).
- Copy must stay consistent with the sign-up form's "one shared login for your whole household" framing — see PRD Implementation Context.
- No acceptance criteria beyond routing correctly to Screen 2 or ending onboarding (skip).

### Screen 2 — "Your household"
- **Required tier (top):** `adults`, `kids` — steppers, not free text. Block continue with an inline message if `adults` isn't set (the mockup treats "at least 1 adult" as the required condition; `kids` may legitimately be 0).
- **Optional tier (open by default, not collapsed):** quick fields for `allergies_or_restrictions`, `likes`, `dislikes`, `pantry_staples`, `use_up_this_week`, plus the embedded Principles component (same underlying storage as Settings — no duplicate data path).
- **Live preview panel:** updates after each save action across this screen and Screen 3. Reference mockup's `saveHousehold()` shows the update-on-save interaction pattern (not the specific sample data, which was illustrative).
- Acceptance criteria: see PRD Section D, Screen 2.

### Screen 3 — "Add a few recent meals"
- Wraps the existing Add-meal-history flow unchanged (description required, recipe link + Fetch recipe optional, feedback Yes/Mostly/Not-really optional defaulting to Yes, optional note, Save & add another / Finish).
- Soft-target copy: "Add a couple of recent meals to get started — you can always add more later." Not a hard minimum — zero meals is a valid way to reach Completion.
- Acceptance criteria: see PRD Section D, Screen 3.

### Screen 4 — Completion (fully automatic)
- On arrival, in order: seed 5 `board_of_advisors` rows (standard set, `is_customizable` personas get their defaults, not surfaced in onboarding UI at all) → synchronously generate the first week (reuse propose-week logic + existing force-override bypass) → only after both succeed, set `households.onboarding_completed_at` and show the confirmation screen.
- On failure of either seeding or generation: show a clear error with retry; do **not** set `onboarding_completed_at`.
- Handoff CTA ("See my plan") must trigger a full `loadHouseholdData()` re-run, not an in-place state patch — see PRD's state-reload requirement (Finding #2 parallel).
- Acceptance criteria: see PRD Section D, Screen 4.

## 3. Testing checklist

Pulled directly from the PRD's acceptance criteria — use this as a literal checklist before calling onboarding done:

- [ ] Signed-in user with no `households` row is routed into onboarding, not shown the old dead-end message.
- [ ] `households` row exists + `onboarding_completed_at` null → routed into onboarding (resuming, not restarting).
- [ ] `onboarding_completed_at` set → routed straight to the app shell, onboarding never shown again automatically.
- [ ] Continuing past Screen 2 with `adults` unset is blocked with an inline message; all other fields can be left blank.
- [ ] Data saved on Screen 2 (structured fields + Principles text) matches Settings → Meal Planning Principles with no duplicate storage.
- [ ] Live preview panel updates after each save on Screens 2 and 3.
- [ ] Screen 3 accepts zero meals and still proceeds to Completion via "Finish" or skip.
- [ ] After Completion, a new household has exactly 5 `board_of_advisors` rows matching the standard set, with the 2 `is_customizable` ones at their defaults and editable only from Settings.
- [ ] Immediately after Completion, "This week" shows a real 7-day generated plan — not empty, not waiting for the next cron.
- [ ] Landing on "This week" post-onboarding reflects a full fresh `loadHouseholdData()` — nothing left over from the pre-onboarding empty state.
- [ ] "Skip for now" on any of Screens 1–3 ends onboarding immediately with no advisors seeded, no week generated, `onboarding_completed_at` left null.
- [ ] A skipped/incomplete household re-entering onboarding resumes at the correct screen (Welcome/Screen 2 if no `households` row; Screen 3 if the row exists but `onboarding_completed_at` is null).
- [ ] The in-app nudge banner on "This week" fires for missing Principles/structured-household/board data, not just missing meal history.
- [ ] Auth rainy-day paths (Sections A/B/C) each produce the specific message/action described in the PRD, not a generic error.

## 4. Explicit non-goals (don't build these)

Per the PRD's Non-Goals — flagging here so scope doesn't creep during implementation:

- No invite/multi-member household support (schema is single-login-per-household; out of scope).
- No new data-entry UI for meal history or Principles — wrap and sequence what exists.
- No payments/billing flow.
- No surfacing of the 2 customizable board-of-advisors personas anywhere in onboarding (deferred to Settings, P1 at earliest).
- No localization.

## 5. Open questions to resolve during implementation, not before

These don't need to block starting work, but need answers before the relevant piece ships — see PRD Open Questions for full context:

- Which Edge Function is the propose-week/"Refresh plan" generator (needed for Completion).
- Whether Supabase Auth is currently configured for cross-provider identity auto-linking (needed for Section B).
- Exact content of the 5 standard board-of-advisors personas to seed (match the existing manually-seeded set — don't invent a new one).
- Whether a household name/label is collected anywhere today (doesn't block P0, affects Screen 1/2 copy only).
