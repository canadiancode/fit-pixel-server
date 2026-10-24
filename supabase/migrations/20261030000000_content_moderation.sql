-- Content filter for chat messages and public profile text (App Store
-- Guideline 1.2: "a method for filtering objectionable material"). Idempotent.
--
-- Runs in the database, not the API: authenticated users can insert messages
-- and upsert profiles directly through PostgREST, so a check in Express alone
-- could be skipped.
--
--   block      slurs, hate, sexual harassment, self-harm encouragement.
--              The write fails with errcode PT422 (HTTP 422 through PostgREST;
--              the API turns it into a CONTENT_BLOCKED error).
--   mask       mild swearing in messages and bios: kept, but shown as f***.
--              Blocked in display names.
--   name_only  words a display name can't use (impersonating the team).
--
-- Patterns are POSIX regex fragments matched as whole words against a
-- normalized copy of the text (lowercase, common leetspeak undone, s.p.a.c.e.d
-- letters joined). Edit them in the SQL editor:
--   insert into public.moderation_patterns (pattern, action, note) values ('…', 'block', '…');
--   delete from public.moderation_patterns where pattern = '…';
-- Existing rows are left alone by this migration, so local edits survive re-runs.

create table if not exists public.moderation_patterns (
  pattern text primary key,
  action text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint moderation_patterns_action_ck check (action in ('block', 'mask', 'name_only')),
  constraint moderation_patterns_len_ck check (char_length(pattern) between 2 and 200)
);

alter table public.moderation_patterns enable row level security;
alter table public.moderation_patterns force row level security;
revoke all on table public.moderation_patterns from anon, authenticated;

insert into public.moderation_patterns (pattern, action, note) values
  -- Racial and ethnic slurs
  ('n+i+g+g+(e+r+|a+h?|u+h)s?', 'block', 'racial slur'),
  ('n+i+g+(l+e+t|n+o+g)s?', 'block', 'racial slur'),
  ('c+h+i+n+k+s?', 'block', 'racial slur'),
  ('g+o+o+k+s?', 'block', 'racial slur'),
  ('s+p+i+c+s?', 'block', 'racial slur'),
  ('w+e+t+b+a+c+k+s?', 'block', 'racial slur'),
  ('k+i+k+e+s?', 'block', 'antisemitic slur'),
  ('r+a+g+h+e+a+d+s?', 'block', 'racial slur'),
  ('s+a+n+d+n+i+g+g+e+r+s?', 'block', 'racial slur'),
  -- Homophobic, transphobic and ableist slurs
  ('f+a+g+(g+o+t+|g+i+t)?s?', 'block', 'homophobic slur'),
  ('d+y+k+e+s?', 'block', 'homophobic slur'),
  ('t+r+a+n+n+(y|i+e+s)', 'block', 'transphobic slur'),
  ('r+e+t+a+r+d+(s|e+d)?', 'block', 'ableist slur'),
  -- Sexual harassment
  ('c+u+n+t+s?', 'block', 'sexual insult'),
  ('w+h+o+r+e+s?', 'block', 'sexual insult'),
  ('s+l+u+t+s?', 'block', 'sexual insult'),
  ('r+a+p+e+(d|s)?', 'block', 'sexual violence'),
  ('r+a+p+i+s+t+s?', 'block', 'sexual violence'),
  ('send\s+(me\s+)?(your\s+)?nudes', 'block', 'sexual solicitation'),
  ('n+u+d+e+s', 'block', 'sexual solicitation'),
  ('d+i+c+k\s*p+i+c+s?', 'block', 'sexual'),
  ('b+l+o+w\s*j+o+b+s?', 'block', 'sexual'),
  ('p+u+s+s+(y|i+e+s)', 'block', 'sexual'),
  ('p+o+r+n+', 'block', 'sexual'),
  ('o+n+l+y\s*f+a+n+s', 'block', 'sexual solicitation / spam'),
  -- Self-harm encouragement and threats
  ('k+y+s', 'block', 'self-harm encouragement'),
  ('kill\s+(yo)?ur\s*self', 'block', 'self-harm encouragement'),
  ('(hang|neck|shoot)\s+(yo)?ur\s*self', 'block', 'self-harm encouragement'),
  ('(i\s*(will|ll|''ll|am\s+going\s+to|m\s+gonna|m\s+going\s+to)\s+)(kill|murder|stab|shoot)\s+(you|u)', 'block', 'threat'),
  -- Hate symbols / slogans
  ('(sieg|seig)\s+heil', 'block', 'hate slogan'),
  ('heil\s+hitler', 'block', 'hate slogan'),
  -- Mild swearing: masked in messages and bios, blocked in names
  ('f+u+c+k+(s|e+d|e+r+s?|i+n+g?|i+n)?', 'mask', 'profanity'),
  ('m+o+t+h+e+r+f+u+c+k+(e+r+s?|i+n+g?)?', 'mask', 'profanity'),
  ('s+h+i+t+(s|t+y|t+i+n+g|h+e+a+d+s?)?', 'mask', 'profanity'),
  ('b+u+l+l+s+h+i+t+', 'mask', 'profanity'),
  ('b+i+t+c+h+(e+s|y)?', 'mask', 'profanity'),
  ('a+s+s+h+o+l+e+s?', 'mask', 'profanity'),
  ('d+i+c+k+h+e+a+d+s?', 'mask', 'profanity'),
  ('b+a+s+t+a+r+d+s?', 'mask', 'profanity'),
  ('w+a+n+k+e+r+s?', 'mask', 'profanity'),
  ('p+r+i+c+k+s?', 'mask', 'profanity'),
  -- Names that impersonate the team
  ('fit\s*pixel', 'name_only', 'impersonation'),
  ('admin(istrator)?', 'name_only', 'impersonation'),
  ('moderator|mod\s*team', 'name_only', 'impersonation'),
  ('official', 'name_only', 'impersonation'),
  ('support', 'name_only', 'impersonation')
