-- Training sync: the workout plan and finished workouts, and their XP. Idempotent.
-- Depends on 20261022000000_harden_habit_logs.sql (js_trim, habit_log_day_key)
-- and redefines recompute_my_xp() from 20261031000000_xp_caps_food_direction.sql,
-- so it must sort after that file.
--
--   1. training_plans: one JSON plan per user, last write wins on updated_at.
--      Written only through save_my_training_plan().
--   2. workout_sessions: finished workouts, read-only to clients. Written only
--      through upsert_my_workout_session(), which validates every set, derives
--      day_key from started_at + prefs, and counts completed sets itself.
--   3. Day keys follow time zone / day boundary changes, like habit_logs.
--   4. XP rules v3: v2 plus workouts, scored from workout_sessions alone:
--        5 XP per completed set, first 40 sets per day
--        25 XP per workout with a completed set, first 2 per day
--      (XP_PER_WORKOUT_SET, XP_WORKOUT_SETS_PER_DAY, XP_WORKOUT_COMPLETE,
--      XP_WORKOUT_COMPLETES_PER_DAY in src/types/limits.ts and the app's
--      lib/db/xp/amounts.ts). The Train minutes a workout logs stay a habit log.
--
-- Function signatures are part of the PostgREST API: to change one, drop it
-- first (create or replace with new arguments adds an overload).

alter type public.pending_op_type add value if not exists 'workout_session';
alter type public.pending_op_type add value if not exists 'training_plan';

-- ---------------------------------------------------------------------------
-- 1. Training plan
-- ---------------------------------------------------------------------------

create table if not exists public.training_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan jsonb not null,
  updated_at timestamptz not null,
  constraint training_plans_plan_ck check (
    jsonb_typeof(plan) = 'object'
    and octet_length(plan::text) <= 65536
  )
);

alter table public.training_plans enable row level security;
alter table public.training_plans force row level security;

drop policy if exists training_plans_select_own on public.training_plans;
create policy training_plans_select_own on public.training_plans
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.training_plans from public, anon, authenticated;
grant select on table public.training_plans to authenticated;

/**
 * Store the caller's plan (POST /v1/sync training_plan) unless the stored one
 * is newer. Returns false when an older edit arrived late and was skipped.
 * Mirrors TRAINING_LIMITS (planJsonMaxBytes, planWorkoutsMax).
 */
