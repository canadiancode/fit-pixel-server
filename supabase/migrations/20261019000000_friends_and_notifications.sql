-- Friends (request → accept), in-app notifications, and public Pixel cards. Idempotent.
-- Depends on 20261018000000_safety_and_account_deletion.sql (user_blocks).

-- ---------------------------------------------------------------------------
-- Friendships: one row per pair, ordered like dm_pairs.
-- ---------------------------------------------------------------------------

create table if not exists public.friendships (
  user_lo uuid not null references auth.users (id) on delete cascade,
  user_hi uuid not null references auth.users (id) on delete cascade,
  requester_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_lo, user_hi),
  constraint friendships_ordered_ck check (user_lo < user_hi),
  constraint friendships_requester_ck check (requester_id in (user_lo, user_hi)),
  constraint friendships_status_ck check (status in ('pending', 'accepted'))
);

create index if not exists friendships_user_hi_idx
  on public.friendships (user_hi);

-- ---------------------------------------------------------------------------
-- Notifications (recipient = user_id; actor = who caused it)
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete cascade,
  kind text not null,
  conversation_id uuid references public.conversations (id) on delete cascade,
  body text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_kind_ck check (
    kind in ('friend_request', 'friend_accepted', 'dm_message')
  ),
  constraint notifications_body_len_ck check (
    body is null or char_length(body) <= 140
  )
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- Public Pixel card (name, look, and opt-in bio / home gym) for other users.
-- Runs as the view owner like chat_authors, so profiles/loadouts RLS stays own-only.
-- ---------------------------------------------------------------------------

create or replace view public.pixel_cards as
select
  p.user_id,
  p.display_name,
  case when p.profile_visible then p.bio else '' end as bio,
  case when p.profile_visible then p.home_gym_name else null end as home_gym_name,
  coalesce(l.equipped, '{}'::jsonb) as equipped
from public.profiles p
left join public.loadouts l on l.user_id = p.user_id;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.users_blocked_either_way(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = a and ub.blocked_id = b)
       or (ub.blocker_id = b and ub.blocked_id = a)
  );
$$;

revoke all on function public.users_blocked_either_way(uuid, uuid) from public, anon;
grant execute on function public.users_blocked_either_way(uuid, uuid) to authenticated;

/**
 * Send (or auto-accept a crossed) friend request.
 * Returns 'pending_outgoing' or 'accepted'.
 */
