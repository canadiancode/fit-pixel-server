-- Weight journey sync: the journey's start weight, start day, weigh-in day and
-- display settings were device-only, so a reinstall or a new phone lost the
-- journey (and the milestone gear it re-grants from it).
--
--   1. weight_journeys: one row per user, last write wins on updated_at.
--      Written only through save_my_weight_journey().
--   2. New op type 'weight_journey' (POST /v1/sync). Device-only fields
--      (reminder notification id, last Health sync) stay on the device.
--
-- Function signatures are part of the PostgREST API: to change one, drop it
-- first (create or replace with new arguments adds an overload).

alter type public.pending_op_type add value if not exists 'weight_journey';

create table if not exists public.weight_journeys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  start_weight numeric,
  start_unit text,
  start_day_key text,
  weigh_in_weekday smallint not null default 1,
  reminder_enabled boolean not null default true,
  hide_numbers boolean not null default false,
  updated_at timestamptz not null,
  constraint weight_journeys_start_ck check (
    (start_weight is null and start_unit is null)
    or (
      start_unit in ('lb', 'kg')
      and start_weight > 0
      and start_weight <= case start_unit when 'lb' then 1500 else 700 end
    )
  ),
  constraint weight_journeys_day_key_ck check (
    start_day_key is null or start_day_key ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  constraint weight_journeys_weekday_ck check (weigh_in_weekday between 0 and 6)
);

alter table public.weight_journeys enable row level security;
alter table public.weight_journeys force row level security;

drop policy if exists weight_journeys_select_own on public.weight_journeys;
create policy weight_journeys_select_own on public.weight_journeys
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.weight_journeys from public, anon, authenticated;
grant select on table public.weight_journeys to authenticated;

/**
 * Store the caller's weight journey (POST /v1/sync weight_journey) unless the
 * stored one is newer. Returns false when an older edit arrived late.
 * Mirrors the weightJourneyPayloadSchema bounds in src/types/sync.ts.
 */
create or replace function public.save_my_weight_journey(
  journey_start_weight numeric,
  journey_start_unit text,
  journey_start_day_key text,
  journey_weigh_in_weekday smallint,
  journey_reminder_enabled boolean,
  journey_hide_numbers boolean,
  journey_updated_at timestamptz
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
  if journey_updated_at is null then
    raise exception 'updatedAt is required' using errcode = '22023';
  end if;
  if (journey_start_weight is null) <> (journey_start_unit is null) then
    raise exception 'startWeight and startUnit go together' using errcode = '22023';
  end if;
  if journey_start_unit is not null
     and (journey_start_unit not in ('lb', 'kg')
          or journey_start_weight <= 0
          or journey_start_weight > case journey_start_unit when 'lb' then 1500 else 700 end) then
    raise exception 'startWeight is out of range' using errcode = '22023';
  end if;
  if journey_start_day_key is not null
     and journey_start_day_key !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'startDayKey must be YYYY-MM-DD' using errcode = '22023';
  end if;
  if journey_weigh_in_weekday is null or journey_weigh_in_weekday not between 0 and 6 then
    raise exception 'weighInWeekday must be 0-6' using errcode = '22023';
  end if;

  insert into public.weight_journeys as w (
    user_id, start_weight, start_unit, start_day_key, weigh_in_weekday,
    reminder_enabled, hide_numbers, updated_at
  )
  values (
    me, journey_start_weight, journey_start_unit, journey_start_day_key,
    journey_weigh_in_weekday, coalesce(journey_reminder_enabled, true),
    coalesce(journey_hide_numbers, false), journey_updated_at
  )
  on conflict (user_id) do update
    set start_weight = excluded.start_weight,
        start_unit = excluded.start_unit,
        start_day_key = excluded.start_day_key,
        weigh_in_weekday = excluded.weigh_in_weekday,
        reminder_enabled = excluded.reminder_enabled,
        hide_numbers = excluded.hide_numbers,
        updated_at = excluded.updated_at
    where w.updated_at <= excluded.updated_at
  returning true into applied;

  return coalesce(applied, false);
end;
$$;

revoke all on function public.save_my_weight_journey(
  numeric, text, text, smallint, boolean, boolean, timestamptz
) from public, anon;
grant execute on function public.save_my_weight_journey(
  numeric, text, text, smallint, boolean, boolean, timestamptz
) to authenticated;
