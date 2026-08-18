-- Gym catalog + gym/DM chat. Idempotent.
-- Gym ids stay text (gym-1 … gym-80) to match the map and profiles.home_gym_id.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.conversation_kind as enum ('gym', 'dm');
exception when duplicate_object then null;
end $$;

create table if not exists public.gyms (
  id text primary key,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  image_key text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  gym_id text references public.gyms (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversations_kind_gym_ck check (
    (kind = 'gym' and gym_id is not null)
    or (kind = 'dm' and gym_id is null)
  )
);

create unique index if not exists conversations_gym_id_uidx
  on public.conversations (gym_id)
  where gym_id is not null;

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_id_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint messages_body_len_ck check (
    char_length(body) >= 1 and char_length(body) <= 2000
  )
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create table if not exists public.dm_pairs (
  user_lo uuid not null references auth.users (id) on delete cascade,
  user_hi uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null unique references public.conversations (id) on delete cascade,
  primary key (user_lo, user_hi),
  constraint dm_pairs_ordered_ck check (user_lo < user_hi)
);

insert into public.gyms (id, name, latitude, longitude, image_key)
values
  ('gym-1', 'Fitness World (Howe St, Vancouver)', 49.2775605, -123.12733209999998, null),
  ('gym-2', 'Fitness World (W Georgia St, Vancouver)', 49.2872573, -123.1247192, null),
  ('gym-3', 'Evolve Strength Post', 49.280815399999994, -123.11450789999999, null),
  ('gym-4', 'Equinox West Georgia Street', 49.286273099999995, -123.1235959, null),
  ('gym-5', 'Kommunity Fitness', 49.2742341, -123.1245598, null),
  ('gym-6', 'YWCA Health + Fitness Centre', 49.2855157, -123.11780759999999, null),
  ('gym-7', 'Creekside Community Recreation Centre', 49.2717357, -123.10538419999999, null),
  ('gym-8', 'Olympus Fitness Centre', 49.2699098, -123.07123209999999, null),
  ('gym-9', 'Hillcrest Community Centre', 49.2437477, -123.1078644, null),
  ('gym-10', 'Fitness World (Cambie/Broadway, Vancouver)', 49.260723399999996, -123.117342, null),
  ('gym-11', '24 HR Flex Fitness Club + Personal Training (Surrey/Delta)', 49.1326433, -122.88921979999999, null),
  ('gym-12', 'Fitness World (South Surrey)', 49.048427100000005, -122.78251979999999, null),
  ('gym-13', 'Level Up Fitness Club (Surrey)', 49.154289899999995, -122.863237, null),
  ('gym-14', 'Fitness World (Central Ave, Surrey)', 49.190436, -122.8395627, null),
  ('gym-15', '24HR Sandcastle Fitness Club + Personal Training', 49.03729070000001, -122.8004378, null),
  ('gym-16', 'Platinum Athletic Club (Surrey)', 49.1416259, -122.84783099999999, null),
  ('gym-17', 'Guildford Recreation Centre', 49.193605899999994, -122.802882, null),
  ('gym-18', 'Fitness World (152 St, Surrey)', 49.0333136, -122.80379239999999, null),
  ('gym-19', 'Planet Fitness (King George Blvd, Surrey)', 49.13071, -122.84623999999998, null),
  ('gym-20', 'Planet Fitness (10642 King George Blvd, Surrey)', 49.19591, -122.84376999999999, null),
  ('gym-21', 'Vitality Fitness (Burnaby)', 49.219223899999996, -122.94980590000002, null),
  ('gym-22', 'Fitness World (Lougheed, Burnaby)', 49.2514295, -122.89649790000001, null),
  ('gym-23', 'Fitness 2000 Athletic Club (Burnaby)', 49.251753199999996, -122.9015933, null),
  ('gym-24', 'SFU Fitness Centre', 49.279284499999996, -122.92273060000001, null),
  ('gym-25', 'Fitness World (Kingsway, Burnaby)', 49.223107899999995, -122.9851946, null),
  ('gym-26', 'Evolve Strength Brentwood (Burnaby)', 49.267862699999995, -123.00281899999999, null),
  ('gym-27', 'Anytime Fitness (Hastings St, Burnaby)', 49.2813814, -123.02168340000001, null),
  ('gym-28', 'Anytime Fitness (Royal Oak Ave, Burnaby)', 49.214317799999996, -122.98914990000002, null),
  ('gym-29', 'Foundation Fitness Studio (Burnaby)', 49.280841099999996, -123.0179141, null),
  ('gym-30', 'GoodLife Fitness Burnaby Metrotown', 49.230216999999996, -123.004014, null),
  ('gym-31', 'Richmond Sports and Fitness', 49.1955604, -123.09218589999999, null),
  ('gym-32', 'Fittopia Fitness Center (Richmond)', 49.1784581, -123.13826939999998, null),
  ('gym-33', 'Minoru Centre for Active Living (Richmond)', 49.1635397, -123.1458103, null),
  ('gym-34', 'Fitness World (Lansdowne, Richmond)', 49.1736192, -123.14631489999998, null),
  ('gym-35', 'Anytime Fitness (No 3 Rd, Richmond)', 49.139649299999995, -123.13790009999998, null),
  ('gym-36', 'South Arm Community Fitness Centre (Richmond)', 49.1400797, -123.1275965, null),
  ('gym-37', 'Anytime Fitness (No 5 Rd, Richmond)', 49.1337091, -123.0915977, null),
  ('gym-38', 'Sunset HQ (Richmond)', 49.1282959, -123.09736509999999, null),
  ('gym-39', 'Club16 Trevor Linden Fitness (Richmond)', 49.1873027, -123.110077, null),
  ('gym-40', 'Fit4Less (Richmond)', 49.154593000000006, -123.12392399999999, null),
  ('gym-41', 'Fitness Unlimited Athletic Club (Langley)', 49.1065873, -122.6538671, null),
  ('gym-42', 'Fitness World (Willowbrook, Langley)', 49.1173286, -122.67031089999999, null),
  ('gym-43', '24HR Lionheart Fitness Langley', 49.1776979, -122.67107730000001, null),
  ('gym-44', 'Planet Fitness (Langley)', 49.10219, -122.65786999999997, null),
  ('gym-45', 'Total Fitness (Langley)', 49.169822599999996, -122.664215, null),
  ('gym-46', 'Gold''s Gym Langley', 49.151384099999994, -122.668916, 'golds-gym-langley'),
  ('gym-47', 'Club16 Trevor Linden Fitness (Langley)', 49.1146817, -122.66383479999998, null),
  ('gym-48', 'Anytime Fitness (Fraser Hwy, Langley)', 49.088681799999996, -122.5980881, null),
  ('gym-49', 'Fit4Less (Langley)', 49.116808999999996, -122.66869399999997, null),
  ('gym-50', 'Timms Community Centre (Langley)', 49.1039993, -122.65743180000001, null),
  ('gym-51', 'Anytime Fitness Burquitlam (Coquitlam)', 49.259095099999996, -122.8925089, null),
  ('gym-52', 'Poirier Sport & Leisure Complex (Coquitlam)', 49.2549668, -122.84549489999999, null),
  ('gym-53', 'Planet Fitness (Lougheed Hwy, Coquitlam)', 49.27319, -122.79309, null),
  ('gym-54', 'Anytime Fitness (Austin Ave, Coquitlam)', 49.248816299999994, -122.8170954, null),
  ('gym-55', 'Gold''s Gym Port Coquitlam', 49.2638858, -122.769435, null),
  ('gym-56', 'Game Ready Fitness (Coquitlam)', 49.2771925, -122.8123136, null),
  ('gym-57', 'Rocky Point Fitness And Health Club (Coquitlam)', 49.2389546, -122.85078899999998, null),
  ('gym-58', 'Club16 Trevor Linden Fitness (Coquitlam)', 49.2783606, -122.8131893, null),
  ('gym-59', 'Pinetree Community Centre (Coquitlam)', 49.289399599999996, -122.79152, null),
  ('gym-60', 'Lagree West — Coquitlam', 49.2839543, -122.8098779, null),
  ('gym-61', 'GoodLife Fitness Abbotsford South Fraser', 49.050534999999996, -122.32468899999999, null),
  ('gym-62', 'Anytime Fitness High Street (Abbotsford)', 49.058817999999995, -122.3782026, null),
  ('gym-63', 'Bolt Fitness (Abbotsford)', 49.0683947, -122.3586203, null),
  ('gym-64', 'Art of Fitness (Abbotsford)', 49.0461242, -122.29201710000001, null),
  ('gym-65', 'Club16 Trevor Linden Fitness (Abbotsford)', 49.053146299999995, -122.32188660000001, null),
  ('gym-66', 'Great West Fitness & Tennis (Abbotsford)', 49.047073399999995, -122.2691892, null),
  ('gym-67', 'Anytime Fitness (N Parallel Rd, Abbotsford)', 49.0370371, -122.23077039999998, null),
  ('gym-68', 'The Fitness Lab (Abbotsford)', 49.044522699999995, -122.2812596, null),
  ('gym-69', 'Abbotsford Recreation Centre', 49.047961199999996, -122.26236949999999, null),
  ('gym-70', 'Planet Fitness (Abbotsford)', 49.044399999999996, -122.29478999999999, null),
  ('gym-71', 'təməsew̓txʷ Aquatic and Community Centre (New Westminster)', 49.221286299999996, -122.90812129999998, null),
  ('gym-72', 'Planet Fitness (New Westminster)', 49.21257, -122.91918999999999, null),
  ('gym-73', 'Dynamic Health and Fitness (New Westminster)', 49.200939, -122.91301929999999, null),
  ('gym-74', 'Anytime Fitness (6th St, New Westminster)', 49.2115831, -122.9239127, null),
  ('gym-75', 'Snap Fitness New Westminster', 49.224990399999996, -122.89123979999998, null),
  ('gym-76', 'EZ Fit (New Westminster)', 49.204263700000006, -122.9094798, null),
  ('gym-77', 'Steel House Fitness (New Westminster)', 49.193518700000006, -122.94945440000001, null),
  ('gym-78', 'Queen''s Park Sportsplex (New Westminster)', 49.213536100000006, -122.90377689999998, null),
  ('gym-79', 'Queensborough Community Centre (New Westminster)', 49.1859007, -122.9435704, null),
  ('gym-80', 'Anytime Fitness (Ewen Ave, New Westminster)', 49.1845451, -122.9495103, null)
on conflict (id) do nothing;

insert into public.conversations (kind, gym_id)
select 'gym'::public.conversation_kind, g.id
from public.gyms g
on conflict (gym_id) where gym_id is not null do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_conversation_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = cid
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create or replace function public.create_or_get_dm(peer_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id uuid;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if peer_user_id is null or peer_user_id = me then
    raise exception 'invalid peer' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p where p.user_id = peer_user_id
  ) then
    raise exception 'peer not found' using errcode = 'P0002';
  end if;

  if me < peer_user_id then
    lo := me;
    hi := peer_user_id;
  else
    lo := peer_user_id;
    hi := me;
  end if;

  select dp.conversation_id into conv_id
  from public.dm_pairs dp
  where dp.user_lo = lo and dp.user_hi = hi;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations (kind) values ('dm')
  returning id into conv_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (conv_id, me), (conv_id, peer_user_id);

  insert into public.dm_pairs (user_lo, user_hi, conversation_id)
  values (lo, hi, conv_id);

  return conv_id;
exception
  when unique_violation then
    select dp.conversation_id into conv_id
    from public.dm_pairs dp
    where dp.user_lo = lo and dp.user_hi = hi;
    return conv_id;
end;
$$;

revoke all on function public.create_or_get_dm(uuid) from public, anon;
grant execute on function public.create_or_get_dm(uuid) to authenticated;

create or replace view public.chat_authors as
select user_id, display_name
from public.profiles;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.gyms enable row level security;
alter table public.gyms force row level security;
alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_members force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;
alter table public.dm_pairs enable row level security;
alter table public.dm_pairs force row level security;

drop policy if exists gyms_select_authenticated on public.gyms;
create policy gyms_select_authenticated on public.gyms
  for select to authenticated
  using (true);

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    kind = 'gym'
    or public.is_conversation_member(id)
  );

drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_conversation_member(conversation_id)
  );

drop policy if exists conversation_members_insert_gym_self on public.conversation_members;
create policy conversation_members_insert_gym_self on public.conversation_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.kind = 'gym'
    )
  );

drop policy if exists conversation_members_update_self on public.conversation_members;
create policy conversation_members_update_self on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists conversation_members_delete_gym_self on public.conversation_members;
create policy conversation_members_delete_gym_self on public.conversation_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.kind = 'gym'
    )
  );

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists dm_pairs_select_own on public.dm_pairs;
create policy dm_pairs_select_own on public.dm_pairs
  for select to authenticated
  using (user_lo = auth.uid() or user_hi = auth.uid());

revoke all on table public.gyms from public, anon;
revoke all on table public.conversations from public, anon;
revoke all on table public.conversation_members from public, anon;
revoke all on table public.messages from public, anon;
revoke all on table public.dm_pairs from public, anon;
revoke all on table public.chat_authors from public, anon;

grant select on table public.gyms to authenticated;
grant select on table public.conversations to authenticated;
grant select, insert, update, delete on table public.conversation_members to authenticated;
grant select, insert, update on table public.messages to authenticated;
grant select on table public.dm_pairs to authenticated;
grant select on table public.chat_authors to authenticated;

alter table public.messages replica identity full;
alter table public.conversation_members replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'conversation_members'
     ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end $$;
