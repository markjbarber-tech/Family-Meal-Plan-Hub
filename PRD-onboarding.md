# PRD: New User Onboarding & Auth Journeys — Family Menu Hub

**Status:** Approved — ready for implementation. UX flow validated against an interactive mockup (see UX Reference below); this document plus the companion `IMPLEMENTATION-BRIEF.md` are the handoff package for building it.
**Owner:** Mark
**Prepared for:** Implementation via Claude Code

## UX Reference

The flow, screen sequence, field-level required/optional split, copy, and validation behavior described in Section D below have been validated against a live, click-through mockup: **https://markjbarber-tech.github.io/discoveries/**

Treat the mockup as the source of truth for *interaction and copy* — screen order, what's required vs. optional, button labels, soft-target wording ("Add a couple of recent meals..."), and validation behavior (e.g., blocking on `adults` = 0). Do **not** treat its visual styling as the source of truth: it uses an approximate glassmorphism look built without access to the real `weekly-board-design-system.md` ("Dawn Glass") spec, since that file wasn't available during mockup review. Before building, read the real design system and existing shared CSS classes (`.util-btn`, `.modal-backdrop`/`.modal`, `.stamp`, `.loading-indicator`, `day-card`/`meal-row`, etc.) and implement onboarding screens in that actual house style — see `IMPLEMENTATION-BRIEF.md` for the full build checklist.

The mockup's own source (`onboarding-ux-flow.html`, included in this handoff package) is a standalone reference build — plain HTML/CSS/JS with no dependency on the real app — useful for confirming exact copy and interaction states, but not meant to be copied in as production code.

---

## Implementation Context

- **Frontend:** NOT a framework app — a single static `index.html` file (~1,900 lines), vanilla JS in an IIFE-wrapped `<script>`, inline CSS, no build step, no bundler, no npm/package.json. Served as-is from GitHub Pages. **This materially shapes how onboarding must be implemented:** new onboarding screens should be added as additional markup/JS within this same hand-written, no-build pattern (e.g. new sections toggled by JS within `index.html`, or additional plain static HTML files linked by ordinary navigation) — not as React/Vue components or anything assuming a component framework or bundler.
- **Styling:** no component library or design-system tooling, but not fully ad hoc either — there's a documented visual spec, `weekly-board-design-system.md` ("Dawn Glass": a glassmorphism palette with a teal accent), and the CSS has a consistent-if-informal set of shared, reused classes: `.util-btn`, `.review-submit-btn`, `.modal-backdrop`/`.modal`, `.stamp` (feedback buttons), `.loading-indicator` (shared two-stage bars→gear animation), plus `day-card`/`meal-row` classes. Onboarding screens should be built by reusing these existing classes and following `weekly-board-design-system.md`, not by inventing parallel one-off styles. There's no lint rule or tooling enforcing this, so it relies on whoever implements it actually reading the existing CSS first.
- **Backend:** Supabase (Auth, Postgres with RLS).
- **AI generation:** 4 separate Deno/TypeScript Supabase Edge Functions handle the AI-generation actions (plan generation is one of them; the others likely cover things like recipe fetch/enrichment — e.g. the "Fetch recipe" button on the Meal History screen may itself call one of these). Any point in this PRD that triggers plan regeneration (notably the Completion step, and the existing "Refresh plan" action) should call the specific existing propose-week generation logic — confirm exactly which of the 4 that is before implementing (see Open Questions) rather than assuming there's only one.
- **Household/account model:** a household is a single shared Supabase login used by all parents/guardians in that family — not separate per-person accounts. Confirmed at the schema level: `households.id = auth.users.id`, so there is no invite or multi-member support underneath this at all. This simplifies the auth requirements below: there is exactly one identity to verify, link, or reset per household, and no multi-user permission model is needed for this phase (see Non-Goals). Onboarding and sign-up copy must stay consistent about this — the sign-up form already says "one shared login for your whole household"; onboarding shouldn't imply a team/invite flow that doesn't exist.
- **Current dead-end behavior:** today, a signed-in user with no `households` row hits a literal dead end — "Your account isn't set up with a household yet" — with no path forward. This PRD's trigger requirement (Section D) replaces that message with routing into onboarding; it is as much a bug fix as a new feature.

## Problem Statement

