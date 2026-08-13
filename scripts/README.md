# One-off scripts

Not part of the live app — these ran once, on 2026-08-13, to migrate the
existing household (Mark & Genevieve) from `household.json` + the Google
Sheet feedback history into Supabase, as the first step of the Feature 5
multi-tenant re-platform.

- `migrate_household.py` — reads `household.json` and a feedback export
  (pulled from the old Apps Script `action=feedback` endpoint), inserts
  households/board_of_advisors/favourites/weeks/meals/feedback rows for a
  given household UUID (an existing `auth.users` id — the script never
  creates accounts or handles passwords, only populates data for an
  account that already signed up through the app's normal flow).
- `verify_migration.py` — diffs the inserted Supabase rows back against
  `household.json` to confirm nothing was dropped or mistyped.

Kept as a record of how the migration was done, not meant to be re-run.