create or replace function public.save_my_training_plan(
  plan jsonb,
  plan_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  applied boolean;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if plan_updated_at is null then
    raise exception 'updatedAt is required' using errcode = '22023';
  end if;
  if jsonb_typeof(plan) is distinct from 'object'
     or plan->'v' is distinct from '1'::jsonb then
    raise exception 'plan must be a v1 plan object' using errcode = '22023';
  end if;
  if octet_length(plan::text) > 65536 then
    raise exception 'plan is too large' using errcode = '22023';
  end if;
  if jsonb_typeof(plan->'workouts') is distinct from 'array'
     or jsonb_array_length(plan->'workouts') > 14 then
    raise exception 'plan workouts must be an array of at most 14' using errcode = '22023';
  end if;

  insert into public.training_plans as t (user_id, plan, updated_at)
  values (me, plan, plan_updated_at)
  on conflict (user_id) do update
    set plan = excluded.plan,
        updated_at = excluded.updated_at
    where t.updated_at <= excluded.updated_at
  returning true into applied;

  return coalesce(applied, false);
end;
$$;

revoke all on function public.save_my_training_plan(jsonb, timestamptz) from public, anon;
grant execute on function public.save_my_training_plan(jsonb, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Workout sessions
-- ---------------------------------------------------------------------------

create table if not exists public.workout_sessions (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id text not null,
  workout_name text not null,
  unit public.weight_unit not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  day_key text not null,
  exercises jsonb not null,
  sets_done integer not null check (sets_done >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists workout_sessions_user_day_key_idx
  on public.workout_sessions (user_id, day_key);

alter table public.workout_sessions enable row level security;
alter table public.workout_sessions force row level security;

drop policy if exists workout_sessions_select_own on public.workout_sessions;
create policy workout_sessions_select_own on public.workout_sessions
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.workout_sessions from public, anon, authenticated;
grant select on table public.workout_sessions to authenticated;

/** True for a JSON number that is a whole number between lo and hi. */
create or replace function public.json_int_between(v jsonb, lo double precision, hi double precision)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    public.xp_json_number(v) between lo and hi
      and public.xp_json_number(v) = trunc(public.xp_json_number(v)),
    false
  );
$$;

revoke all on function public.json_int_between(jsonb, double precision, double precision)
  from public, anon, authenticated;

/**
 * Why a workout's exercises are invalid, or null when they are valid. Mirrors
 * the workout_session schema in src/types/sync.ts and TRAINING_LIMITS:
 * at most 30 exercises of at most 20 sets; weight 0–2000 (any finite number),
 * reps 0–3600 (whole; seconds for timed moves), done a boolean.
 */
create or replace function public.workout_exercises_problem(ex jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  e jsonb;
  s jsonb;
  n double precision;
begin
  if jsonb_typeof(ex) is distinct from 'array' then
    return 'exercises must be an array';
  end if;
  if octet_length(ex::text) > 65536 then
    return 'exercises are too large';
  end if;
  if jsonb_array_length(ex) > 30 then
    return 'at most 30 exercises';
  end if;

  for e in select value from jsonb_array_elements(ex) loop
    if jsonb_typeof(e) is distinct from 'object' then
      return 'each exercise must be an object';
    end if;
    if jsonb_typeof(e->'key') is distinct from 'string'
       or char_length(e->>'key') not between 1 and 64
       or jsonb_typeof(e->'exerciseId') is distinct from 'string'
       or char_length(e->>'exerciseId') not between 1 and 64 then
      return 'exercise key and exerciseId must be 1–64 characters';
    end if;
    if not public.json_int_between(e->'repsMin', 0, 3600)
       or not public.json_int_between(e->'repsMax', 0, 3600)
       or not public.json_int_between(e->'restSec', 0, 900) then
      return 'exercise reps / rest out of range';
    end if;
    if jsonb_typeof(e->'sets') is distinct from 'array'
       or jsonb_array_length(e->'sets') > 20 then
      return 'exercise sets must be an array of at most 20';
    end if;

    for s in select value from jsonb_array_elements(e->'sets') loop
      if jsonb_typeof(s) is distinct from 'object' then
        return 'each set must be an object';
      end if;
      n := public.xp_json_number(s->'weight');
      if n is null or n not between 0 and 2000 then
        return 'set weight must be 0–2000';
      end if;
      if not public.json_int_between(s->'reps', 0, 3600) then
        return 'set reps must be a whole number 0–3600';
      end if;
      if jsonb_typeof(s->'done') is distinct from 'boolean' then
        return 'set done must be true or false';
      end if;
    end loop;
  end loop;

  return null;
end;
$$;

revoke all on function public.workout_exercises_problem(jsonb)
  from public, anon, authenticated;

/**
 * Insert or replace one of the caller's finished workouts (POST /v1/sync
 * workout_session). Validates the sets (22023 → HTTP 400), derives day_key
 * from started_at and the caller's prefs, and counts completed sets for XP.
 * The client's dayKey and XP are never accepted.
 */
create or replace function public.upsert_my_workout_session(
  session_id uuid,
  session_workout_id text,
  session_workout_name text,
  session_unit text,
  session_started_at timestamptz,
  session_finished_at timestamptz,
  session_exercises jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  problem text;
  clean_name text := public.js_trim(session_workout_name);
  done_count integer;
  day_starts integer;
  zone text;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if session_id is null or session_started_at is null or session_finished_at is null then
    raise exception 'id, startedAt and finishedAt are required' using errcode = '22023';
  end if;
  if char_length(session_workout_id) is null
     or char_length(session_workout_id) not between 1 and 64 then
    raise exception 'workoutId must be 1–64 characters' using errcode = '22023';
  end if;
  if char_length(clean_name) is null or char_length(clean_name) not between 1 and 80 then
    raise exception 'workoutName must be 1–80 characters' using errcode = '22023';
  end if;
  if session_unit is null or session_unit not in ('lb', 'kg') then
    raise exception 'unit must be lb or kg' using errcode = '22023';
  end if;
  if session_finished_at < session_started_at
     or session_finished_at - session_started_at > interval '24 hours' then
    raise exception 'a workout runs 0–24 hours' using errcode = '22023';
  end if;
  if session_started_at > now() + interval '1 day' then
    raise exception 'startedAt is in the future' using errcode = '22023';
  end if;

  problem := public.workout_exercises_problem(session_exercises);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;

  select count(*)::integer into done_count
  from jsonb_array_elements(session_exercises) e,
       jsonb_array_elements(e.value->'sets') s
  where s.value->'done' = 'true'::jsonb;

  select p.day_starts_at_minutes, p.time_zone
  into day_starts, zone
  from public.prefs p
  where p.user_id = me;

  insert into public.workout_sessions (
    id, user_id, workout_id, workout_name, unit, started_at, finished_at,
    day_key, exercises, sets_done
  )
  values (
    session_id,
    me,
    session_workout_id,
    clean_name,
    session_unit::public.weight_unit,
    session_started_at,
    session_finished_at,
    public.habit_log_day_key(session_started_at, day_starts, coalesce(zone, 'UTC')),
    session_exercises,
    done_count
  )
  on conflict (user_id, id) do update
    set workout_id = excluded.workout_id,
        workout_name = excluded.workout_name,
        unit = excluded.unit,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        day_key = excluded.day_key,
        exercises = excluded.exercises,
        sets_done = excluded.sets_done;
end;
$$;

revoke all on function public.upsert_my_workout_session(
  uuid, text, text, text, timestamptz, timestamptz, jsonb
) from public, anon;
grant execute on function public.upsert_my_workout_session(
  uuid, text, text, text, timestamptz, timestamptz, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-bucket workout day keys when the day boundary changes
-- ---------------------------------------------------------------------------

/** Like on_prefs_rederive_day_keys(), for workout_sessions.started_at. */
create or replace function public.on_prefs_rederive_workout_day_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workout_sessions w
  set day_key = public.habit_log_day_key(
    w.started_at, new.day_starts_at_minutes, new.time_zone
  )
  where w.user_id = new.user_id
    and w.day_key is distinct from public.habit_log_day_key(
      w.started_at, new.day_starts_at_minutes, new.time_zone
    );
  return null;
end;
$$;

revoke all on function public.on_prefs_rederive_workout_day_keys()
  from public, anon, authenticated;

drop trigger if exists prefs_rederive_workout_day_keys on public.prefs;
create trigger prefs_rederive_workout_day_keys
  after update of time_zone, day_starts_at_minutes on public.prefs
  for each row
  when (
    old.time_zone is distinct from new.time_zone
    or old.day_starts_at_minutes is distinct from new.day_starts_at_minutes
  )
  execute function public.on_prefs_rederive_workout_day_keys();

drop trigger if exists prefs_rederive_workout_day_keys_insert on public.prefs;
create trigger prefs_rederive_workout_day_keys_insert
  after insert on public.prefs
  for each row
  execute function public.on_prefs_rederive_workout_day_keys();

-- ---------------------------------------------------------------------------
-- 4. XP rules v3
-- ---------------------------------------------------------------------------

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
  kg_per_lb constant double precision := 0.45359237;
  logs_per_type_per_day constant bigint := 3;
  log_count bigint;
  latest_weight double precision;
  latest_unit text;
  band double precision;
  food_min double precision;
  food_max double precision;
  bonus bigint := 0;
  workout_xp bigint;
  xp bigint;
  result public.xp_state;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select coalesce(sum(least(c.n, logs_per_type_per_day)), 0) into log_count
  from (
    select count(*) as n
    from public.habit_logs l
    where l.user_id = me
    group by l.day_key, l.type
  ) c;

  select * into goals
  from public.daily_goals g
  where g.user_id = me;

  if found then
    -- Newest valid weigh-in, like getLatestWeightValue() in the app.
    select public.xp_json_number(l.payload->'value'), l.payload->>'unit'
    into latest_weight, latest_unit
    from public.habit_logs l
    where l.user_id = me
      and l.type = 'weight'
      and l.payload->>'unit' in ('lb', 'kg')
      and public.xp_json_number(l.payload->'value') is not null
    order by l.timestamp desc, l.created_at desc
    limit 1;

    if latest_weight is not null and latest_unit is distinct from goals.weight_unit::text then
      latest_weight := case
        when latest_unit = 'lb' then latest_weight * kg_per_lb
        else latest_weight / kg_per_lb
      end;
    end if;

    band := case when goals.weight_unit::text = 'lb' then 2 else 1 end;

    if latest_weight is not null and latest_weight > goals.weight_goal + band then
      food_min := goals.food_kcal * 0.8;
      food_max := goals.food_kcal;
    elsif latest_weight is not null and latest_weight < goals.weight_goal - band then
      food_min := goals.food_kcal;
      food_max := 'infinity';
    else
      food_min := goals.food_kcal * 0.9;
      food_max := goals.food_kcal * 1.1;
    end if;

    select coalesce(sum(d.met * 50 + case when d.met = 6 then 100 else 0 end), 0)
    into bonus
    from (
      select
        (t.food_kcal > 0 and t.food_kcal >= food_min and t.food_kcal <= food_max)::int
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

  -- Workouts: capped per app day, so splitting one workout into many doesn't farm XP.
  select coalesce(sum(least(w.sets, 40) * 5 + least(w.workouts, 2) * 25), 0)
  into workout_xp
  from (
    select
      sum(s.sets_done) as sets,
      count(*) filter (where s.sets_done > 0) as workouts
    from public.workout_sessions s
    where s.user_id = me
    group by s.day_key
  ) w;

  xp := least(log_count * 10 + bonus + workout_xp, 2147483647);

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
