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
  old_ticket record;
  free_seat record;
begin
  select * into e from public.events
   where id = p_event_id and status = 'published'
   for update;
  if not found then raise exception 'event_unavailable'; end if;

  v_hall_id := e.hall_id;
  if v_hall_id is null then
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
  end if;

  perform public.ensure_hall_seats(v_hall_id);

  for old_ticket in
    select id from public.tickets
     where event_id = e.id and seat_id is null and status in ('valid', 'used')
     order by created_at, id
     for update
  loop
    select s.id, s.row_label, s.seat_number, s.seat_type
      into free_seat
      from public.seats s
     where s.hall_id = v_hall_id
       and not exists (
         select 1 from public.tickets t
          where t.event_id = e.id and t.seat_id = s.id and t.status in ('valid', 'used')
       )
       and not exists (
         select 1 from public.seat_reservations r
          where r.event_id = e.id and r.seat_id = s.id
            and r.status = 'reserved' and r.reserved_until > now()
       )
     order by s.row_label, s.seat_number
     limit 1
     for update of s skip locked;

    if not found then exit; end if;
    update public.tickets
       set seat_id = free_seat.id,
           seat_label = free_seat.row_label || free_seat.seat_number::text,
           seat_type = free_seat.seat_type
     where id = old_ticket.id;
  end loop;

  return v_hall_id;
end;
$$;

revoke all on function public.ensure_event_seat_hall(uuid) from public, anon, authenticated;
grant execute on function public.ensure_event_seat_hall(uuid) to service_role;