on conflict (pattern) do nothing;

/** Lowercase, undo common leetspeak, join s.p.a.c.e.d or f-u-c-k letters. */
create or replace function public.moderation_normalize(input text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
    regexp_replace(
      translate(lower(coalesce(input, '')), '013457@$!|', 'oieastasii'),
      -- f.u.c.k, f-u-c-k, f*u*c*k → fuck
      '([a-z])[._*''\-]+(?=[a-z])', '\1', 'g'
    ),
    -- f u c k → fuck (only runs of single letters)
    '\m([a-z])\s+(?=[a-z]\M)', '\1', 'g'
  );
$$;

/**
 * The strictest action that matches `input`: 'block', 'mask', 'name_only'
 * or null. name_only patterns are checked only when for_name is true.
 */
create or replace function public.moderation_check(input text, for_name boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  norm text := public.moderation_normalize(input);
  -- Names also get a gamer-tag pass: GymRatFucker → gym rat fucker,
  -- xXslurXx → slur. Names only, since it trades some precision for reach.
  tag text := case when for_name then
    regexp_replace(
      public.moderation_normalize(regexp_replace(coalesce(input, ''), '([a-z])([A-Z])', '\1 \2', 'g')),
      '\mx+|x+\M', ' ', 'g'
    )
  end;
  re text;
begin
  if norm is null or btrim(norm) = '' then
    return null;
  end if;
  norm := norm || coalesce(' | ' || tag, '');

  select string_agg('(' || pattern || ')', '|') into re
  from public.moderation_patterns where action = 'block';
  if re is not null and norm ~ ('\m(' || re || ')\M') then
    return 'block';
  end if;

  if for_name then
    select string_agg('(' || pattern || ')', '|') into re
    from public.moderation_patterns where action = 'name_only';
    if re is not null and norm ~ ('\m(' || re || ')\M') then
      return 'name_only';
    end if;
  end if;

  select string_agg('(' || pattern || ')', '|') into re
  from public.moderation_patterns where action = 'mask';
  if re is not null and norm ~ ('\m(' || re || ')\M') then
    return 'mask';
  end if;

  return null;
end;
$$;

/** Replace each mild swear in `input` with its first letter + asterisks. */
create or replace function public.moderation_mask(input text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  re text;
  result text := input;
  start_pos integer;
  end_pos integer;
  guard integer := 0;
begin
  select '\m(' || string_agg('(' || pattern || ')', '|') || ')\M' into re
  from public.moderation_patterns where action = 'mask';
  if re is null or result is null then
    return result;
  end if;

  loop
    start_pos := regexp_instr(result, re, 1, 1, 0, 'i');
    exit when start_pos = 0 or guard > 50;
    end_pos := regexp_instr(result, re, 1, 1, 1, 'i');
    result := overlay(
      result
      placing substr(result, start_pos, 1) || repeat('*', end_pos - start_pos - 1)
      from start_pos for end_pos - start_pos
    );
    guard := guard + 1;
  end loop;
  return result;
end;
$$;

revoke all on function public.moderation_normalize(text) from public, anon, authenticated;
revoke all on function public.moderation_check(text, boolean) from public, anon, authenticated;
revoke all on function public.moderation_mask(text) from public, anon, authenticated;

-- Messages: block or mask on the way in.
create or replace function public.on_message_moderate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  verdict text := public.moderation_check(new.body, false);
begin
  if verdict = 'block' then
    raise exception 'That message breaks the community rules' using errcode = 'PT422';
  elsif verdict = 'mask' then
    new.body := public.moderation_mask(new.body);
  end if;
  return new;
end;
$$;

drop trigger if exists messages_moderate on public.messages;
create trigger messages_moderate
  before insert on public.messages
  for each row execute function public.on_message_moderate();

-- Profiles: display names are strict (no swearing, no impersonation); bios
-- follow the message rules.
create or replace function public.on_profile_moderate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  verdict text;
begin
  if tg_op = 'INSERT' or new.display_name is distinct from old.display_name then
    verdict := public.moderation_check(new.display_name, true);
    if verdict is not null then
      raise exception 'That name isn''t allowed' using errcode = 'PT422';
    end if;
  end if;

  if tg_op = 'INSERT' or new.bio is distinct from old.bio then
    verdict := public.moderation_check(new.bio, false);
    if verdict = 'block' then
      raise exception 'That bio breaks the community rules' using errcode = 'PT422';
    elsif verdict = 'mask' then
      new.bio := public.moderation_mask(new.bio);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_moderate on public.profiles;
create trigger profiles_moderate
  before insert or update of display_name, bio on public.profiles
  for each row execute function public.on_profile_moderate();
