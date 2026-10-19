-- Close direct-PostgREST write bypasses. Idempotent.
-- Depends on every earlier migration (xp_state, messages, dm_has_block, pixel_cards).
--
-- The Expo app ships the anon key and the user's JWT, so any signed-in user can
-- hit PostgREST directly and skip the API's zod validation. RLS only checks
-- user_id = auth.uid(); this file adds what RLS can't express:
--   1. xp_state is read-only to clients; XP is recomputed by recompute_my_xp().
--   2. messages: column grants, server-stamped created_at, DB-side send rate,
--      and the update policy honours membership + DM blocks.
--   3. CHECK constraints mirroring src/types/limits.ts.
--   4. chat_authors / pixel_cards stay owner-run (see the note in section 4).
--
-- `npm run db:migrate` re-applies every file in order, and the earlier files
-- re-grant table-wide writes on xp_state / messages. This file must stay last
-- among anything that touches those grants.

-- ---------------------------------------------------------------------------
-- 1. XP: server-computed only
-- ---------------------------------------------------------------------------

/**
 * A JSON number as float8, the way JSON.parse + Number.isFinite saw it in the
 * old Node scorer: non-numbers and overflow → null (skipped), underflow → 0.
 * Internal to recompute_my_xp(); no client grant.
 */
create or replace function public.xp_json_number(v jsonb)
returns double precision
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(v) is distinct from 'number' then null
    when abs(v::numeric) >= 1e308 then null
    when abs(v::numeric) < 1e-300 then 0
    else v::numeric::double precision
  end;
$$;

revoke all on function public.xp_json_number(jsonb) from public, anon, authenticated;

/**
 * Recompute the caller's XP / level from habit_logs + daily_goals and store it.
 * Mirrors the XP_* constants in src/types/limits.ts:
 *   10 XP per habit log, 50 per daily goal met, +100 when all six are met,
 *   100 XP per level. Water totals are converted into the goal's unit.
 * Sums are float8 added in id order, exactly like the old Node scorer, so a day
 * sitting on a goal threshold scores the same as before.
 * Never reads client xp_award ops or habit notes.
 */
create or replace function public.recompute_my_xp()
returns public.xp_state
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  goals public.daily_goals%rowtype;
  ml_per_oz constant double precision := 29.5735295625;
  log_count bigint;
  bonus bigint := 0;
  xp bigint;
  result public.xp_state;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select count(*) into log_count
  from public.habit_logs l
  where l.user_id = me;

  select * into goals
  from public.daily_goals g
  where g.user_id = me;

  if found then
    select coalesce(sum(d.met * 50 + case when d.met = 6 then 100 else 0 end), 0)
    into bonus
    from (
      select
        (t.food_kcal >= goals.food_kcal)::int
        + (t.water_amount >= goals.water_amount)::int
        + (t.train_minutes >= goals.train_minutes)::int
        + (t.sleep_hours >= goals.sleep_hours)::int
        + (t.steps >= goals.steps)::int
        + (t.active_kcal >= goals.active_kcal)::int as met
      from (
        select
          coalesce(sum(public.xp_json_number(l.payload->'kcal') order by l.id)
            filter (where l.type = 'food'), 0) as food_kcal,
          coalesce(sum(
            case
              when l.payload->>'unit' = goals.water_unit::text
                then public.xp_json_number(l.payload->'amount')
              when l.payload->>'unit' = 'oz'
                then public.xp_json_number(l.payload->'amount') * ml_per_oz
              else public.xp_json_number(l.payload->'amount') / ml_per_oz
            end
            order by l.id
          ) filter (
            where l.type = 'water' and l.payload->>'unit' in ('oz', 'ml')
          ), 0) as water_amount,
          coalesce(sum(public.xp_json_number(l.payload->'durationMin') order by l.id)
            filter (where l.type = 'train'), 0) as train_minutes,
          coalesce(sum(public.xp_json_number(l.payload->'durationHours') order by l.id)
            filter (where l.type = 'sleep'), 0) as sleep_hours,
          coalesce(sum(public.xp_json_number(l.payload->'steps') order by l.id)
            filter (where l.type = 'steps'), 0) as steps,
          coalesce(sum(public.xp_json_number(l.payload->'kcal') order by l.id)
            filter (where l.type = 'active_kcal'), 0) as active_kcal
        from public.habit_logs l
        where l.user_id = me
        group by l.day_key
      ) t
    ) d;
  end if;

  xp := least(log_count * 10 + bonus, 2147483647);

  insert into public.xp_state (user_id, lifetime_xp, level, updated_at)
  values (me, xp::integer, (xp / 100)::integer, now())
  on conflict (user_id) do update
    set lifetime_xp = excluded.lifetime_xp,
        level = excluded.level,
        updated_at = excluded.updated_at
  returning * into result;

  return result;
