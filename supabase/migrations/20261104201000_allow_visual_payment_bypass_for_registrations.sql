drop function if exists public.register_for_event(uuid, uuid);

create function public.register_for_event(
  p_user_id uuid,
  p_event_id uuid,
  p_visual_payments_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  e public.events%rowtype;
  r public.registrations%rowtype;
  t public.tickets%rowtype;
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
  insert into public.registrations(event_id, user_id, total_paid)
    values (p_event_id, p_user_id, 0) returning * into r;
  update public.events set available_seats = available_seats - 1, updated_at = now()
    where id = p_event_id;
  insert into public.tickets(ticket_number, registration_id, event_id, user_id, seat_label, seat_type, price_paid, qr_code_hash)
    values ('FT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
            r.id, p_event_id, p_user_id, 'Без места', 'free', 0, encode(gen_random_bytes(32), 'hex'))
    returning * into t;
  return jsonb_build_object('registration', to_jsonb(r), 'ticket', to_jsonb(t));
end;
$function$;

revoke all on function public.register_for_event(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.register_for_event(uuid, uuid, boolean) to service_role;
