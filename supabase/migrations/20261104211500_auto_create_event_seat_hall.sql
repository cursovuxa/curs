create or replace function public.ensure_event_seat_hall(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.events%rowtype;
  v_hall_id uuid;
  v_capacity integer;
  v_cols integer;
begin
  select * into e from public.events
   where id = p_event_id and status = 'published'
   for update;
  if not found then raise exception 'event_unavailable'; end if;
  if e.hall_id is not null then return e.hall_id; end if;

  v_capacity := greatest(coalesce(e.total_seats, e.available_seats, 1), 1);
  if v_capacity > 2000 then return null; end if;
  v_cols := least(v_capacity, 12);

  insert into public.halls(venue_id, name, total_capacity, layout_config)
  values (
    e.venue_id,
    left(coalesce(nullif(trim(e.title), ''), 'Мероприятие'), 120) || ' — зал',
    v_capacity,
    jsonb_build_object('rows', ceil(v_capacity::numeric / v_cols)::integer, 'cols', v_cols)
  )
  returning id into v_hall_id;

  update public.events set hall_id = v_hall_id, updated_at = now() where id = e.id;
  return v_hall_id;
end;
$$;

revoke all on function public.ensure_event_seat_hall(uuid) from public, anon, authenticated;
grant execute on function public.ensure_event_seat_hall(uuid) to service_role;
