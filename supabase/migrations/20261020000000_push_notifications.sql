-- OS push notifications: device tokens + an outbox the push worker drains. Idempotent.
-- Depends on 20261019000000_friends_and_notifications.sql (notifications).
--
-- Flow: a notifications row is inserted (or a DM burst bumps an unread row) →
-- trigger enqueues push_outbox + pg_notify('push_outbox') → `dist/push-worker.js`
-- (separate PM2 process on the droplet, DATABASE_URL) sends via the Expo Push API.
-- Request paths never read other users' tokens.

-- ---------------------------------------------------------------------------
-- Expo push tokens. One row per device token; the token moves to whoever
-- registered it last (a shared device that switched accounts).
-- ---------------------------------------------------------------------------

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_platform_ck check (platform in ('ios', 'android')),
  constraint push_tokens_token_ck check (
    char_length(token) <= 255
    and token ~ '^Expo(nent)?PushToken\[[^\]]+\]$'
  )
);

create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id);

/** Register (or move) this device's token to the caller. Keeps 10 per user. */
create or replace function public.register_push_token(
  push_token text,
  push_platform text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (push_token, me, push_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();

  delete from public.push_tokens t
  where t.user_id = me
    and t.token not in (
      select k.token from public.push_tokens k
      where k.user_id = me
      order by k.updated_at desc
      limit 10
    );
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;

drop policy if exists push_tokens_select_own on public.push_tokens;
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_tokens_delete_own on public.push_tokens;
create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on table public.push_tokens from public, anon, authenticated;
grant select, delete on table public.push_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- Outbox (worker-only: RLS on, no policies, no grants).
-- ---------------------------------------------------------------------------

create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications (id) on delete cascade,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now()
);

create index if not exists push_outbox_due_idx
  on public.push_outbox (next_attempt_at);

create index if not exists push_outbox_notification_idx
  on public.push_outbox (notification_id);

alter table public.push_outbox enable row level security;
alter table public.push_outbox force row level security;
revoke all on table public.push_outbox from public, anon, authenticated;

/**
 * Queue a push for a new notification, or for a DM burst that bumped the
 * recipient's unread row (on_message_notify_dm updates created_at).
 */
create or replace function public.on_notification_enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.read_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.created_at <= old.created_at then
    return new;
  end if;
  if not exists (select 1 from public.push_tokens t where t.user_id = new.user_id) then
    return new;
  end if;
  insert into public.push_outbox (notification_id) values (new.id);
  perform pg_notify('push_outbox', '');
  return new;
end;
$$;

drop trigger if exists notifications_enqueue_push on public.notifications;
create trigger notifications_enqueue_push
  after insert or update of created_at on public.notifications
  for each row execute function public.on_notification_enqueue_push();
