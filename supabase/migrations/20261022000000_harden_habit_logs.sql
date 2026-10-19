-- habit_logs: writes only through upsert_my_habit_log(). Idempotent.
-- Depends on every earlier migration (habit_logs, prefs, xp_json_number from
-- 20261021000000_harden_direct_writes.sql).
--
-- XP is scored from habit_logs by recompute_my_xp(), but RLS only checks
-- user_id = auth.uid(), so a signed-in user could write habit_logs straight
-- through PostgREST and skip the API's zod checks: fake payload values, a
-- day_key that isn't the log's day, a backdated created_at. This file:
--   1. Validates payloads per type (HABIT_LOG_LIMITS in src/types/limits.ts)
--      in the DB, as a CHECK constraint and in the write function.
--   2. Derives day_key from timestamp + the caller's prefs, like
--      src/utils/day-key.ts, and stamps created_at with the server clock.
--   3. Makes habit_logs read-only to clients; upsert_my_habit_log() is the
--      only write path. There is no client delete (the sync API has none).
--   4. Re-buckets a user's day keys when their time zone or day boundary
--      changes (trigger on prefs), replacing the API's row-by-row rewrite.
--
-- `npm run db:migrate` re-applies every file in order and init re-grants
-- table-wide writes on habit_logs, so this file must stay after it.
-- Function signatures are part of the PostgREST API: to change one, drop it
-- first (create or replace with new arguments adds an overload).

-- ---------------------------------------------------------------------------
-- 1. Payload validation
-- ---------------------------------------------------------------------------

/** String.prototype.trim(): strips JS whitespace, not just spaces. */
create or replace function public.js_trim(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
    value,
    '^[\s   -     　﻿]+'
    || '|[\s   -     　﻿]+$',
    '',
    'g'
  );
$$;

revoke all on function public.js_trim(text) from public, anon, authenticated;

/**
 * Why a habit log payload is invalid, or null when it is valid. Mirrors the
 * per-type schemas in src/types/sync.ts and HABIT_LOG_LIMITS: numbers must be
 * finite JSON numbers (read through xp_json_number, the scorer's own reader),
 * "magnitude" limits allow negative corrections but not 0, optional keys may
 * be absent but not null. Unknown keys are kept, as the API stores them.
 * Backs habit_logs_payload_shape_ck, so it must stay immutable.
 */
