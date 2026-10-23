-- User-submitted gyms, reviewed in the owner's dashboard. Idempotent.
-- Depends on 20260816000000_gyms_chat.sql and 20261027000000_dashboard_reader_role.sql.
--
-- Flow:
--   1. The app POSTs /v1/gym-submissions; the API inserts a pending row as the
--      user (RLS: own rows only, pending only, a cap on how many are waiting).
--   2. fit-pixel-dashboard lists pending rows through the read-only
--      fit_pixel_dashboard role.
--   3. Approve / Reject in the dashboard call dashboard.approve_gym_submission /
--      dashboard.reject_gym_submission as fit_pixel_gym_reviewer. Approving
--      copies the row into public.gyms (next gym-N id) and creates its chat,
--      so every user sees it on the map.
--
-- fit_pixel_gym_reviewer can't read or write any table directly: it can only
-- run those two functions. It is created NOLOGIN; `npm run
-- db:gym-reviewer-role` gives it LOGIN and a generated password and writes
-- GYM_REVIEWER_DATABASE_URL to ../fit-pixel-dashboard/.env.local.

create table if not exists public.gym_submissions (
  id uuid primary key default gen_random_uuid(),
  submitter_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  address text,
  -- The map's "gym type" (features/map/gym-filters.ts GymKind). A hint for the
  -- reviewer only: the app reads a gym's type from its name.
  kind text,
  notes text,
  latitude double precision not null,
  longitude double precision not null,
  status text not null default 'pending',
  reviewer_notes text,
  -- The gym an approval created.
  gym_id text references public.gyms (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint gym_submissions_name_len_ck check (char_length(btrim(name)) between 2 and 80),
  constraint gym_submissions_address_len_ck check (address is null or char_length(address) <= 200),
  constraint gym_submissions_kind_len_ck check (kind is null or char_length(kind) <= 40),
  constraint gym_submissions_notes_len_ck check (notes is null or char_length(notes) <= 500),
  constraint gym_submissions_reviewer_notes_len_ck check (
    reviewer_notes is null or char_length(reviewer_notes) <= 500
  ),
  constraint gym_submissions_lat_ck check (latitude between -90 and 90),
  constraint gym_submissions_lng_ck check (longitude between -180 and 180),
  constraint gym_submissions_status_ck check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists gym_submissions_submitter_created_idx
  on public.gym_submissions (submitter_id, created_at desc);
create index if not exists gym_submissions_pending_idx
  on public.gym_submissions (created_at)
  where status = 'pending';

alter table public.gym_submissions enable row level security;
alter table public.gym_submissions force row level security;

-- How many submissions one user may have waiting at once. Keep in step with
-- GYM_SUBMISSION_LIMITS.pendingMax in src/types/limits.ts.
create or replace function public.my_pending_gym_submissions()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.gym_submissions
  where submitter_id = auth.uid() and status = 'pending';
$$;

revoke all on function public.my_pending_gym_submissions() from public, anon;
grant execute on function public.my_pending_gym_submissions() to authenticated;

drop policy if exists gym_submissions_select_own on public.gym_submissions;
create policy gym_submissions_select_own on public.gym_submissions
  for select to authenticated
  using (submitter_id = auth.uid());

drop policy if exists gym_submissions_insert_own on public.gym_submissions;
create policy gym_submissions_insert_own on public.gym_submissions
  for insert to authenticated
  with check (
    submitter_id = auth.uid()
    and status = 'pending'
    and public.my_pending_gym_submissions() < 10
  );

-- Users insert and read their own rows; only the review functions update.
revoke all on table public.gym_submissions from public, anon, authenticated;
grant select (
  id, submitter_id, name, address, kind, notes, latitude, longitude, status,
  reviewer_notes, gym_id, created_at, reviewed_at
) on table public.gym_submissions to authenticated;
grant insert (submitter_id, name, address, kind, notes, latitude, longitude)
  on table public.gym_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard: read pending rows (read-only role) and existing gym locations,
-- so the review page can map a submission and flag nearby duplicates.
-- ---------------------------------------------------------------------------

revoke all on table public.gym_submissions from fit_pixel_dashboard;
grant select (
  id, submitter_id, name, address, kind, notes, latitude, longitude, status,
  reviewer_notes, gym_id, created_at, reviewed_at
) on table public.gym_submissions to fit_pixel_dashboard;
grant select (latitude, longitude) on table public.gyms to fit_pixel_dashboard;

drop policy if exists gym_submissions_dashboard_read on public.gym_submissions;
create policy gym_submissions_dashboard_read on public.gym_submissions
  for select to fit_pixel_dashboard
  using (true);

-- ---------------------------------------------------------------------------
-- Review functions. In the dashboard schema, which PostgREST doesn't expose.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fit_pixel_gym_reviewer') then
    create role fit_pixel_gym_reviewer nologin noinherit;
  end if;
end $$;

alter role fit_pixel_gym_reviewer set statement_timeout = '15s';

create schema if not exists dashboard;
revoke all on schema dashboard from public;

-- Publish a pending submission as a gym. final_name lets the reviewer tidy the
-- name (it decides the map's gym type); null keeps the submitted one. Returns
-- the new gym id.
create or replace function dashboard.approve_gym_submission(
  submission_id uuid,
  final_name text default null,
  note text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.gym_submissions%rowtype;
  gym_name text;
  new_gym_id text;
begin
  select * into sub
  from public.gym_submissions
  where id = submission_id
  for update;

  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if sub.status <> 'pending' then
    raise exception 'Submission is already %', sub.status using errcode = '22023';
  end if;

  gym_name := coalesce(nullif(btrim(final_name), ''), btrim(sub.name));
  if char_length(gym_name) < 2 or char_length(gym_name) > 80 then
    raise exception 'Gym name must be 2 to 80 characters' using errcode = '22023';
  end if;

  -- Ids continue the seeded gym-1 … gym-80 run. The lock makes concurrent
  -- approvals take turns instead of picking the same number.
  lock table public.gyms in share row exclusive mode;
  select 'gym-' || (coalesce(max(substring(g.id from '^gym-([0-9]+)$')::integer), 0) + 1)
  into new_gym_id
  from public.gyms g;

  insert into public.gyms (id, name, latitude, longitude, image_key)
  values (new_gym_id, gym_name, sub.latitude, sub.longitude, null);

  insert into public.conversations (kind, gym_id)
  values ('gym', new_gym_id)
  on conflict (gym_id) where gym_id is not null do nothing;

  update public.gym_submissions
  set status = 'approved',
      gym_id = new_gym_id,
      reviewer_notes = nullif(btrim(note), ''),
      reviewed_at = now()
  where id = submission_id;

  return new_gym_id;
end;
$$;

create or replace function dashboard.reject_gym_submission(
  submission_id uuid,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.gym_submissions
  set status = 'rejected',
      reviewer_notes = nullif(btrim(note), ''),
      reviewed_at = now()
  where id = submission_id and status = 'pending';

  if not found then
    if exists (select 1 from public.gym_submissions where id = submission_id) then
      raise exception 'Submission is no longer pending' using errcode = '22023';
    end if;
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Functions are executable by PUBLIC by default; only the reviewer may run these.
revoke all on function dashboard.approve_gym_submission(uuid, text, text) from public;
revoke all on function dashboard.reject_gym_submission(uuid, text) from public;
grant usage on schema dashboard to fit_pixel_gym_reviewer;
grant execute on function dashboard.approve_gym_submission(uuid, text, text)
  to fit_pixel_gym_reviewer;
grant execute on function dashboard.reject_gym_submission(uuid, text)
  to fit_pixel_gym_reviewer;
