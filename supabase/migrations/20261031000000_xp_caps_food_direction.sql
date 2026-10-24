-- XP rules v2, redefining recompute_my_xp() from 20261021000000_harden_direct_writes.sql.
-- Idempotent; touches no grants beyond the function's own.
--
--   1. Daily cap per action: only the first 3 logs of each type per day earn
--      the 10 XP log reward, so splitting one drink into many logs doesn't
--      farm XP (XP_HABIT_LOGS_PER_TYPE_PER_DAY in src/types/limits.ts).
--   2. The food goal follows the weight journey, judged from the newest
--      weigh-in against daily_goals.weight_goal (±2 lb / ±1 kg = maintaining):
--        losing       met at 80–100% of food_kcal (staying under counts)
--        gaining      met at 100% or more
--        maintaining  met at 90–110% (also when there is no weigh-in yet)
--
-- Mirrors the app's lib/db/daily-summary/food-goal.ts and lib/db/xp/amounts.ts.

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
