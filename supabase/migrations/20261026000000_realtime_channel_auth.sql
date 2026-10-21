-- Realtime Authorization for the app's private channels. Idempotent.
-- Depends on 20260816000000_gyms_chat.sql (conversation_members).
--
-- The app's channels were public: anyone holding the anon key (it ships in the
-- app) could join `conversation:<id>`, watch or fake presence, and gym ids are
-- listable. Postgres-changes rows were always filtered by table RLS; this
-- covers channel join, presence and broadcast. The app now opens both channels
-- with `private: true`, and Realtime checks these policies on join:
--   conversation:<uuid>   members of that conversation
--   notifications:<uuid>  only that user
-- Presence tracking is the only write allowed; nobody may broadcast.
--
-- Also turn off "Allow public access" in Dashboard → Realtime → Settings so
-- public channels can't be used at all.

/** True when the caller may join this Realtime topic. Unknown topics → false. */
create or replace function public.realtime_topic_allowed(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  uuid_re constant text :=
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if me is null or topic is null then
    return false;
  end if;
  -- Regex first so the casts below can't raise on a malformed topic.
  if topic ~* ('^conversation:' || uuid_re || '$') then
    return exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = substr(topic, 14)::uuid
        and m.user_id = me
    );
  end if;
  if topic ~* ('^notifications:' || uuid_re || '$') then
    return substr(topic, 15)::uuid = me;
  end if;
  return false;
end;
$$;

revoke all on function public.realtime_topic_allowed(text) from public, anon;
grant execute on function public.realtime_topic_allowed(text) to authenticated;

-- realtime.messages only exists where Realtime Authorization is available
-- (every hosted project); skip quietly elsewhere.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages not found; skipping channel policies';
    return;
  end if;

  execute 'drop policy if exists fit_pixel_channel_read on realtime.messages';
  execute $p$
    create policy fit_pixel_channel_read on realtime.messages
      for select to authenticated
      using (public.realtime_topic_allowed(realtime.topic()))
  $p$;

  execute 'drop policy if exists fit_pixel_channel_presence on realtime.messages';
  execute $p$
    create policy fit_pixel_channel_presence on realtime.messages
      for insert to authenticated
      with check (
        realtime.messages.extension = 'presence'
        and public.realtime_topic_allowed(realtime.topic())
      )
  $p$;
end $$;