create or replace function public.send_friend_request(peer_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  existing public.friendships%rowtype;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if peer_user_id is null or peer_user_id = me then
    raise exception 'invalid peer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = peer_user_id) then
    raise exception 'peer not found' using errcode = 'P0002';
  end if;
  if public.users_blocked_either_way(me, peer_user_id) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  lo := least(me, peer_user_id);
  hi := greatest(me, peer_user_id);

  select * into existing
  from public.friendships f
  where f.user_lo = lo and f.user_hi = hi
  for update;

  if found then
    if existing.status = 'accepted' then
      return 'accepted';
    end if;
    if existing.requester_id = me then
      return 'pending_outgoing';
    end if;
    -- They already asked me: treat my request as an accept.
    update public.friendships
    set status = 'accepted', accepted_at = now()
    where user_lo = lo and user_hi = hi;
    update public.notifications
    set read_at = now()
    where user_id = me and actor_id = peer_user_id
      and kind = 'friend_request' and read_at is null;
    insert into public.notifications (user_id, actor_id, kind)
    values (peer_user_id, me, 'friend_accepted');
    return 'accepted';
  end if;

  insert into public.friendships (user_lo, user_hi, requester_id, status)
  values (lo, hi, me, 'pending');

  -- One live request notification per pair (re-requests after a decline reuse it).
  delete from public.notifications
  where user_id = peer_user_id and actor_id = me and kind = 'friend_request';
  insert into public.notifications (user_id, actor_id, kind)
  values (peer_user_id, me, 'friend_request');

  return 'pending_outgoing';
end;
$$;

revoke all on function public.send_friend_request(uuid) from public, anon;
grant execute on function public.send_friend_request(uuid) to authenticated;

/** Accept or decline a pending request that peer sent to the caller. */
create or replace function public.respond_friend_request(
  peer_user_id uuid,
  accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if peer_user_id is null or peer_user_id = me then
    raise exception 'invalid peer' using errcode = '22023';
  end if;

  lo := least(me, peer_user_id);
  hi := greatest(me, peer_user_id);

  if not exists (
    select 1 from public.friendships f
    where f.user_lo = lo and f.user_hi = hi
      and f.status = 'pending' and f.requester_id = peer_user_id
  ) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  update public.notifications
  set read_at = now()
  where user_id = me and actor_id = peer_user_id
    and kind = 'friend_request' and read_at is null;

  if accept then
    if public.users_blocked_either_way(me, peer_user_id) then
      raise exception 'blocked' using errcode = '42501';
    end if;
    update public.friendships
    set status = 'accepted', accepted_at = now()
    where user_lo = lo and user_hi = hi;
    insert into public.notifications (user_id, actor_id, kind)
    values (peer_user_id, me, 'friend_accepted');
    return 'accepted';
  end if;

  delete from public.friendships where user_lo = lo and user_hi = hi;
  return 'none';
end;
$$;

revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

/** Unfriend, or cancel a request the caller sent. */
create or replace function public.remove_friend(peer_user_id uuid)
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
  if peer_user_id is null or peer_user_id = me then
    raise exception 'invalid peer' using errcode = '22023';
  end if;

  delete from public.friendships
  where user_lo = least(me, peer_user_id)
    and user_hi = greatest(me, peer_user_id);

  -- Withdraw an unanswered request notification the caller sent.
  delete from public.notifications
  where user_id = peer_user_id and actor_id = me
    and kind = 'friend_request' and read_at is null;
end;
$$;

revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

/** Blocking someone ends any friendship / pending request between the pair. */
create or replace function public.on_user_block_drop_friendship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friendships
  where user_lo = least(new.blocker_id, new.blocked_id)
    and user_hi = greatest(new.blocker_id, new.blocked_id);
  delete from public.notifications
  where (user_id = new.blocker_id and actor_id = new.blocked_id)
     or (user_id = new.blocked_id and actor_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists user_blocks_drop_friendship on public.user_blocks;
create trigger user_blocks_drop_friendship
  after insert on public.user_blocks
  for each row execute function public.on_user_block_drop_friendship();

/**
 * New DM message → notify the other member. Collapses into the peer's unread
 * notification for that conversation so a burst of messages is one row.
 */
create or replace function public.on_message_notify_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  peer uuid;
  preview text := left(new.body, 140);
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.kind = 'dm'
  ) then
    return new;
  end if;

  for peer in
    select m.user_id from public.conversation_members m
    where m.conversation_id = new.conversation_id
      and m.user_id <> new.sender_id
  loop
    update public.notifications
    set body = preview, created_at = new.created_at
    where user_id = peer and conversation_id = new.conversation_id
      and kind = 'dm_message' and read_at is null;
    if not found then
      insert into public.notifications (user_id, actor_id, kind, conversation_id, body, created_at)
      values (peer, new.sender_id, 'dm_message', new.conversation_id, preview, new.created_at);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists messages_notify_dm on public.messages;
create trigger messages_notify_dm
  after insert on public.messages
  for each row execute function public.on_message_notify_dm();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.friendships enable row level security;
alter table public.friendships force row level security;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Writes go through the security definer functions above only.
drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own on public.friendships
  for select to authenticated
  using (user_lo = auth.uid() or user_hi = auth.uid());

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on table public.friendships from public, anon, authenticated;
revoke all on table public.notifications from public, anon, authenticated;
revoke all on table public.pixel_cards from public, anon;

grant select on table public.friendships to authenticated;
grant select, delete on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant select on table public.pixel_cards to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
