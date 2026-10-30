-- XP parity: score XP the way the app awards it, so the server total can be
-- the one number every screen shows. Idempotent. Redefines recompute_my_xp()
-- from 20261102000000_training_sync.sql, so it must sort after that file.
--
--   1. daily_goal_versions: every change to daily_goals, kept by a trigger.
--      A log is judged against the goals in place when it reached the server,
--      so changing a goal no longer rescores past days. Goals in place when
--      this file first ran apply to everything logged before it.
--   2. weight_xp_awards: weigh-in and weight-journey milestone XP, which the
--      app works out from journey settings the server doesn't have. Claimed
--      through claim_my_weight_xp() (POST /v1/sync xp_award), which bounds the
--      amounts and wants a weigh-in logged near the award.
--   3. XP rules v4: v3 with
--        - goal bonuses earned once reached during the day, like the app
--          (going over the food target later no longer takes them back)
--        - the day-complete bonus when all six goals were met at once
--        - weight XP from weight_xp_awards
--      Constants match XP_* in src/types/limits.ts and the app's
--      lib/db/xp/amounts.ts.
--
-- Function signatures are part of the PostgREST API: to change one, drop it
-- first (create or replace with new arguments adds an overload).

-- ---------------------------------------------------------------------------
-- 1. Goal history
-- ---------------------------------------------------------------------------

create table if not exists public.daily_goal_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  recorded_at timestamptz not null default now(),
  food_kcal double precision not null,
  water_amount double precision not null,
  water_unit public.water_unit not null,
  train_minutes double precision not null,
  sleep_hours double precision not null,
  steps integer not null,
  active_kcal double precision not null,
  weight_goal double precision not null,
  weight_unit public.weight_unit not null
);

create index if not exists daily_goal_versions_user_recorded_idx
  on public.daily_goal_versions (user_id, recorded_at desc, id desc);

alter table public.daily_goal_versions enable row level security;
alter table public.daily_goal_versions force row level security;
revoke all on table public.daily_goal_versions from public, anon, authenticated;

create or replace function public.record_daily_goal_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    old.food_kcal, old.water_amount, old.water_unit, old.train_minutes,
    old.sleep_hours, old.steps, old.active_kcal, old.weight_goal, old.weight_unit
  ) is not distinct from (
    new.food_kcal, new.water_amount, new.water_unit, new.train_minutes,
    new.sleep_hours, new.steps, new.active_kcal, new.weight_goal, new.weight_unit
  ) then
    return new;
  end if;

  insert into public.daily_goal_versions (
    user_id, food_kcal, water_amount, water_unit, train_minutes,
    sleep_hours, steps, active_kcal, weight_goal, weight_unit
  ) values (
    new.user_id, new.food_kcal, new.water_amount, new.water_unit,
    new.train_minutes, new.sleep_hours, new.steps, new.active_kcal,
    new.weight_goal, new.weight_unit
  );
  return new;
end;
$$;

revoke all on function public.record_daily_goal_version() from public, anon, authenticated;

drop trigger if exists daily_goals_record_version on public.daily_goals;
create trigger daily_goals_record_version
  after insert or update on public.daily_goals
  for each row execute function public.record_daily_goal_version();

-- Everything logged before this file keeps scoring against today's goals.
insert into public.daily_goal_versions (
  user_id, recorded_at, food_kcal, water_amount, water_unit, train_minutes,
  sleep_hours, steps, active_kcal, weight_goal, weight_unit
)
select
  g.user_id, '-infinity', g.food_kcal, g.water_amount, g.water_unit,
  g.train_minutes, g.sleep_hours, g.steps, g.active_kcal, g.weight_goal,
  g.weight_unit
from public.daily_goals g
where not exists (
  select 1 from public.daily_goal_versions v where v.user_id = g.user_id
);

-- ---------------------------------------------------------------------------
-- 2. Weight XP
-- ---------------------------------------------------------------------------

create table if not exists public.weight_xp_awards (
  user_id uuid not null references auth.users (id) on delete cascade,
  award_key text not null,
  reason text not null,
  amount integer not null,
  day_key date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, award_key),
  constraint weight_xp_awards_reason_ck
    check (reason in ('weigh_in', 'weight_milestone')),
  constraint weight_xp_awards_amount_ck check (amount between 1 and 250)
);

alter table public.weight_xp_awards enable row level security;
alter table public.weight_xp_awards force row level security;
revoke all on table public.weight_xp_awards from public, anon, authenticated;

/**
 * Record one weight award for the caller. Returns 'ok', 'duplicate' (already
 * claimed: nothing changes) or why it was refused. Mirrors the app:
 *   weigh_in          weight:weigh_in:<week start>, 30 + 10 per streak week, max 80
 *   weight_milestone  weight:milestone:<dir>:<unit>:<threshold>, 100
 *                     weight:goal:<dir>:<unit>:start-<start>, 250
 * A weigh-in must be logged in that week (or near the milestone day), a
 * milestone threshold must be passed by a logged weight, and at most six
 * milestone awards fit in any 7 days, so settings tricks can't farm XP.
 */
