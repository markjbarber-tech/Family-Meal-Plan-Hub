-- regenerate-now's "anything new since this plan was generated?" gate compared feedback rows
-- against weeks.created_at -- but created_at is set once at insert and never advances, so once
-- any feedback existed after week creation, every future call would see it as "new" forever,
-- re-running (and re-billing) a full regeneration even with nothing left to incorporate.
-- last_regenerated_at is the real watermark: set on insert, then bumped at the end of every
-- successful regenerate-now call.
alter table weeks add column last_regenerated_at timestamptz not null default now();
