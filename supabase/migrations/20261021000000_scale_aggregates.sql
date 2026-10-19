-- Move per-request whole-table reads into SQL so results stay right past
-- PostgREST's 1000-row cap and request cost stops growing with table size.
-- Idempotent. Depends on 20260814000000_init.sql, 20260816000000_gyms_chat.sql.
-- Lifetime XP moved into SQL in 20261021000000_harden_direct_writes.sql
-- (recompute_my_xp), so it isn't repeated here. Touches no table grants.

-- ---------------------------------------------------------------------------
-- Gym member counts (replaces counting every conversation_members row in Node)
-- ---------------------------------------------------------------------------

/**
 * Member count per gym conversation. Security definer so the count covers every
 * member, not only rows the caller can see (conversation_members RLS hides other
 * members of gyms the caller hasn't joined). Gym rooms only; returns no names.
 */
create or replace function public.gym_member_counts(conversation_ids uuid[])
returns table (conversation_id uuid, member_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint
  from public.conversation_members m
  join public.conversations c
    on c.id = m.conversation_id and c.kind = 'gym'
  where auth.uid() is not null
    and m.conversation_id = any (conversation_ids)
  group by m.conversation_id;
$$;

revoke all on function public.gym_member_counts(uuid[]) from public, anon;
grant execute on function public.gym_member_counts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- DM inbox: latest visible message per conversation
-- ---------------------------------------------------------------------------

/**
 * Newest non-deleted message for each conversation id. Security invoker, so
 * messages RLS (caller must be a member) still applies. One index probe per id
 * on messages_conversation_created_idx.
 */
create or replace function public.dm_last_messages(conversation_ids uuid[])
returns table (
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select last_msg.conversation_id, last_msg.sender_id, last_msg.body, last_msg.created_at
  from unnest(conversation_ids) as ids (id)
  cross join lateral (
    select msg.conversation_id, msg.sender_id, msg.body, msg.created_at
    from public.messages msg
    where msg.conversation_id = ids.id
      and msg.deleted_at is null
    order by msg.created_at desc
    limit 1
  ) as last_msg;
$$;

revoke all on function public.dm_last_messages(uuid[]) from public, anon;
grant execute on function public.dm_last_messages(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Sync: existing acks for a whole batch in one call
-- ---------------------------------------------------------------------------

/**
 * Caller's sync_ops rows for these op ids. A POST body, so a 500-op batch
 * doesn't become a 20 KB `in.(…)` URL. Security invoker: sync_ops RLS applies.
 */
create or replace function public.my_sync_ops(op_ids uuid[])
returns table (id uuid, status public.sync_op_status, reason text)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.status, s.reason
  from public.sync_ops s
  where s.user_id = auth.uid()
    and s.id = any (op_ids);
$$;

revoke all on function public.my_sync_ops(uuid[]) from public, anon;
grant execute on function public.my_sync_ops(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Pixel search: trigram index for `display_name ilike '%q%'`
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;

-- The opclass lives wherever pg_trgm was installed (Supabase: extensions).
do $$
declare
  trgm_schema text;
begin
  select n.nspname into trgm_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  execute format(
    'create index if not exists profiles_display_name_trgm_idx '
    'on public.profiles using gin (display_name %I.gin_trgm_ops)',
    trgm_schema
  );
end $$;