create or replace function public.habit_log_payload_problem(
  log_type public.habit_log_type,
  p jsonb
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  n double precision;
  lo double precision;
  hi double precision;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return 'payload must be an object';
  end if;
  if octet_length(p::text) > 4096 then
    return 'payload is too large';
  end if;

  case log_type
  when 'water' then
    case p->>'unit'
      when 'oz' then lo := 0.1; hi := 256;
      when 'ml' then lo := 1; hi := 8000;
      else return 'water unit must be oz or ml';
    end case;
    n := public.xp_json_number(p->'amount');
    if n is null or n = 0 or abs(n) < lo or abs(n) > hi then
      return format('water amount magnitude must be %s–%s %s', lo, hi, p->>'unit');
    end if;

  when 'food' then
    if jsonb_typeof(p->'name') is distinct from 'string'
       or char_length(public.js_trim(p->>'name')) not between 1 and 120 then
      return 'food name must be 1–120 characters';
    end if;
    n := public.xp_json_number(p->'kcal');
    if n is null or n not between 0 and 10000 then
      return 'food kcal must be 0–10000';
    end if;
    if p ? 'mealType'
       and (jsonb_typeof(p->'mealType') is distinct from 'string'
            or p->>'mealType' not in ('breakfast', 'lunch', 'dinner', 'snack', 'other')) then
      return 'food mealType is invalid';
    end if;
    if (p ? 'proteinG' and coalesce(public.xp_json_number(p->'proteinG') not between 0 and 1000, true))
       or (p ? 'carbsG' and coalesce(public.xp_json_number(p->'carbsG') not between 0 and 1000, true))
       or (p ? 'fatG' and coalesce(public.xp_json_number(p->'fatG') not between 0 and 1000, true)) then
      return 'food macros must be 0–1000 g';
    end if;
    if p ? 'portionSize'
       and (jsonb_typeof(p->'portionSize') is distinct from 'string'
            or char_length(public.js_trim(p->>'portionSize')) > 80) then
      return 'food portionSize must be at most 80 characters';
    end if;

  when 'train' then
    n := public.xp_json_number(p->'durationMin');
    if n is null or n = 0 or abs(n) not between 1 and 720 then
      return 'train duration magnitude out of range';
    end if;
    if p ? 'trainType'
       and (jsonb_typeof(p->'trainType') is distinct from 'string'
            or char_length(public.js_trim(p->>'trainType')) > 80) then
      return 'trainType must be at most 80 characters';
    end if;

  when 'sleep' then
    n := public.xp_json_number(p->'durationHours');
    if n is null or n = 0 or abs(n) not between 0.05 and 24 then
      return 'sleep duration magnitude out of range';
    end if;

  when 'weight' then
    case p->>'unit'
      when 'lb' then lo := 50; hi := 700;
      when 'kg' then lo := 20; hi := 320;
      else return 'weight unit must be lb or kg';
    end case;
    n := public.xp_json_number(p->'value');
    if n is null or n not between lo and hi then
      return format('weight must be %s–%s %s', lo, hi, p->>'unit');
    end if;

  when 'steps' then
    n := public.xp_json_number(p->'steps');
    if n is null or n = 0 or abs(n) not between 1 and 100000 then
      return 'steps magnitude out of range';
    end if;

  when 'active_kcal' then
    n := public.xp_json_number(p->'kcal');
    if n is null or n = 0 or abs(n) not between 1 and 10000 then
      return 'active kcal magnitude out of range';
    end if;
  end case;

  return null;
end;
$$;

revoke all on function public.habit_log_payload_problem(public.habit_log_type, jsonb)
  from public, anon, authenticated;

-- Same NOT VALID → VALIDATE pattern as harden_direct_writes section 3: rows that
-- already break it leave it NOT VALID with a WARNING; new writes are checked.
do $$
declare
  bad bigint;
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.habit_logs'::regclass
      and c.conname = 'habit_logs_payload_shape_ck'
  ) then
    alter table public.habit_logs
      add constraint habit_logs_payload_shape_ck
      check (public.habit_log_payload_problem(type, payload) is null) not valid;
  end if;

  begin
    alter table public.habit_logs validate constraint habit_logs_payload_shape_ck;
  exception when check_violation then
    select count(*) into bad
    from public.habit_logs
    where public.habit_log_payload_problem(type, payload) is not null;
    raise warning 'habit_logs_payload_shape_ck on public.habit_logs: % existing row(s) violate it; left NOT VALID (new writes are still checked)',
      bad;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Day keys
-- ---------------------------------------------------------------------------

-- pg_timezone_names costs ~50–100 ms per call, so its names are copied here
-- once per migration run (refreshed on every db:migrate, e.g. after a Postgres
-- upgrade brings new tzdata). Internal: no client grant, RLS on, no policies.
create table if not exists public.known_time_zones (
  lower_name text primary key,
  name text not null
);

alter table public.known_time_zones enable row level security;
revoke all on table public.known_time_zones from public, anon, authenticated;

-- AT TIME ZONE reads a few IANA names as fixed-offset abbreviations first
-- (CET = +01 all year). Intl treats them as the zones they link to, so resolve
-- them to that zone. EST / MST / HST / GMT / UTC / UCT / Zulu agree either way.
insert into public.known_time_zones (lower_name, name)
select distinct on (lower(z.name))
  lower(z.name),
  case lower(z.name)
    when 'cet' then 'Europe/Brussels'
    when 'met' then 'Europe/Brussels'
    when 'eet' then 'Europe/Athens'
    when 'wet' then 'Europe/Lisbon'
    else z.name
  end
from pg_timezone_names z
order by lower(z.name), z.name
on conflict (lower_name) do update set name = excluded.name;

delete from public.known_time_zones k
where not exists (
  select 1 from pg_timezone_names z where lower(z.name) = k.lower_name
);

/**
 * App-day key (YYYY-MM-DD) for an instant, like getLocalDayKey() in
 * src/utils/day-key.ts: shift back by the day boundary, then take the
 * calendar date in the zone. Zone names match case-insensitively; anything
 * Postgres doesn't know as a zone name (offsets, POSIX strings, ICU-only
 * aliases such as PST) counts as UTC, as an invalid zone does in Node.
 */
create or replace function public.habit_log_day_key(
  at_ts timestamptz,
  day_starts_at_minutes integer,
  time_zone text
)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(
    (at_ts - make_interval(mins => coalesce(day_starts_at_minutes, 0)))
      at time zone coalesce(
        (select k.name from public.known_time_zones k
         where k.lower_name = lower(time_zone)),
        'UTC'
      ),
    'YYYY-MM-DD'
  );
