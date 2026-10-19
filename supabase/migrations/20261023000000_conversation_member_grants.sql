-- conversation_members: clients may only update their own read state. Idempotent.
-- Depends on 20260816000000_gyms_chat.sql.
--
-- gyms_chat granted table-wide UPDATE, and conversation_members_update_self
-- only checks user_id = auth.uid(). Through PostgREST a signed-in user could
-- PATCH their own membership row's conversation_id to any conversation,
-- including someone else's DM, and then read and post in it. The insert
-- policy (gym rooms only) never ran for that move.
--
-- Column grants close it: the API only ever updates last_read_at
-- (markConversationRead), and muted is the member's own setting. Joining and
-- leaving stay INSERT / DELETE, which the gym-only policies already guard.
--
-- `npm run db:migrate` re-applies every file in order and gyms_chat re-grants
-- table-wide UPDATE, so this file must stay after it.

-- Table-level revoke also drops column grants, so re-runs start clean.
revoke update on table public.conversation_members from authenticated;
grant update (last_read_at, muted) on table public.conversation_members to authenticated;