Family Menu Hub has a working meal-plan generation engine, a built auth system (Supabase email/password + Google sign-in), and in-app screens for meal history logging and meal-planning principles — but no onboarding flow. Today the product only works because Mark, its sole user so far, already understands the model implicitly. A friend signing up cold hits a blank "This week" screen with a generic plan and no explanation of what the product does, why entering their household's food preferences matters, or how to do it. Without a guided first-run experience, new users are likely to either abandon before generating any value, or use the product long-term with a low-quality, generic plan because they never discover the principles/meal-history screens that make it good. This directly blocks Mark's near-term goal of handing the product to friends.

## Goals

1. A first-time user can go from "clicks signup link" to "sees a personalized first meal plan" without external explanation from Mark.
2. Onboarding clearly communicates the value exchange — the more household/meal data provided, the better the generated plan — and this claim is made tangible, not just stated.
3. All Supabase auth entry points (email/password and Google) have complete happy-path and rainy-day coverage, so a confused or mistake-prone new user (wrong password, cancelled Google consent, expired link, etc.) always has a clear next step.
4. Onboarding reuses existing product surfaces (Principles, Meal History) rather than duplicating them, keeping one source of truth for those screens.
5. A user who chooses to skip onboarding still lands in a usable app and is nudged (not blocked) toward completing it later.

## Non-Goals

- **Invite-only signup / access gating** — signup is open to anyone with the link for this phase; an invite system is not in scope.
- **Payments/billing** — no monetization flow is part of this PRD.
- **New data-entry UI for meal history or principles** — this PRD wraps and sequences the existing screens; it does not redesign their underlying forms.
- **Multi-member household account management** (e.g., separate logins per parent within one household, per-member permissions) — confirmed out of scope: a household is one shared login used by all parents/guardians, and this phase does not change that model.
- **Non-English localization** — not addressed here.

## User Stories