end;
$$;

revoke all on function public.recompute_my_xp() from public, anon;
grant execute on function public.recompute_my_xp() to authenticated;

drop policy if exists xp_state_own on public.xp_state;
drop policy if exists xp_state_select_own on public.xp_state;
create policy xp_state_select_own on public.xp_state
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate on table public.xp_state from authenticated;
grant select on table public.xp_state to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Messages
-- ---------------------------------------------------------------------------

-- Backs the send-rate lookup (and the API's enforceSendRate) without scanning
-- a whole gym room for one sender.
create index if not exists messages_sender_conversation_created_idx
  on public.messages (sender_id, conversation_id, created_at desc);

/**
 * Server-stamps created_at / deleted_at and rejects a second message from the
 * same sender in the same conversation within 800 ms (CHAT_LIMITS
 * .messageMinIntervalMs). PT429 makes PostgREST answer HTTP 429.
 * The advisory lock serialises concurrent sends from one sender to one room.
 */
create or replace function public.on_message_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  last_at timestamptz;
begin
  new.created_at := now();
  new.deleted_at := null;

  -- Definer / service contexts, or a spoofed sender that RLS will reject:
  -- don't answer rate questions about someone else's messages.
  if me is null or new.sender_id is distinct from me then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.sender_id::text || ':' || new.conversation_id::text, 0)
  );

  select max(m.created_at) into last_at
  from public.messages m
  where m.sender_id = new.sender_id
    and m.conversation_id = new.conversation_id;

  if last_at is not null and now() - last_at < interval '800 milliseconds' then
    raise exception 'Please wait before sending again' using errcode = 'PT429';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.on_message_before_insert();

/** Soft delete only: deleted_at is server-stamped and can't be cleared. */
create or replace function public.on_message_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if old.deleted_at is not null then
      raise exception 'message already deleted' using errcode = '42501';
    end if;
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_before_update on public.messages;
create trigger messages_before_update
  before update on public.messages
  for each row execute function public.on_message_before_update();

-- Blocked DM pairs and ex-members can't touch old messages either.
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and not public.dm_has_block(conversation_id)
  )
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and not public.dm_has_block(conversation_id)
  );

-- Table-level revoke also drops column grants, so re-runs start clean.
revoke insert, update, delete, truncate on table public.messages from authenticated;
grant select on table public.messages to authenticated;
grant insert (conversation_id, sender_id, body) on table public.messages to authenticated;
grant update (deleted_at) on table public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- 3. CHECK constraints mirroring src/types/limits.ts
-- ---------------------------------------------------------------------------
-- Added NOT VALID (new writes are checked immediately), then validated. A
-- constraint that existing rows break stays NOT VALID and raises a WARNING with
-- the row count instead of failing the migration. Find them later with:
--   select conrelid::regclass, conname from pg_constraint
--   where contype = 'c' and not convalidated;
-- Constraints are matched by name: to change an expression, drop it first.
-- Payload caps use octet_length(::text), not pg_column_size(), because the
-- latter reports the compressed size for TOASTed rows, so inserts and
-- validation would measure differently.

do $$
declare
  r record;
  bad bigint;