$$;

revoke all on function public.habit_log_day_key(timestamptz, integer, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The write path
-- ---------------------------------------------------------------------------

/**
 * Insert or replace one of the caller's habit logs (POST /v1/sync habit_log).
 * Validates the payload (22023 → HTTP 400), trims notes (blank → null, max
 * 500 like foodNotesMaxLen), derives day_key from the caller's prefs, and
 * stamps created_at on first insert (a replay keeps the original). The client
 * dayKey / createdAt are never accepted.
 */
create or replace function public.upsert_my_habit_log(
  log_id uuid,
  log_type public.habit_log_type,
  log_timestamp timestamptz,
  log_source public.habit_log_source,
  log_payload jsonb,
  log_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  problem text;
  clean_notes text := nullif(public.js_trim(log_notes), '');
  day_starts integer;
  zone text;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if log_id is null or log_type is null or log_timestamp is null
     or log_source is null then
    raise exception 'id, type, timestamp and source are required'
      using errcode = '22023';
  end if;

  problem := public.habit_log_payload_problem(log_type, log_payload);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;
  if char_length(clean_notes) > 500 then
    raise exception 'notes must be at most 500 characters' using errcode = '22023';
  end if;

  -- No prefs row → midnight UTC, like the API's loadPrefs().
  select p.day_starts_at_minutes, p.time_zone
  into day_starts, zone
  from public.prefs p
  where p.user_id = me;

  insert into public.habit_logs (
    id, user_id, type, timestamp, created_at, notes, day_key, source, payload
  )
  values (
    log_id,
    me,
    log_type,
    log_timestamp,
    now(),
    clean_notes,
    public.habit_log_day_key(log_timestamp, day_starts, coalesce(zone, 'UTC')),
    log_source,
    log_payload
  )
  on conflict (user_id, id) do update
    set type = excluded.type,
        timestamp = excluded.timestamp,
        notes = excluded.notes,
        day_key = excluded.day_key,
        source = excluded.source,
        payload = excluded.payload;
end;
$$;

revoke all on function public.upsert_my_habit_log(
  uuid, public.habit_log_type, timestamptz, public.habit_log_source, jsonb, text
) from public, anon;
grant execute on function public.upsert_my_habit_log(
  uuid, public.habit_log_type, timestamptz, public.habit_log_source, jsonb, text
) to authenticated;

-- Read-only to clients. The definer function above writes as the table owner.
drop policy if exists habit_logs_own on public.habit_logs;
drop policy if exists habit_logs_select_own on public.habit_logs;
create policy habit_logs_select_own on public.habit_logs
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate on table public.habit_logs from authenticated;
grant select on table public.habit_logs to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Re-bucket day keys when the day boundary changes
-- ---------------------------------------------------------------------------

/**
 * When a user's time_zone or day_starts_at_minutes changes, move their habit
 * logs into the app days of the new boundary so day_key (and the XP goal
 * bonuses built on it) follow their local day. Runs in the prefs write's
 * transaction, whether it came from POST /v1/sync or straight from PostgREST.
 * Definer: clients can't update habit_logs themselves.
 */
create or replace function public.on_prefs_rederive_day_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.habit_logs l
  set day_key = public.habit_log_day_key(
    l.timestamp, new.day_starts_at_minutes, new.time_zone
  )
  where l.user_id = new.user_id
    and l.day_key is distinct from public.habit_log_day_key(
      l.timestamp, new.day_starts_at_minutes, new.time_zone
    );
  return null;
end;
$$;

revoke all on function public.on_prefs_rederive_day_keys()
  from public, anon, authenticated;

-- Sync upserts every prefs column, so only fire when the boundary really moves.
drop trigger if exists prefs_rederive_day_keys on public.prefs;
create trigger prefs_rederive_day_keys
  after update of time_zone, day_starts_at_minutes on public.prefs
  for each row
  when (
    old.time_zone is distinct from new.time_zone
    or old.day_starts_at_minutes is distinct from new.day_starts_at_minutes
  )
  execute function public.on_prefs_rederive_day_keys();

-- A first prefs row for a user who already has logs (keyed with the defaults).
drop trigger if exists prefs_rederive_day_keys_insert on public.prefs;
create trigger prefs_rederive_day_keys_insert
  after insert on public.prefs
  for each row
  execute function public.on_prefs_rederive_day_keys();