**Cold sign-up (primary persona: a friend of Mark's, family with kids, has never seen the product)**
- As a new visitor, I want to understand in one glance what this product does before I sign up, so I know why I'm creating an account.
- As a new user who just verified my account, I want to be guided step by step into telling the product about my household, so I don't have to hunt for where to do that.
- As a new user, I want to see a concrete example of my plan getting better as I enter information, so I'm motivated to keep going instead of skipping.
- As a new user in a hurry, I want to skip onboarding and still get a usable (if generic) meal plan immediately, so I'm not blocked from trying the product.
- As a user who skipped onboarding, I want to be reminded later (not nagged constantly) that adding my info will improve my plan, so I can finish when I have time.
- As a new user who closed the tab partway through, I want onboarding to pick up where I left off when I come back, so I'm not stuck re-entering what I already gave it.
- As a new user finishing onboarding, I want to see a real, already-generated week (not 7 empty days or a week-long wait), so the payoff for finishing feels immediate.

**Auth edge cases (any user, any time)**
- As a returning user, I want a clear way to reset my password if I've forgotten it, so I'm not locked out.
- As a user who signed up with email/password, I want signing in with Google using the same email to just work, so I don't accidentally create a duplicate account.
- As a user who cancels the Google sign-in popup, I want to land back on a normal signup/login screen with no scary error, so I can just try again.
- As a user whose verification link has expired, I want an easy way to get a new one, so a slow inbox doesn't lock me out of the account I just created.

## Requirements

### A. Supabase Auth — Email/Password

**P0**
- Signup form: email + password (+ confirm password), client-side validation before submit (valid email format, password meets Supabase policy).
- On submit: create user via Supabase `signUp`; on success, show a "Check your email" screen (do not log the user in yet — verification required before first use, per decision).
  - *Acceptance:* Given a new email, when signup succeeds, then the user sees a confirmation screen with the email address they used and a "Resend verification email" action, and is NOT granted access to the app.
- Duplicate email on signup: Supabase returns an error for an existing, confirmed account — show inline "An account with this email already exists" with a link to the login screen and to Forgot Password. Do not reveal duplicate-email state for *unconfirmed* accounts (resend the verification email instead, without saying whether the account is new) — this avoids account enumeration.
- Verification link click: completes verification, redirects into the app. New account → onboarding. Existing account (e.g., re-clicked an old link) → straight into the app.
- Verification link expired or already used: show a clear message with a "Send a new link" action rather than a raw error.
- Resend verification: available from the "check your email" screen and from a blocked login attempt on an unverified account; rate-limited per Supabase defaults — show a cooldown message ("You can request another in 60s") rather than letting repeated clicks silently fail.
- Login with wrong password: generic "Incorrect email or password" (do not reveal which field was wrong).
- Login attempt on unverified account: block entry, show "Please verify your email first" with a resend option — do not silently fail.
- Forgot password: "Forgot password?" link on login → enter email → generic "If an account exists for this email, a reset link has been sent" message regardless of whether the account exists (avoids account enumeration) → emailed link → set new password screen → success → redirect to login (or auto-login, engineering's call).
- Expired/invalid reset link: clear message + "Request a new link" action.

**P1**
- Password strength indicator on signup (visual only, doesn't block submission beyond Supabase's own minimum).
- "Show password" toggle on password fields.

### B. Supabase Auth — Google Sign-In

**P0**
- "Continue with Google" button on both signup and login screens (same action either way — Supabase/Google sign-in doesn't distinguish).
- Happy path: user completes Google consent → redirected back → session created → new account routes to onboarding, existing account routes to the app.
- User cancels/denies the Google consent screen: return to the signup/login screen with a neutral, non-alarming message ("Sign-in was cancelled") — not a raw error.
- **Account linking when the Google email matches an existing email/password account:** per decision, this should auto-link rather than error. **Flagging for engineering:** Supabase does not auto-link identities across providers by default — this typically requires enabling manual/automatic identity linking in Supabase Auth settings (or custom linking logic keyed on verified email). Confirm current project configuration and implement explicitly; do not assume this "just works" out of the box. See Open Questions.
- OAuth provider error / network failure during the Google flow: generic "Something went wrong signing in with Google, please try again" with a retry action.

**P1**
- If the popup-based OAuth flow is blocked by the browser, fall back to a redirect-based flow with a message explaining why the screen changed.

### C. Session Handling

**P0**
- Already-authenticated user visiting `/signup` or `/login` is redirected straight into the app (not shown the auth forms again).
- Session expiry while using the app: redirect to login with "Your session expired, please sign in again" rather than a silent failure or generic error.

### D. Onboarding Flow

This section reflects a codebase read-through, not just UX design — several requirements below are dictated by the actual schema and existing code paths, not open choices. It has also been deliberately compressed from an earlier 5-6 step draft: the underlying technical requirements are unchanged, but they're now grouped into fewer user-facing screens by separating what's *required* from what's *optional-but-valuable*, and by recognizing that some "steps" (board-of-advisors seeding) need zero screen at all.

**Step sequence (P0):** Welcome → "Your household" (required counts + open-by-default optional detail, including the embedded Principles component) → "Add a few recent meals" → Completion (fully automatic — board-of-advisors seeding, first-week generation, and completion marking all happen here with no additional user input). Four screens total, only two of which require any typing.

**P0 — System behavior**
- **Trigger (routing, not a screen):** replace the current dead-end message ("Your account isn't set up with a household yet") with a router check evaluated on every authenticated page load: signed-in + no `households` row for this user → route into onboarding instead of the app shell. Applies identically to email/password and Google OAuth signups — there is no separate code path per auth method.
- **Completion signal:** `households.onboarding_completed_at` (column already exists, currently unused) is the single source of truth for "show onboarding" vs. "show the app" — NOT merely "does a `households` row exist." Set it when the Completion step's automatic work finishes.
  - *Acceptance:* Given a `households` row exists but `onboarding_completed_at` is null, when the user loads the app, then they are routed into onboarding (not the app shell), resuming rather than restarting (see below).
  - *Acceptance:* Given `onboarding_completed_at` is set, when the user loads the app, then they go straight to the app shell — onboarding is never shown again automatically.
- **Resumability:** if a `households` row exists but `onboarding_completed_at` is null (tab closed mid-flow, browser crash, "Skip for now" used, etc.), re-entering onboarding resumes from wherever they left off rather than restarting at Welcome. With only two data-entry screens, this is simpler than it was in the longer draft: no `households` row yet → start at Welcome / "Your household"; a `households` row exists (required `adults`/`kids` saved) but `onboarding_completed_at` is null → resume directly at "Add a few recent meals," regardless of how many (if any) meals were already added, since that screen has no required minimum to have "completed." Derived purely from data presence — no separate step-tracking field needed (see Open Questions, resolved by this simplification).
- **State reload on handoff into the app:** completing onboarding is the same class of transition as the account-switch bug found in this session's testing (Finding #2: switching accounts mid-session leaves stale cached state until a full reload) — a household now exists under a session that started without one. The handoff from Completion into the main app must fully re-run `loadHouseholdData()`, not patch existing in-memory state, or the same stale-state bug resurfaces at exactly this moment.
  - *Acceptance:* Given a user just completed onboarding, when they land on "This week," then all household-derived UI (plan, principles, advisors) reflects a full fresh load — none of it is left over from the pre-onboarding empty state.

**P0 — Screens**
- **Screen 1 — Welcome:** short, concrete explanation of what the product does and the value-exchange pitch ("the more you tell us about your household, the better your plan"). Primary CTA "Get started"; secondary "Skip for now" (smaller/less prominent, not hidden). Copy here must stay consistent with the sign-up form's existing "one shared login for your whole household" framing — do not imply an invite/team flow (see Implementation Context).
- **Screen 2 — "Your household":** a single screen with two visual tiers, not two separate steps.
  - **Required, always visible, top of screen:** `adults` and `kids` counts. Every generation prompt reads these directly, so an empty value would degrade every plan, not just this one.
    - *Acceptance:* attempting to continue with `adults` or `kids` empty is blocked with an inline message.
  - **Optional, open by default, below the required fields:** quick fields for `allergies_or_restrictions`, `likes`, `dislikes`, `pantry_staples`, and `use_up_this_week`, plus the existing 5-checkbox-plus-free-text Principles component from Settings, embedded here exactly as built (reused, not rebuilt or redesigned) — same underlying storage as Settings → Meal Planning Principles, no separate/duplicate data. "Open by default" means the user sees these fields immediately (not behind a collapsed "Advanced" toggle) but nothing here blocks continuing.
    - *Acceptance:* all optional fields, including the embedded Principles component, can be left blank without blocking continuation; whatever is saved here (structured fields and/or Principles text) is immediately reflected in the live preview panel.
- **Screen 3 — "Add a few recent meals":** reuses the existing "Add meal history" flow exactly as built (description required, recipe link + Fetch recipe optional, feedback Yes/Mostly/Not-really optional defaulting to Yes, optional note, Save & add another / Finish). Soft target lowered from the original draft's "3–5" to "a couple" ("Add a couple of recent meals to get started — you can always add more later") to keep the ask proportionate to this being the last thing standing between the user and their plan; still not a hard minimum-count gate. "Finish" (or "Skip for now") both proceed straight to Completion with zero or more meals added — there is no invalid state here.
- **Live preview panel:** visible throughout Screens 2 and 3 (side panel on desktop width, collapsible/expandable section on mobile width). Shows a real sample day (or few meals) that visibly updates — e.g., swaps a generic dinner for one that reflects a just-entered dietary restriction — immediately after each save action, across both the structured fields, the Principles text, and added meals. Dismissible/closeable by the user at any point without ending onboarding (closing the preview ≠ skipping onboarding).
- **Screen 4 — Completion (fully automatic, no user input on this screen):**
  - **Board of advisors seeding (silent):** nothing in the app today creates `board_of_advisors` rows for a new household — every existing household got its 5 personas via manual seeding outside the app. On reaching Completion, insert the 5 standard personas for the new household, matching the standard set used by existing households. Per the schema's own `is_customizable` flag, 2 of the 5 are customizable — for this phase, that customization is **not surfaced anywhere in onboarding**; the 2 customizable personas seed with their standard defaults and are only editable later, from Settings, exactly like any other existing household. This is a deliberate simplification from the earlier draft (which considered surfacing them as an onboarding step) in service of keeping onboarding to two data-entry screens.
    - *Acceptance:* after onboarding, a new household has exactly 5 `board_of_advisors` rows, matching the standard set used by existing households; the 2 `is_customizable` ones are unchanged from their defaults and are editable from Settings, not from anywhere in onboarding.
  - **Synchronous first-week generation:** a brand-new household has zero `weeks` rows and would otherwise wait up to a week for the Saturday propose-week cron to fire. Reuse propose-week's core generation logic directly, bypassing the Saturday/`last_proposed_date` gate the same way the existing manual force-override already does — do not duplicate that bypass logic in a new code path.
    - *Acceptance:* immediately after completing onboarding, "This week" shows a real generated plan (7 days, not empty), not a wait for the next cron firing.
  - **Completion marking and handoff:** only once advisor seeding and generation both succeed does the Completion screen show its confirmation, set `households.onboarding_completed_at`, and hand off into the app per the state-reload requirement above. Single CTA: "See my plan."
  - **If generation or seeding fails:** show a clear error with a retry action rather than silently marking completion — `onboarding_completed_at` should not be set until both have actually succeeded.
- **Skip behavior:** "Skip for now" is available on Screens 1–3. Skipping at any point ends onboarding immediately without running Completion's automatic work — no `board_of_advisors` seeded, no first week generated, `onboarding_completed_at` left null. This is deliberately the same state as "resumable, incomplete" above, so skip and "closed the tab" are the same underlying state, both handled by the resumability requirement. The existing in-app nudge banner on "This week" ("Add your family's meal history to improve meal plan generation") continues as the ongoing reminder for a skipped/incomplete household — confirm it also fires for missing Principles/structured-household/board data, not just missing meal history, since all of these can now be genuinely absent for a skipped household.

**P1**
- Step indicator (e.g., "Step 1 of 2") across the two data-entry screens (2 and 3) — lighter-weight than originally scoped now that there are only two to track, but still useful given the live preview panel already occupies visual attention.
- A lightweight animation/transition when the live preview panel updates (not just an instant swap) to draw attention to the change.
- Onboarding completion event distinguishing "completed fully" vs "skipped at step N" for analytics.
- Surfacing the 2 customizable board-of-advisors personas somewhere in onboarding (rather than deferring entirely to Settings) if early friend feedback suggests they want that control sooner — deliberately deferred for P0 per the Completion screen note above.

**P2 (future considerations — don't design against, but don't architecturally block)**
- Importing meal history from another source (e.g., photos of old recipes, a CSV).
- Multi-member household accounts (inviting a second household member with their own login) — explicitly not supported by the current `households.id = auth.users.id` schema; would require a schema change, not just a UI addition.

## Success Metrics

**Leading indicators (check within days of a friend signing up)**
- % of new signups that reach a verified, logged-in state (catches broken auth flows).
- % of verified new users who start onboarding (Screen 1 → "Get started" click rate).
- % of users who start onboarding and complete it fully vs. skip vs. abandon mid-way — target: no hard number yet given small initial cohort, but this should be instrumented from day one.
- Time from signup to first generated plan.

**Lagging indicators (check after a few weeks with friends using it)**
- % of onboarding-skippers who complete Principles or Meal History later via the in-app nudge.
- Qualitative: does Mark hear "I got stuck" or "I didn't know what to do" from any friend? (Given the small initial cohort, this direct signal likely matters more than any dashboard number — track it as informally as a group chat check-in.)

## Open Questions

- **(Engineering)** Does the current Supabase Auth configuration support automatic identity linking across providers (Google ↔ email/password) for a matching verified email, or does this need to be explicitly enabled/implemented? Confirm before building the "auto-link" requirement in section B.
- **(Product)** Is a household name/label collected anywhere at signup, or is it auto-generated (e.g., "Mark's Household") and just not surfaced yet? Doesn't block onboarding but affects whether Screen 1 or 2 should ask for it.
- **(Engineering)** Confirm which of the 4 existing Edge Functions is the one that powers "Refresh plan" today (needed for the propose-week reuse in the Completion screen's automatic generation step), and which one is the propose-week generator specifically if they're not the same function.
- **(Engineering)** Read `weekly-board-design-system.md` and the existing shared CSS classes (`.util-btn`, `.modal`, `.stamp`, `.loading-indicator`, `day-card`/`meal-row`, etc.) before building onboarding markup, so new screens extend the existing "Dawn Glass" house style rather than drift from it — there's no tooling that would catch this automatically.
- **(Engineering)** Resumability mechanism: confirmed as derived purely from data presence (see Section D) — a `households` row without `onboarding_completed_at` set always resumes at "Add a few recent meals," since that's the only remaining incomplete screen once the household row exists. No explicit step-tracking field needed. Flagging here only so engineering double-checks this holds once implemented (e.g., a household row could theoretically exist without the required `adults`/`kids` set if created some other way — confirm that can't happen outside onboarding).
- **(Engineering/Product)** Confirm the exact content (names, philosophies/descriptions) of the 5 standard board-of-advisors personas to seed, matching whatever set existing manually-seeded households already use — onboarding should not invent a different or divergent set.
- **(Product)** No firm launch date was set during scoping. Recommend engineering treats P0 as the bar for "ready to send to friends" and P1 as fast-follow.

## Timeline Considerations

- No hard external deadline identified. Recommended phasing:
  - **Phase 1 (P0):** all auth rainy-day coverage + the full onboarding sequence (routing/trigger fix, the merged "Your household" screen with its required/optional split and embedded Principles component, "Add a few recent meals," silent board-of-advisors seeding, synchronous first-week generation, completion marking, resumability, and the state-reload fix on handoff) with skip and the live preview. This is the minimum to hand the product to friends without Mark walking them through it live — and fixes a real dead-end bug along the way, not just adds a new flow.
  - **Phase 2 (P1):** step indicator, preview animation polish, password strength UI, analytics event breakdown.
  - **Phase 3 (P2):** revisit only if/when the product grows beyond a friends-and-family cohort (multi-member accounts, history import).
