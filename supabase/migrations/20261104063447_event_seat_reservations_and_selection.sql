-- Real seat maps and ten-minute seat holds.
create index if not exists tickets_event_seat_live_idx
  on public.tickets(event_id, seat_id)
  where seat_id is not null and status in ('valid', 'used');

create index if not exists seat_reservations_event_expiry_idx
  on public.seat_reservations(event_id, reserved_until)
  where status = 'reserved';

create or replace function public.ensure_hall_seats(p_hall_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capacity integer;
  v_cols integer;
  v_rows integer;
  v_i integer;
  v_row integer;
  v_col integer;
  v_label text;
  v_type seat_type_enum;
  v_added integer := 0;
begin
  select least(greatest(coalesce(total_capacity, 1), 1), 2000),
         least(greatest(coalesce((layout_config->>'cols')::integer, 10), 1), 40)
    into v_capacity, v_cols
    from public.halls where id = p_hall_id;
  if not found then raise exception 'hall_not_found'; end if;

  v_rows := ceil(v_capacity::numeric / v_cols)::integer;
  for v_i in 1..v_capacity loop
    v_row := ceil(v_i::numeric / v_cols)::integer;
    v_col := ((v_i - 1) % v_cols) + 1;
    v_label := case when v_row <= 26 then chr(64 + v_row) else 'R' || v_row::text end;
    v_type := case
      when v_row = v_rows and v_col = 1 then 'accessible'::seat_type_enum
      when v_row = 1 then 'vip'::seat_type_enum
      when v_row = 2 then 'business'::seat_type_enum
      else 'standard'::seat_type_enum
    end;
    insert into public.seats(hall_id, row_label, seat_number, seat_type, price_multiplier)
    values (p_hall_id, v_label, v_col, v_type,
      case v_type when 'vip' then 1.5 when 'business' then 1.25 else 1.0 end)
    on conflict (hall_id, row_label, seat_number) do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;
  return v_added;
end;
$$;

create or replace function public.reserve_event_seat(p_user_id uuid, p_event_id uuid, p_seat_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.events%rowtype;
  s public.seats%rowtype;
  r public.seat_reservations%rowtype;
begin
  select * into e from public.events where id = p_event_id and status = 'published' for update;
  if not found or e.hall_id is null then raise exception 'event_unavailable'; end if;
  if coalesce(e.available_seats, 0) < 1 then raise exception 'sold_out'; end if;

  select * into s from public.seats
    where id = p_seat_id and hall_id = e.hall_id for update;
  if not found then raise exception 'seat_unavailable'; end if;

  if exists (
    select 1 from public.tickets
     where event_id = p_event_id and seat_id = p_seat_id and status in ('valid', 'used')
  ) then raise exception 'seat_unavailable'; end if;

  delete from public.seat_reservations
   where event_id = p_event_id and user_id = p_user_id and seat_id <> p_seat_id and status = 'reserved';

  insert into public.seat_reservations(event_id, seat_id, user_id, reserved_until, status)
  values (p_event_id, p_seat_id, p_user_id, now() + interval '10 minutes', 'reserved')
  on conflict (event_id, seat_id) do update
    set user_id = excluded.user_id, reserved_until = excluded.reserved_until, status = 'reserved'
    where (seat_reservations.status = 'reserved'
           and (seat_reservations.reserved_until <= now() or seat_reservations.user_id = p_user_id))
       or (seat_reservations.status = 'booked' and not exists (
            select 1 from public.tickets
             where event_id = p_event_id and seat_id = p_seat_id and status in ('valid', 'used')
       ))
  returning * into r;
  if not found then raise exception 'seat_unavailable'; end if;
  return jsonb_build_object('reservation_id', r.id, 'seat_id', r.seat_id, 'reserved_until', r.reserved_until);
end;
$$;

create or replace function public.release_event_seat(p_user_id uuid, p_event_id uuid, p_seat_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.seat_reservations
   where event_id = p_event_id and seat_id = p_seat_id and user_id = p_user_id and status = 'reserved';
  return found;
end;
$$;

drop function if exists public.register_for_event(uuid, uuid, boolean);
create function public.register_for_event(
  p_user_id uuid,
  p_event_id uuid,
  p_visual_payments_enabled boolean default false,
  p_seat_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.events%rowtype;
  r public.registrations%rowtype;
  t public.tickets%rowtype;
  s public.seats%rowtype;
  v_seat_label text := 'Без места';
  v_seat_type seat_type_enum := 'free';
begin
  select * into e from public.events where id = p_event_id and status = 'published' for update;
  if not found then raise exception 'event_unavailable'; end if;
  if coalesce(e.available_seats, 0) < 1 then raise exception 'sold_out'; end if;
  if coalesce(e.current_price, e.base_price, 0) > 0 and not coalesce(p_visual_payments_enabled, false) then
    raise exception 'payment_provider_required';
  end if;
  if exists(select 1 from public.registrations where event_id = p_event_id and user_id = p_user_id) then
    raise exception 'already_registered';
  end if;

  if e.hall_id is not null and p_seat_id is null then raise exception 'seat_required'; end if;
  if p_seat_id is not null then
    select * into s from public.seats where id = p_seat_id and hall_id = e.hall_id for update;
    if not found then raise exception 'seat_unavailable'; end if;
    if exists(select 1 from public.tickets where event_id = p_event_id and seat_id = p_seat_id and status in ('valid', 'used')) then
      raise exception 'seat_unavailable';
    end if;
    if not exists(
      select 1 from public.seat_reservations
       where event_id = p_event_id and seat_id = p_seat_id and user_id = p_user_id
         and status = 'reserved' and reserved_until > now()
       for update
    ) then raise exception 'reservation_expired'; end if;
    v_seat_label := s.row_label || s.seat_number::text;
    v_seat_type := s.seat_type;
  end if;

  insert into public.registrations(event_id, user_id, total_paid)
    values (p_event_id, p_user_id, 0) returning * into r;
  update public.events set available_seats = available_seats - 1, updated_at = now()
    where id = p_event_id;
  insert into public.tickets(ticket_number, registration_id, event_id, user_id, seat_id, seat_label, seat_type, price_paid, qr_code_hash)
    values ('FT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
            r.id, p_event_id, p_user_id, p_seat_id, v_seat_label, v_seat_type, 0,
            replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    returning * into t;
  if p_seat_id is not null then
    update public.seat_reservations set status = 'booked', reserved_until = now()
      where event_id = p_event_id and seat_id = p_seat_id and user_id = p_user_id and status = 'reserved';
  end if;
  insert into public.notifications(user_id, title, message, type, channel)
    values (p_user_id, 'Билет оформлен', 'Место ' || v_seat_label || ' забронировано за вами. Билет ' || t.ticket_number, 'ticket', 'in_app');
  return jsonb_build_object('registration', to_jsonb(r), 'ticket', to_jsonb(t));
end;
$$;

revoke all on function public.ensure_hall_seats(uuid) from public, anon, authenticated;
revoke all on function public.reserve_event_seat(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_event_seat(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.register_for_event(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.ensure_hall_seats(uuid) to service_role;
grant execute on function public.reserve_event_seat(uuid, uuid, uuid) to service_role;
grant execute on function public.release_event_seat(uuid, uuid, uuid) to service_role;
grant execute on function public.register_for_event(uuid, uuid, boolean, uuid) to service_role;
