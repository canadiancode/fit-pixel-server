-- Pre-launch waitlist from fitpixel.app. Idempotent.
--
-- The site POSTs /v1/waitlist (no sign-in); the API calls public.join_waitlist
-- with the anon key. Nobody can read the table through PostgREST: anon and
-- authenticated get no table privileges and there are no RLS policies, so the
-- list is only visible to the database owner (SQL editor / DATABASE_URL).

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  platform text not null,
  source text,
  created_at timestamptz not null default now(),
  -- Set when the "it's live" email has gone out to this address.
  notified_at timestamptz,
  constraint waitlist_email_len_ck check (char_length(email) between 3 and 254),
  constraint waitlist_email_lower_ck check (email = lower(email)),
  constraint waitlist_platform_ck check (platform in ('ios', 'android')),
  constraint waitlist_source_len_ck check (source is null or char_length(source) <= 200)
);

alter table public.waitlist enable row level security;
alter table public.waitlist force row level security;
revoke all on public.waitlist from anon, authenticated;

-- Signing up twice just updates the platform; it never reveals whether an
-- address was already on the list.
create or replace function public.join_waitlist(p_email text, p_platform text, p_source text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_email text := lower(btrim(p_email));
begin
  if clean_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(clean_email) > 254 then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;

  insert into public.waitlist (email, platform, source)
  values (clean_email, p_platform, nullif(left(btrim(coalesce(p_source, '')), 200), ''))
  on conflict (email) do update set platform = excluded.platform;
end;
$$;

revoke all on function public.join_waitlist(text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text) to anon;
