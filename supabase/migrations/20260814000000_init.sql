-- Fit Pixel initial schema. Apply to the existing Supabase project.
-- RLS on every user table: user_id = auth.uid().
-- No passwords, lat/lng, or raw HealthKit blobs.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.habit_log_type as enum (
    'water', 'food', 'train', 'sleep', 'weight', 'steps', 'active_kcal'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.habit_log_source as enum ('manual', 'healthkit', 'import');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.water_unit as enum ('oz', 'ml');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.weight_unit as enum ('lb', 'kg');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.unit_system as enum ('metric', 'imperial');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.food_meal_type as enum (
    'breakfast', 'lunch', 'dinner', 'snack', 'other'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sync_op_status as enum ('synced', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pending_op_type as enum (
    'habit_log',
    'daily_goals',
    'xp_award',
    'inventory_unlock',
    'loadout',
    'profile',
    'prefs',
    'saved_meal'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  bio text not null default '',
  home_gym_id text,
  home_gym_name text,
  profile_visible boolean not null default false,
  instagram text,
  tiktok text,
  youtube text,
  updated_at timestamptz not null default now()
);

create table if not exists public.prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  unit_system public.unit_system not null default 'imperial',
  selected_theme_id text not null default 'blue',
  notif_accountability boolean not null default false,
  notif_news boolean not null default false,
  day_starts_at_minutes integer not null default 0
    check (day_starts_at_minutes >= 0 and day_starts_at_minutes <= 1439),
  time_zone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_goals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  food_kcal double precision not null default 2500,
  water_amount double precision not null default 80,
  water_unit public.water_unit not null default 'oz',
  train_minutes double precision not null default 60,
  sleep_hours double precision not null default 8,
  steps integer not null default 10000,
  active_kcal double precision not null default 800,
  weight_goal double precision not null default 123,
  weight_unit public.weight_unit not null default 'lb',
  updated_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.habit_log_type not null,
  timestamp timestamptz not null,
  created_at timestamptz not null default now(),
  notes text,
  day_key text not null,
  source public.habit_log_source not null default 'manual',
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create index if not exists habit_logs_user_day_key_idx
  on public.habit_logs (user_id, day_key);

create index if not exists habit_logs_user_timestamp_idx
  on public.habit_logs (user_id, timestamp);

create table if not exists public.saved_meals (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  vendor text,
  portion_size text,
  kcal double precision not null,
  protein_g double precision,
  carbs_g double precision,
  fat_g double precision,
  meal_type public.food_meal_type,
  deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.loadouts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  equipped jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_ops (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.pending_op_type not null,
  status public.sync_op_status not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.xp_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lifetime_xp integer not null default 0 check (lifetime_xp >= 0),
  level integer not null default 0 check (level >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- New-user seed (security definer — not a client service-role call)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, profile_visible)
  values (new.id, false)
  on conflict (user_id) do nothing;

  insert into public.prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.daily_goals (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.xp_state (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.loadouts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.prefs enable row level security;
alter table public.prefs force row level security;
alter table public.daily_goals enable row level security;
alter table public.daily_goals force row level security;
alter table public.habit_logs enable row level security;
alter table public.habit_logs force row level security;
alter table public.saved_meals enable row level security;
alter table public.saved_meals force row level security;
alter table public.loadouts enable row level security;
alter table public.loadouts force row level security;
alter table public.sync_ops enable row level security;
alter table public.sync_ops force row level security;
alter table public.xp_state enable row level security;
alter table public.xp_state force row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists prefs_own on public.prefs;
create policy prefs_own on public.prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists daily_goals_own on public.daily_goals;
create policy daily_goals_own on public.daily_goals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists habit_logs_own on public.habit_logs;
create policy habit_logs_own on public.habit_logs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists saved_meals_own on public.saved_meals;
create policy saved_meals_own on public.saved_meals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists loadouts_own on public.loadouts;
create policy loadouts_own on public.loadouts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists sync_ops_own on public.sync_ops;
create policy sync_ops_own on public.sync_ops
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists xp_state_own on public.xp_state;
create policy xp_state_own on public.xp_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants: authenticated only. anon/public get nothing.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from public, anon;
revoke all on table public.prefs from public, anon;
revoke all on table public.daily_goals from public, anon;
revoke all on table public.habit_logs from public, anon;
revoke all on table public.saved_meals from public, anon;
revoke all on table public.loadouts from public, anon;
revoke all on table public.sync_ops from public, anon;
revoke all on table public.xp_state from public, anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.prefs to authenticated;
grant select, insert, update, delete on table public.daily_goals to authenticated;
grant select, insert, update, delete on table public.habit_logs to authenticated;
grant select, insert, update, delete on table public.saved_meals to authenticated;
grant select, insert, update, delete on table public.loadouts to authenticated;
grant select, insert, update, delete on table public.sync_ops to authenticated;
grant select, insert, update, delete on table public.xp_state to authenticated;