create or replace function public.claim_my_weight_xp(
  award_key text,
  reason text,
  amount integer,
  award_day_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  kg_per_lb constant double precision := 0.45359237;
  award_day date;
  week_start date;
  parts text[];
  threshold double precision;
  recent integer;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if award_key is null or length(award_key) > 120 then
    return 'bad_award_key';
  end if;
  if award_day_key is null or award_day_key !~ '^\d{4}-\d{2}-\d{2}$' then
    return 'bad_day_key';
  end if;
  begin
    award_day := award_day_key::date;
  exception when others then
    return 'bad_day_key';
  end;
  if award_day > current_date + 2 then
    return 'bad_day_key';
  end if;

  if exists (
    select 1 from public.weight_xp_awards a
    where a.user_id = me and a.award_key = claim_my_weight_xp.award_key
  ) then
    return 'duplicate';
  end if;

  if reason = 'weigh_in' then
    if award_key !~ '^weight:weigh_in:\d{4}-\d{2}-\d{2}$' then
      return 'bad_award_key';
    end if;
    if amount is null or amount not in (30, 40, 50, 60, 70, 80) then
      return 'bad_amount';
    end if;
    begin
      week_start := substr(award_key, 17)::date;
    exception when others then
      return 'bad_award_key';
    end;
    -- A day of slack each side for time zone / day boundary differences.
    if not exists (
      select 1 from public.habit_logs l
      where l.user_id = me
        and l.type = 'weight'
        and l.day_key >= to_char(week_start - 1, 'YYYY-MM-DD')
        and l.day_key <= to_char(week_start + 7, 'YYYY-MM-DD')
    ) then
      return 'no_weigh_in';
    end if;

  elsif reason = 'weight_milestone' then
    if award_key ~ '^weight:milestone:(lose|gain):(lb|kg):[0-9]+(\.[0-9]+)?$' then
      if amount is distinct from 100 then
        return 'bad_amount';
      end if;
      parts := string_to_array(award_key, ':');
      threshold := parts[5]::double precision;
      -- The threshold must be passed by a weight logged on or before the award.
      if not exists (
        select 1 from public.habit_logs l
        where l.user_id = me
          and l.type = 'weight'
          and l.payload->>'unit' in ('lb', 'kg')
          and l.day_key <= to_char(award_day + 1, 'YYYY-MM-DD')
          and (
            case
              when l.payload->>'unit' = parts[4]
                then public.xp_json_number(l.payload->'value')
              when l.payload->>'unit' = 'lb'
                then public.xp_json_number(l.payload->'value') * kg_per_lb
              else public.xp_json_number(l.payload->'value') / kg_per_lb
            end
          ) is not null
          and case parts[3]
            when 'lose' then (
              case
                when l.payload->>'unit' = parts[4]
                  then public.xp_json_number(l.payload->'value')
                when l.payload->>'unit' = 'lb'
                  then public.xp_json_number(l.payload->'value') * kg_per_lb
                else public.xp_json_number(l.payload->'value') / kg_per_lb
              end
            ) <= threshold + 0.05
            else (
              case
                when l.payload->>'unit' = parts[4]
                  then public.xp_json_number(l.payload->'value')
                when l.payload->>'unit' = 'lb'
                  then public.xp_json_number(l.payload->'value') * kg_per_lb
                else public.xp_json_number(l.payload->'value') / kg_per_lb
              end
            ) >= threshold - 0.05
          end
      ) then
        return 'no_weigh_in';
      end if;
    elsif award_key ~ '^weight:goal:(lose|gain):(lb|kg):start-[0-9]+(\.[0-9]+)?$' then
      if amount is distinct from 250 then
        return 'bad_amount';
      end if;
      if not exists (
        select 1 from public.habit_logs l
        where l.user_id = me
          and l.type = 'weight'
          and l.day_key >= to_char(award_day - 7, 'YYYY-MM-DD')
          and l.day_key <= to_char(award_day + 1, 'YYYY-MM-DD')
      ) then
        return 'no_weigh_in';
      end if;
    else
      return 'bad_award_key';
    end if;

    select count(*) into recent
    from public.weight_xp_awards a
    where a.user_id = me
      and a.reason = 'weight_milestone'
      and a.day_key between award_day - 6 and award_day + 6;
    if recent >= 6 then
      return 'too_many_milestones';
    end if;

  else
    return 'bad_reason';
  end if;

  insert into public.weight_xp_awards (user_id, award_key, reason, amount, day_key)
  values (me, claim_my_weight_xp.award_key, claim_my_weight_xp.reason,
          claim_my_weight_xp.amount, award_day)
  on conflict on constraint weight_xp_awards_pkey do nothing;
  return 'ok';
end;
$$;

revoke all on function public.claim_my_weight_xp(text, text, integer, text) from public, anon;
grant execute on function public.claim_my_weight_xp(text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. XP rules v4
-- ---------------------------------------------------------------------------

create or replace function public.recompute_my_xp()
returns public.xp_state
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  ml_per_oz constant double precision := 29.5735295625;
  kg_per_lb constant double precision := 0.45359237;
  logs_per_type_per_day constant bigint := 3;
  log_count bigint;
  bonus bigint;
  workout_xp bigint;
  weight_xp bigint;
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

  -- Goal bonuses: replay each day's logs in arrival order, judging every step
  -- against the goals (and newest weigh-in) in place at that moment, the way
  -- the app awards a goal the moment it's reached.
  with replay as (
    select
      l.day_key,
      l.created_at,
      l.id,
      g.food_kcal as goal_food,
      g.water_amount as goal_water,
      g.water_unit as goal_water_unit,
      g.train_minutes as goal_train,
      g.sleep_hours as goal_sleep,
      g.steps as goal_steps,
      g.active_kcal as goal_active,
      g.weight_goal,
      g.weight_unit,
      case
        when w.unit is null then null
        when w.unit = g.weight_unit::text then w.value
        when w.unit = 'lb' then w.value * kg_per_lb
        else w.value / kg_per_lb
      end as latest_weight,
      coalesce(sum(case when l.type = 'food'
        then public.xp_json_number(l.payload->'kcal') end) over day_so_far, 0)
        as food_kcal,
      coalesce(sum(case
        when l.type = 'water' and l.payload->>'unit' = 'ml'
          then public.xp_json_number(l.payload->'amount')
        when l.type = 'water' and l.payload->>'unit' = 'oz'
          then public.xp_json_number(l.payload->'amount') * ml_per_oz
        end) over day_so_far, 0) as water_ml,
      coalesce(sum(case when l.type = 'train'
        then public.xp_json_number(l.payload->'durationMin') end) over day_so_far, 0)
        as train_minutes,
      coalesce(sum(case when l.type = 'sleep'
        then public.xp_json_number(l.payload->'durationHours') end) over day_so_far, 0)
        as sleep_hours,
      coalesce(sum(case when l.type = 'steps'
        then public.xp_json_number(l.payload->'steps') end) over day_so_far, 0)
        as steps,
      coalesce(sum(case when l.type = 'active_kcal'
        then public.xp_json_number(l.payload->'kcal') end) over day_so_far, 0)
        as active_kcal
    from public.habit_logs l
    join lateral (
      select v.*
      from public.daily_goal_versions v
      where v.user_id = me and v.recorded_at <= l.created_at
      order by v.recorded_at desc, v.id desc
      limit 1
    ) g on true
    left join lateral (
      -- Newest valid weigh-in known then, like getLatestWeightValue() in the app.
      select public.xp_json_number(wl.payload->'value') as value,
             wl.payload->>'unit' as unit
      from public.habit_logs wl
      where wl.user_id = me
        and wl.type = 'weight'
        and wl.payload->>'unit' in ('lb', 'kg')
        and public.xp_json_number(wl.payload->'value') is not null
        and wl.created_at <= l.created_at
      order by wl.timestamp desc, wl.created_at desc
      limit 1
    ) w on true
    where l.user_id = me
      and l.type in ('food', 'water', 'train', 'sleep', 'steps', 'active_kcal')
    window day_so_far as (
      partition by l.day_key
      order by l.created_at, l.id
      rows between unbounded preceding and current row
    )
  ),
  ranged as (
    select
      s.*,
      case when s.weight_unit::text = 'lb' then 2 else 1 end as band
    from replay s
  ),
  judged as (
    select
      r.day_key,
      (
        r.goal_food > 0
        and r.food_kcal > 0
        and case
          when r.latest_weight is not null and r.latest_weight > r.weight_goal + r.band
            then r.food_kcal >= r.goal_food * 0.8 and r.food_kcal <= r.goal_food
          when r.latest_weight is not null and r.latest_weight < r.weight_goal - r.band
            then r.food_kcal >= r.goal_food
          else r.food_kcal >= r.goal_food * 0.9 and r.food_kcal <= r.goal_food * 1.1
        end
      ) as food_met,
      (
        case when r.goal_water_unit::text = 'ml'
          then r.water_ml
          else r.water_ml / ml_per_oz
        end
      ) >= r.goal_water as water_met,
      r.train_minutes >= r.goal_train as train_met,
      r.sleep_hours >= r.goal_sleep as sleep_met,
      r.steps >= r.goal_steps as steps_met,
      r.active_kcal >= r.goal_active as active_met
    from ranged r
  ),
  days as (
    select
      bool_or(j.food_met)::int
        + bool_or(j.water_met)::int
        + bool_or(j.train_met)::int
        + bool_or(j.sleep_met)::int
        + bool_or(j.steps_met)::int
        + bool_or(j.active_met)::int as met,
      bool_or(
        j.food_met and j.water_met and j.train_met
        and j.sleep_met and j.steps_met and j.active_met
      ) as all_met
    from judged j
    group by j.day_key
  )
  select coalesce(sum(d.met * 50 + case when d.all_met then 100 else 0 end), 0)
  into bonus
  from days d;

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

  select coalesce(sum(a.amount), 0) into weight_xp
  from public.weight_xp_awards a
  where a.user_id = me;

  xp := least(log_count * 10 + bonus + workout_xp + weight_xp, 2147483647);

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
