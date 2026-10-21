-- Read-only Postgres role for the owner's local admin dashboard
-- (fit-pixel-dashboard). Idempotent.
-- Depends on every earlier migration (it grants on their tables).
--
-- fit_pixel_dashboard can only SELECT the columns the dashboard charts:
-- counts, dates and ids. It cannot read emails, auth secrets, push tokens,
-- habit notes / payloads or chat message bodies. The one exception is
-- content_reports: a reported message's text is the thing to review.
--
-- Sign-up dates live in auth.users, which this role can't read; the
-- dashboard.users view (owned by the migration runner) exposes only id and
-- timestamps from it.
--
-- The role is created NOLOGIN and read-only. `npm run db:dashboard-role`
-- gives it LOGIN and a generated password and writes DASHBOARD_DATABASE_URL to
-- the dashboard's .env.local; this file never touches the password.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fit_pixel_dashboard') then
    create role fit_pixel_dashboard nologin noinherit;
  end if;
end $$;

-- Belt and braces: even a mistaken grant can't write.
alter role fit_pixel_dashboard set default_transaction_read_only = on;
alter role fit_pixel_dashboard set statement_timeout = '15s';

create schema if not exists dashboard;
revoke all on schema dashboard from public;

create or replace view dashboard.users as
  select
    id,
    created_at,
    last_sign_in_at,
    email_confirmed_at is not null as email_confirmed
  from auth.users;

revoke all on dashboard.users from public;

grant usage on schema public to fit_pixel_dashboard;
grant usage on schema dashboard to fit_pixel_dashboard;
grant select on dashboard.users to fit_pixel_dashboard;

-- Table-level revoke also drops column grants, so re-runs start clean.
revoke all on table public.profiles from fit_pixel_dashboard;
revoke all on table public.habit_logs from fit_pixel_dashboard;
revoke all on table public.sync_ops from fit_pixel_dashboard;
revoke all on table public.xp_state from fit_pixel_dashboard;
revoke all on table public.saved_meals from fit_pixel_dashboard;
revoke all on table public.gyms from fit_pixel_dashboard;
revoke all on table public.conversations from fit_pixel_dashboard;
revoke all on table public.conversation_members from fit_pixel_dashboard;
revoke all on table public.messages from fit_pixel_dashboard;
revoke all on table public.user_blocks from fit_pixel_dashboard;
revoke all on table public.content_reports from fit_pixel_dashboard;
revoke all on table public.friendships from fit_pixel_dashboard;
revoke all on table public.push_tokens from fit_pixel_dashboard;

grant select (user_id, display_name, home_gym_name, profile_visible, updated_at)
  on table public.profiles to fit_pixel_dashboard;
grant select (user_id, type, timestamp, day_key, source, created_at)
  on table public.habit_logs to fit_pixel_dashboard;
grant select (user_id, type, status, reason, created_at)
  on table public.sync_ops to fit_pixel_dashboard;
grant select (user_id, lifetime_xp, level, updated_at)
  on table public.xp_state to fit_pixel_dashboard;
grant select (user_id, deleted, created_at)
  on table public.saved_meals to fit_pixel_dashboard;
grant select (id, name, created_at)
  on table public.gyms to fit_pixel_dashboard;
grant select (id, kind, gym_id, created_at)
  on table public.conversations to fit_pixel_dashboard;
grant select (conversation_id, user_id, joined_at)
  on table public.conversation_members to fit_pixel_dashboard;
grant select (id, conversation_id, sender_id, created_at, deleted_at)
  on table public.messages to fit_pixel_dashboard;
grant select (blocker_id, blocked_id, created_at)
  on table public.user_blocks to fit_pixel_dashboard;
grant select (
  id, reporter_id, reported_user_id, conversation_id, message_id,
  message_body, reason, details, status, created_at, reviewed_at
) on table public.content_reports to fit_pixel_dashboard;
grant select (user_lo, user_hi, requester_id, status, created_at, accepted_at)
  on table public.friendships to fit_pixel_dashboard;
grant select (user_id, platform, created_at, updated_at)
  on table public.push_tokens to fit_pixel_dashboard;

-- Every table forces RLS. The column grants above are the real limit; these
-- policies only let the role past RLS for SELECT.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'habit_logs', 'sync_ops', 'xp_state', 'saved_meals', 'gyms',
    'conversations', 'conversation_members', 'messages', 'user_blocks',
    'content_reports', 'friendships', 'push_tokens'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_dashboard_read', t);
    execute format(
      'create policy %I on public.%I for select to fit_pixel_dashboard using (true)',
      t || '_dashboard_read', t
    );
  end loop;
end $$;