begin
  for r in
    select *
    from (values
      -- PROFILE_LIMITS
      ('public.profiles', 'profiles_display_name_len_ck', 'char_length(display_name) <= 80'),
      ('public.profiles', 'profiles_bio_len_ck', 'char_length(bio) <= 500'),
      ('public.profiles', 'profiles_home_gym_id_len_ck', 'char_length(home_gym_id) <= 64'),
      ('public.profiles', 'profiles_home_gym_name_len_ck', 'char_length(home_gym_name) <= 120'),
      ('public.profiles', 'profiles_instagram_len_ck', 'char_length(instagram) <= 200'),
      ('public.profiles', 'profiles_tiktok_len_ck', 'char_length(tiktok) <= 200'),
      ('public.profiles', 'profiles_youtube_len_ck', 'char_length(youtube) <= 200'),

      -- DAILY_GOAL_LIMITS
      ('public.daily_goals', 'daily_goals_food_kcal_ck', 'food_kcal between 500 and 6000'),
      ('public.daily_goals', 'daily_goals_water_amount_ck',
        'case water_unit when ''oz'' then water_amount between 8 and 256'
        || ' else water_amount between 250 and 8000 end'),
      ('public.daily_goals', 'daily_goals_train_minutes_ck', 'train_minutes between 15 and 240'),
      ('public.daily_goals', 'daily_goals_sleep_hours_ck', 'sleep_hours between 6 and 12'),
      ('public.daily_goals', 'daily_goals_steps_ck', 'steps between 1000 and 50000'),
      ('public.daily_goals', 'daily_goals_active_kcal_ck', 'active_kcal between 200 and 5000'),
      ('public.daily_goals', 'daily_goals_weight_goal_ck',
        'case weight_unit when ''lb'' then weight_goal between 100 and 400'
        || ' else weight_goal between 45 and 180 end'),

      -- SAVED_MEAL_VENDOR_MAX + HABIT_LOG_LIMITS.food* (tombstones are name '' / kcal 0)
      ('public.saved_meals', 'saved_meals_name_len_ck', 'char_length(name) <= 120'),
      ('public.saved_meals', 'saved_meals_vendor_len_ck', 'char_length(vendor) <= 80'),
      ('public.saved_meals', 'saved_meals_portion_size_len_ck', 'char_length(portion_size) <= 80'),
      ('public.saved_meals', 'saved_meals_kcal_ck', 'kcal between 0 and 10000'),
      ('public.saved_meals', 'saved_meals_macros_ck',
        'protein_g between 0 and 1000 and carbs_g between 0 and 1000'
        || ' and fat_g between 0 and 1000'),

      -- HABIT_LOG_LIMITS.foodNotesMaxLen, sync dayKey max, payload cap
      ('public.habit_logs', 'habit_logs_notes_len_ck', 'char_length(notes) <= 500'),
      ('public.habit_logs', 'habit_logs_day_key_len_ck', 'char_length(day_key) <= 32'),
      ('public.habit_logs', 'habit_logs_payload_ck',
        'jsonb_typeof(payload) = ''object'' and octet_length(payload::text) <= 4096'),

      -- Equipped map is shown to everyone through pixel_cards.
      ('public.loadouts', 'loadouts_equipped_ck',
        'jsonb_typeof(equipped) = ''object'' and octet_length(equipped::text) <= 2048'),

      -- prefsPayloadSchema (timeZone 1–64; theme ids are short slugs)
      ('public.prefs', 'prefs_time_zone_len_ck', 'char_length(time_zone) between 1 and 64'),
      ('public.prefs', 'prefs_selected_theme_id_len_ck', 'char_length(selected_theme_id) <= 32')
    ) as t (tbl, name, expr)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = r.tbl::regclass and c.conname = r.name
    ) then
      execute format(
        'alter table %s add constraint %I check (%s) not valid',
        r.tbl, r.name, r.expr
      );
    end if;

    begin
      execute format('alter table %s validate constraint %I', r.tbl, r.name);
    exception when check_violation then
      execute format(
        'select count(*) from %s where not coalesce((%s), true)',
        r.tbl, r.expr
      ) into bad;
      raise warning '% on %: % existing row(s) violate it; left NOT VALID (new writes are still checked)',
        r.name, r.tbl, bad;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. chat_authors / pixel_cards stay owner-run (security_invoker = false)
-- ---------------------------------------------------------------------------
-- RLS is row-level. Both views exist to publish a few columns of other users'
-- rows (display name, opt-in bio / home gym, equipped look) while profiles and
-- loadouts stay own-row-only. With security_invoker they would need a select
-- policy letting everyone read every profiles / loadouts row, which also
-- exposes instagram / tiktok / youtube, home_gym_id and the hidden bio through
-- the base tables. Column grants can't fix that without breaking the owner's
-- own restore reads. So the views keep running as their owner and are the only
-- cross-user read path: no WHERE clause to leak past, masking happens in the
-- projection, anon has no grant, and every exposed column is length-capped by
-- section 3.

comment on view public.chat_authors is
  'Owner-run on purpose: the only cross-user read of profiles.display_name. See 20261021000000_harden_direct_writes.sql.';
comment on view public.pixel_cards is
  'Owner-run on purpose: name, look, and opt-in bio / home gym for other users. See 20261021000000_harden_direct_writes.sql.';

revoke all on table public.chat_authors from public, anon, authenticated;
revoke all on table public.pixel_cards from public, anon, authenticated;
grant select on table public.chat_authors to authenticated;
grant select on table public.pixel_cards to authenticated;
