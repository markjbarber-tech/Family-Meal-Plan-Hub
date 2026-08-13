# Legacy backend snapshot

`Code.gs.snapshot` is a byte-exact copy of the Google Apps Script backend's `Code.gs`
source, pulled directly from the Monaco editor on 2026-08-13, ahead of the Feature 5
multi-tenant re-platform (see `weekly-board-feature-requirements.md`, Feature 5).

**This file is reference-only — it is not executed anywhere and nothing loads it.**
The live backend continues to run from the Apps Script project itself
("Family Meal Plan Hub Feedback") until it's decommissioned as part of that
re-platform. This snapshot exists so the hand-tuned AI prompt text (board-of-advisors
persona voice, ingredient-completeness checking, prep/cook time estimation,
external-recipe extraction, etc.) has a durable, version-controlled ground truth to
port from when that logic moves to Supabase Edge Functions — the prompts describe
requirements the app's PRDs asked for, but their exact tuned wording only ever
existed in the Apps Script editor until now.
