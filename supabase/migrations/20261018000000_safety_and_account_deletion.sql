-- User safety (block + report) and self-service account deletion. Idempotent.
-- App Store: Guideline 1.2 (UGC report/block) and 5.1.1(v) (in-app account deletion).

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self_ck check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_id_idx
  on public.user_blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- Reports (reviewed in the Supabase dashboard; users can only file + see own)
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.report_reason as enum (
    'spam', 'harassment', 'hate', 'sexual', 'violence', 'other'
  );
exception when duplicate_object then null;
end $$;

-- Reporter / reported survive account deletion as NULL so the record stays.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  reported_user_id uuid references auth.users (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  message_body text,
  reason public.report_reason not null,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint content_reports_details_len_ck check (
    details is null or char_length(details) <= 500
  ),
  constraint content_reports_status_ck check (
    status in ('open', 'actioned', 'dismissed')
  )
);

create unique index if not exists content_reports_reporter_message_uidx
  on public.content_reports (reporter_id, message_id)
  where message_id is not null;

create index if not exists content_reports_status_created_idx
  on public.content_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** True when either side of a DM has blocked the other. Gym rooms → false. */
create or replace function public.dm_has_block(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dm_pairs dp
    join public.user_blocks b
      on (b.blocker_id = dp.user_lo and b.blocked_id = dp.user_hi)
      or (b.blocker_id = dp.user_hi and b.blocked_id = dp.user_lo)
    where dp.conversation_id = cid
  );
$$;

revoke all on function public.dm_has_block(uuid) from public, anon;
grant execute on function public.dm_has_block(uuid) to authenticated;

-- Same as 20260816000000_gyms_chat.sql plus the block check.
create or replace function public.create_or_get_dm(peer_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id uuid;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if peer_user_id is null or peer_user_id = me then
    raise exception 'invalid peer' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p where p.user_id = peer_user_id
  ) then
    raise exception 'peer not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = me and b.blocked_id = peer_user_id)
       or (b.blocker_id = peer_user_id and b.blocked_id = me)
  ) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  if me < peer_user_id then
    lo := me;
    hi := peer_user_id;
  else
    lo := peer_user_id;
    hi := me;
  end if;

  select dp.conversation_id into conv_id
  from public.dm_pairs dp
  where dp.user_lo = lo and dp.user_hi = hi;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations (kind) values ('dm')
  returning id into conv_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (conv_id, me), (conv_id, peer_user_id);

  insert into public.dm_pairs (user_lo, user_hi, conversation_id)
  values (lo, hi, conv_id);

  return conv_id;
exception
  when unique_violation then
    select dp.conversation_id into conv_id
    from public.dm_pairs dp
    where dp.user_lo = lo and dp.user_hi = hi;
    return conv_id;
end;
$$;

revoke all on function public.create_or_get_dm(uuid) from public, anon;
grant execute on function public.create_or_get_dm(uuid) to authenticated;

/**
 * Deletes the caller's auth user. Every user table references auth.users with
 * on delete cascade, so profile, logs, XP, loadout, memberships and messages go
 * with it. DM conversations are removed first so the peer is not left with a
 * one-sided thread. Runs as the function owner, so no service role on the API.
 */
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  delete from public.conversations c
  using public.dm_pairs dp
  where dp.conversation_id = c.id
    and (dp.user_lo = me or dp.user_hi = me);

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.user_blocks enable row level security;
alter table public.user_blocks force row level security;
alter table public.content_reports enable row level security;
alter table public.content_reports force row level security;

drop policy if exists user_blocks_select_own on public.user_blocks;
create policy user_blocks_select_own on public.user_blocks
  for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists user_blocks_insert_own on public.user_blocks;
create policy user_blocks_insert_own on public.user_blocks
  for insert to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists user_blocks_delete_own on public.user_blocks;
create policy user_blocks_delete_own on public.user_blocks
  for delete to authenticated
  using (blocker_id = auth.uid());

drop policy if exists content_reports_select_own on public.content_reports;
create policy content_reports_select_own on public.content_reports
  for select to authenticated
  using (reporter_id = auth.uid());

drop policy if exists content_reports_insert_own on public.content_reports;
create policy content_reports_insert_own on public.content_reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and status = 'open'
    and reviewed_at is null
  );

-- No new messages into a DM once either side has blocked the other.
drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and not public.dm_has_block(conversation_id)
  );

revoke all on table public.user_blocks from public, anon;
revoke all on table public.content_reports from public, anon;

grant select, insert, delete on table public.user_blocks to authenticated;
grant select, insert on table public.content_reports to authenticated;
