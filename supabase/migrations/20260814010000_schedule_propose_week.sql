-- Schedules the propose-week edge function (Job A's Supabase-native rebuild) to run every 3
-- hours via pg_cron + pg_net, mirroring the cadence of the retired external git-push cron.
-- The function itself gates on "is it Saturday in Sydney for this household, and have we
-- already proposed today" -- most invocations are a no-op; this cadence just makes sure the
-- one that lands on Saturday isn't missed, and self-heals if a single call fails transiently.
--
-- The shared secret is stored in Supabase Vault rather than embedded in cron.job.command, so
-- it isn't sitting in plain text in a table anyone with SQL Editor access can select from.
-- The actual secret value was set via the dashboard SQL Editor when this was first run, not
-- committed here.
create extension if not exists pg_net;

select cron.schedule(
  'propose_week_every_3h',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://jpofeslziyjbysotycfl.supabase.co/functions/v1/propose-week',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'propose_week_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
