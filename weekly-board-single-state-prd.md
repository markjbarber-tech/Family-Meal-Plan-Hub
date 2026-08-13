# The Weekly Board — Product Requirements: Single Plan State (Remove Propose/Publish)

Scoped via stakeholder interview. This is an architectural change affecting several existing features — read alongside `weekly-board-ux-spec.md` and `weekly-board-sticky-nav-ingredients-prd.md`, both of which reference the old proposed/published model that this document supersedes.

---

## Summary of the change

Today there are two distinct automated stages — **propose** (Sat 9am) and **publish** (Sun 9am) — with an email draft in between for the household to review. This is replaced with **one state**: a week's plan is generated on schedule, is immediately live and editable, and stays that way. There is no proposed/published distinction, and no email draft.

---

## Requirements

### Scheduling
- The weekly auto-generation trigger stays on its existing schedule (the current Saturday-morning generation) — **only the separate publish step is removed**, not the generation schedule itself.
- The moment a week is generated, it is live: viewable, editable (per the remove/regenerate meal feature), and open to feedback immediately. No waiting period, no separate "go live" action.

### Email draft removal
- The Gmail draft-creation step is removed entirely from the workflow.
- **No replacement notification of any kind** — the app itself is the only interface; nothing pings the household when a new week is generated. They check the app.

### Status field
- The `status: "proposed" | "published"` field on a week's data goes away — there is no status field governing visibility or editability for the current week. (Past weeks, once superseded by a new week's generation, become read-only history — see "Scope boundary" below — but that's a different concept from the old proposed/published pair, and not itself called a "status" gate.)

### Ingredients/feedback box visibility
- The "What ingredients do you already have?" box (from the sticky-nav/combined-ingredients PRD) is **always visible** for the current week — no longer gated by a "proposed" status, since that status no longer exists.
- Since it's now always present rather than a temporary review-window element, it needs a **visually smaller/simpler treatment** than its current review-box presentation — implementer's call on exact sizing, but it should read as a persistent, low-emphasis input (e.g. collapsed/compact by default, or visually lighter weight), not a prominent banner sitting permanently at the top of the Plan tab.

### What triggers regeneration
- **Only the ingredients/feedback box's submit action** ("Send feedback" button) triggers a full-week regeneration.
- Day-card Yes/Mostly/No feedback stamps do **not** trigger any regeneration — they continue to just save that day's feedback (feeding the proven/new-attempt status computation, as already specified) and nothing more.

---

## Scope boundary — what this document does NOT redefine
- The "browse previous meal plans" feature (flagged earlier as a future feature, not yet scoped) will be where "what happens to a week once it's no longer current" gets properly defined. This document only removes the proposed/published mechanism for the *current* week — it doesn't specify historical-week behavior beyond noting that a superseded week naturally becomes past/read-only once a new one is generated.
- The remove/regenerate-a-meal feature (Feature 1, prior features PRD) and the external-recipe feature (Feature 2) are unaffected by this change — they already operate on "the current week" without depending on proposed/published status.
