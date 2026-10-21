-- Least-privilege Postgres role for the push worker. Idempotent.
-- Depends on 20261020000000_push_notifications.sql.
--
-- The worker used the admin DATABASE_URL, which bypasses RLS and can touch
-- every table. fit_pixel_push can only do what src/push-worker.ts does:
--   push_outbox    select / lock / update retry columns / delete
--   notifications  read the columns a push is built from
--   profiles       read display_name for "<name> sent you a message"
--   push_tokens    read tokens, delete dead ones
--
-- The role is created NOLOGIN. `npm run db:push-role` gives it LOGIN and a
-- generated password and writes PUSH_DATABASE_URL to .env; this file never
-- touches the password, so re-running it doesn't lock the worker out.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fit_pixel_push') then
    create role fit_pixel_push nologin noinherit;
  end if;
end $$;

grant usage on schema public to fit_pixel_push;

-- Table-level revoke also drops column grants, so re-runs start clean.
revoke all on table public.push_outbox from fit_pixel_push;
revoke all on table public.notifications from fit_pixel_push;
revoke all on table public.profiles from fit_pixel_push;
revoke all on table public.push_tokens from fit_pixel_push;

-- SELECT ... FOR UPDATE needs UPDATE on a column; these are the retry columns.
grant select, delete on table public.push_outbox to fit_pixel_push;
grant update (attempts, next_attempt_at) on table public.push_outbox to fit_pixel_push;
grant select (id, user_id, actor_id, kind, conversation_id, body, created_at, read_at)
  on table public.notifications to fit_pixel_push;
grant select (user_id, display_name) on table public.profiles to fit_pixel_push;
grant select (user_id, token), delete on table public.push_tokens to fit_pixel_push;

-- Every table forces RLS. The grants above are the real limit; these policies
-- only let the role past RLS for the commands it was granted.
drop policy if exists push_outbox_push_worker on public.push_outbox;
create policy push_outbox_push_worker on public.push_outbox
  for all to fit_pixel_push
  using (true)
  with check (true);

drop policy if exists notifications_push_worker on public.notifications;
create policy notifications_push_worker on public.notifications
  for select to fit_pixel_push
  using (true);

drop policy if exists profiles_push_worker on public.profiles;
create policy profiles_push_worker on public.profiles
  for select to fit_pixel_push
  using (true);

drop policy if exists push_tokens_push_worker_select on public.push_tokens;
create policy push_tokens_push_worker_select on public.push_tokens
  for select to fit_pixel_push
  using (true);

drop policy if exists push_tokens_push_worker_delete on public.push_tokens;
create policy push_tokens_push_worker_delete on public.push_tokens
  for delete to fit_pixel_push
  using (true);
