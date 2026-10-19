-- Favourite gym chats. Idempotent.
-- Depends on 20261023000000_conversation_member_grants.sql.
--
-- A favourite is a flag on the caller's own membership row, so leaving a gym
-- (deleting the row) also drops the favourite, and RLS already limits it to
-- the member. POST /v1/gyms/:gymId/favorite sets it (joining first if needed).
-- last_read_at doubles as "last visited" for ordering the Chat tab's gyms.

alter table public.conversation_members
  add column if not exists favorite boolean not null default false;

-- Re-state the column grants from 20261023000000 plus favorite. Table-level
-- revoke also drops column grants, so re-runs start clean.
revoke update on table public.conversation_members from authenticated;
grant update (last_read_at, muted, favorite) on table public.conversation_members to authenticated;
