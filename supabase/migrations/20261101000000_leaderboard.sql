-- Leaderboards: friends and global, ranked by lifetime XP. Idempotent.
--
-- xp_state stays own-row-only; this security definer function is the one
-- cross-user read of levels, like pixel_cards is for names and looks. It
-- returns rank, display name, level, XP and the equipped look, nothing else.
-- People who block each other never see each other here.
--
--   friends  the caller plus accepted friends
--   global   everyone, top `max_rows` plus the caller's own row

create index if not exists xp_state_lifetime_xp_idx
  on public.xp_state (lifetime_xp desc);

create or replace function public.leaderboard(board text, max_rows integer default 50)
returns table (
  rank bigint,
  user_id uuid,
  display_name text,
  level integer,
  lifetime_xp integer,
  equipped jsonb,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row_cap integer := least(greatest(coalesce(max_rows, 50), 1), 100);
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if board not in ('friends', 'global') then
    raise exception 'unknown board' using errcode = '22023';
  end if;

  return query
  with pool as (
    select x.user_id, x.level, x.lifetime_xp
    from public.xp_state x
    where (
        board = 'global'
        or x.user_id = me
        or exists (
          select 1
          from public.friendships f
          where f.status = 'accepted'
            and f.user_lo = least(me, x.user_id)
            and f.user_hi = greatest(me, x.user_id)
        )
      )
      and (x.user_id = me or not public.users_blocked_either_way(me, x.user_id))
  ),
  ranked as (
    select
      p.*,
      rank() over (order by p.lifetime_xp desc) as place
    from pool p
  )
  select
    r.place,
    r.user_id,
    c.display_name,
    r.level,
    r.lifetime_xp,
    c.equipped,
    r.user_id = me
  from ranked r
  join public.pixel_cards c on c.user_id = r.user_id
  where r.place <= row_cap or r.user_id = me
  order by r.place, c.display_name, r.user_id;
end;
$$;

revoke all on function public.leaderboard(text, integer) from public, anon;
grant execute on function public.leaderboard(text, integer) to authenticated;
