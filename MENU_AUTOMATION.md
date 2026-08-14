# Family Menu Hub — automation (retired)

This file used to be live instructions for a scheduled `claude -p` invocation (see the
`crontab` entry running every 3 hours) that did three jobs against `household.json` and a
baked `WEEK_DATA` constant in `index.html`, then `git push`ed the result to GitHub Pages.

That architecture is gone. The app re-platformed onto Supabase across several sessions in
August 2026 (see `legacy/Code.gs.snapshot` for the old backend this superseded, and
`supabase/functions/` for what replaced it) — `index.html` now reads and writes live from
Supabase, RLS-scoped per signed-in household, and no longer has anything to bake or push. All
three of this file's original jobs now have Supabase-native equivalents that need no external
trigger at all:

- **Job A (weekly proposal)** → `supabase/functions/propose-week`, scheduled directly inside
  Supabase via `pg_cron` + `pg_net` (see `supabase/migrations/20260814010000_schedule_propose_week.sql`).
  Runs every 3 hours, gates internally on "is it Saturday in Sydney for this household, and have
  we already proposed today," and rolls the current week into history + drafts a fresh one via
  Claude when it fires for real.
- **Job B (feedback watch)** → retired outright, not replaced 1:1. The Hub's "🔄 Refresh plan"
  button now calls `supabase/functions/regenerate-now` synchronously and does the same revision
  on demand — there's no separate periodic watcher needed since the family can just click it.
- **Job C (principles update watch)** → retired outright. Principles edits on the Hub's Settings
  page write straight to `households.key_principles` in Supabase the instant they're saved —
  there's nothing left to "apply" on a delay.

If this file is still being invoked by a scheduler when you're reading this, that scheduler
itself is the one remaining piece of the old pipeline — the crontab entry running
`claude -p "Follow the instructions in MENU_AUTOMATION.md exactly."` every 3 hours is no longer
doing anything useful and should be removed (`crontab -e`), since nothing in this file describes
real work anymore.
