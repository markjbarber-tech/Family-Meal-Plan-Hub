-- The Weekly Board — multi-tenant schema (Feature 5, weekly-board-feature-requirements.md)
--
-- One row per household in `households`, keyed directly by the Supabase auth user id
-- (households.id = auth.uid()). This matches the PRD's "one shared login per household"
-- requirement with no separate membership table: both parents share one auth.users row,
-- so household.id *is* that row's id.
--
-- Every table is RLS-scoped to auth.uid() (directly, or via a join up to `weeks` for
-- `meals`, which has no household_id column of its own). This RLS boundary is the real
-- privacy enforcement for this app going forward — it replaces the old shared static
-- READ_KEY string, which was explicitly "a light lock, not real security."

create table households (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  household_name text,
  adults jsonb not null default '[]',
  kids jsonb not null default '[]',
  allergies_or_restrictions jsonb not null default '[]',
  key_principles jsonb not null default '[]',
  likes jsonb not null default '[]',
  dislikes jsonb not null default '[]',
  pantry_staples jsonb not null default '[]',
  use_up_this_week jsonb not null default '[]',
  last_board_review_date date,
  last_proposed_date date,
  onboarding_completed_at timestamptz
);

create table board_of_advisors (
  household_id uuid not null references households(id) on delete cascade,
  persona_key text not null,
  name text not null,
  philosophy text not null,
  is_customizable boolean not null,
  primary key (household_id, persona_key)
);

create table favourites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  authored_by text,
  recipe jsonb not null,
  saved_at timestamptz not null default now(),
  requested_for_next_week boolean not null default false
);

create table weeks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  week_id text not null,
  date_range text not null,
  pantry_ingredients jsonb not null default '[]',
  budget_saver_mode boolean not null default false,
  board_notes text,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_current_week_per_household
  on weeks (household_id) where (is_current);

create table meals (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  day text not null,
  slot text not null,
  name text,
  ingredients jsonb not null default '[]',
  method jsonb,
  source jsonb,
  new_or_repeat text,
  authored_by text,
  prep_time text,
  cook_time text,
  hands_off_time text,
  prep_ahead_note text,
  unique (week_id, day, slot)
);

create table week_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  week_id text not null,
  date_range text not null,
  dinners jsonb not null,
  archived_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  type text not null,
  week_id text,
  day text,
  meal text,
  meal_name text,
  kids_ate_it text,
  parent_rating int,
  note text,
  plan_feedback text,
  pantry_ingredients text,
  budget_saver_mode boolean,
  source_url text,
  ingredients_json jsonb,
  created_at timestamptz not null default now()
);
create index feedback_household_mealname on feedback (household_id, meal_name);

create table shopping_state (
  household_id uuid not null references households(id) on delete cascade,
  week_id text not null,
  item_key text not null,
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (household_id, week_id, item_key)
);

-- Row-Level Security ---------------------------------------------------------

alter table households enable row level security;
create policy "own household only" on households
  for all using (id = auth.uid()) with check (id = auth.uid());

alter table board_of_advisors enable row level security;
create policy "own household only" on board_of_advisors
  for all using (household_id = auth.uid()) with check (household_id = auth.uid());

alter table favourites enable row level security;
create policy "own household only" on favourites
  for all using (household_id = auth.uid()) with check (household_id = auth.uid());

alter table weeks enable row level security;
create policy "own household only" on weeks
  for all using (household_id = auth.uid()) with check (household_id = auth.uid());

alter table week_history enable row level security;
create policy "own household only" on week_history
  for all using (household_id = auth.uid()) with check (household_id = auth.uid());

alter table feedback enable row level security;
create policy "own household only" on feedback
  for all using (household_id = auth.uid()) with check (household_id = auth.uid());

alter table shopping_state enable row level security;
create policy "own household only" on shopping_state
  for all using (household_id = auth.uid()) with check (household_id = auth.uid());

-- meals has no household_id column directly — scope via its parent week.
alter table meals enable row level security;
create policy "own household only" on meals
  for all using (
    exists (select 1 from weeks w where w.id = meals.week_id and w.household_id = auth.uid())
  ) with check (
    exists (select 1 from weeks w where w.id = meals.week_id and w.household_id = auth.uid())
  );

-- Keep-alive heartbeat --------------------------------------------------------
-- Belt-and-suspenders against Supabase's free-tier 7-day inactivity pause,
-- independent of whether the scheduled generation job runs on time. Applied
-- directly (this project's role had permission to enable the extension):
--   create extension if not exists pg_cron;
--   select cron.schedule('heartbeat', '0 */6 * * *', 'select 1');
-- Confirmed live in this project as cron job "heartbeat" (job id 1), running
-- every 6 hours.
