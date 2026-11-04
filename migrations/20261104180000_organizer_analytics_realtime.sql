-- Organizer analytics source attribution and securely scoped realtime invalidation.
alter table public.registrations
  add column if not exists source text not null default 'legacy';

create table if not exists public.event_analytics_updates (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  organizer_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists event_analytics_updates_event_created_idx
  on public.event_analytics_updates (event_id, created_at desc);

alter table public.event_analytics_updates enable row level security;
revoke all on public.event_analytics_updates from anon;
grant select on public.event_analytics_updates to authenticated;
grant insert, select on public.event_analytics_updates to service_role;

drop policy if exists "Organizers can receive their event analytics updates" on public.event_analytics_updates;
create policy "Organizers can receive their event analytics updates"
  on public.event_analytics_updates
  for select
  to authenticated
  using (organizer_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'event_analytics_updates'
     ) then
    alter publication supabase_realtime add table public.event_analytics_updates;
  end if;
end $$;

create or replace function public.get_organizer_event_analytics(p_event_id uuid, p_organizer_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with event_row as (
    select id, organizer_id, total_seats, available_seats, start_date, start_time, end_time
    from public.events
    where id = p_event_id and organizer_id = p_organizer_id
  ),
  ticket_stats as (
    select
      count(*) filter (where status::text in ('valid','used'))::integer as registrations,
      count(*) filter (where status::text in ('cancelled','refunded'))::integer as cancellations,
      count(*) filter (where status::text = 'used')::integer as visitors,
      count(*) filter (where status::text = 'valid')::integer as not_checked_in,
      count(*) filter (where status::text in ('valid','used') and seat_type::text = 'vip')::integer as vip_count,
      coalesce(sum(price_paid) filter (where status::text in ('valid','used')),0)::numeric as revenue
    from public.tickets
    where event_id = p_event_id
  ),
  rating_stats as (
    select round(avg(overall_rating)::numeric, 1) as average_rating, count(*)::integer as review_count
    from public.reviews
    where event_id = p_event_id
  ),
  view_stats as (
    select coalesce(sum(view_count),0)::integer as views, count(*)::integer as visitors
    from public.event_views
    where event_id = p_event_id
  ),
  favorite_stats as (
    select count(*)::integer as favorites
    from public.favorites
    where event_id = p_event_id
  ),
  source_stats as (
    select coalesce(
      jsonb_agg(jsonb_build_object('source', source, 'count', n) order by n desc),
      '[]'::jsonb
    ) as sources
    from (
      select
        case r.source
          when 'catalog' then 'catalog'
          when 'search' then 'search'
          when 'recommendations' then 'recommendations'
          when 'map' then 'map'
          when 'calendar' then 'calendar'
          when 'nearby' then 'nearby'
          when 'external' then 'external'
          else 'legacy'
        end as source,
        count(*)::integer as n
      from public.registrations r
      join public.tickets t on t.registration_id = r.id
      where r.event_id = p_event_id and t.status::text in ('valid','used')
      group by 1
    ) grouped_sources
  )
  select case when e.id is null then null else jsonb_build_object(
    'registrations', ts.registrations,
    'cancellations', ts.cancellations,
    'visitors', ts.visitors,
    'notCheckedIn', ts.not_checked_in,
    'vipCount', ts.vip_count,
    'revenue', ts.revenue,
    'totalSeats', greatest(0, coalesce(e.total_seats,0)),
    'freeSeats', greatest(0, coalesce(e.available_seats,0)),
    'occupiedSeats', greatest(0, coalesce(e.total_seats,0) - coalesce(e.available_seats,0)),
    'occupancyPercent', case when coalesce(e.total_seats,0) > 0
      then round((greatest(0, coalesce(e.total_seats,0)-coalesce(e.available_seats,0))::numeric / e.total_seats) * 100, 1)
      else 0 end,
    'averageRating', rs.average_rating,
    'reviewCount', rs.review_count,
    'views', vs.views,
    'uniqueViewers', vs.visitors,
    'favorites', fs.favorites,
    'popularity', vs.views + fs.favorites * 3 + ts.registrations * 5,
    'sources', ss.sources,
    'eventStarted', (e.start_date + coalesce(e.start_time, time '00:00')) <= timezone('Asia/Qyzylorda', now())::timestamp,
    'eventFinished', (e.start_date + coalesce(e.end_time, e.start_time, time '23:59')) <= timezone('Asia/Qyzylorda', now())::timestamp
  ) end
  from (select 1) singleton
  left join event_row e on true
  cross join ticket_stats ts
  cross join rating_stats rs
  cross join view_stats vs
  cross join favorite_stats fs
  cross join source_stats ss;
$$;

revoke all on function public.get_organizer_event_analytics(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_organizer_event_analytics(uuid, uuid) to service_role;
