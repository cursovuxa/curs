alter table public.promo_codes
  add column if not exists category_id uuid references public.event_categories(id) on delete set null,
  add column if not exists seat_type public.seat_type_enum,
  add column if not exists event_id uuid references public.events(id) on delete cascade;
create table if not exists public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  ticket_id uuid not null unique references public.tickets(id) on delete restrict,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  created_at timestamptz not null default now()
);
alter table public.promo_code_redemptions enable row level security;
create table if not exists public.event_views (
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  view_count integer not null default 1 check (view_count > 0),
  last_viewed_at timestamptz not null default now(),
  primary key (user_id,event_id)
);
alter table public.event_views enable row level security;
create index if not exists event_views_user_recent_idx on public.event_views(user_id,last_viewed_at desc);
create index if not exists promo_codes_active_expiry_idx on public.promo_codes(is_active,expires_at);

create or replace function public.set_event_dynamic_price()
returns trigger language plpgsql set search_path to public,pg_temp as $$
declare remaining_ratio numeric;
begin
  if coalesce(new.base_price,0)<=0 then new.current_price:=0;
  elsif not coalesce(new.dynamic_pricing_enabled,false) then new.current_price:=round(new.base_price,2);
  else
    remaining_ratio:=case when coalesce(new.total_seats,0)>0 then greatest(coalesce(new.available_seats,0),0)::numeric/new.total_seats else 0 end;
    new.current_price:=round(new.base_price*case when remaining_ratio<=0.10 then 1.75 when remaining_ratio<=0.20 then 1.50 when remaining_ratio<=0.50 then 1.25 else 1.00 end,2);
  end if;
  return new;
end $$;
create trigger events_dynamic_price
before insert or update of base_price,current_price,total_seats,available_seats,dynamic_pricing_enabled
on public.events for each row execute function public.set_event_dynamic_price();

create or replace function public.wallet_register_for_event_with_promo(
  p_user_id uuid,p_event_id uuid,p_seat_id uuid default null,p_promo_code text default null
) returns jsonb language plpgsql set search_path to public,pg_temp as $$
declare
  e public.events%rowtype; w public.wallet_accounts%rowtype; pr public.promo_codes%rowtype;
  result jsonb; subtotal numeric(14,2); discount numeric(14,2):=0; cost numeric(14,2);
  mult numeric:=1; tid uuid; rid uuid; normalized_code text:=upper(trim(coalesce(p_promo_code,'')));
begin
  select * into e from public.events where id=p_event_id for update;
  if not found then raise exception 'event_unavailable'; end if;
  if not exists(select 1 from public.users where id=p_user_id and not coalesce(is_blocked,false)) then raise exception 'account_blocked'; end if;
  if exists(select 1 from public.registrations where event_id=p_event_id and user_id=p_user_id) then raise exception 'already_registered'; end if;
  if p_seat_id is not null then
    select price_multiplier into mult from public.seats where id=p_seat_id and hall_id=e.hall_id;
    if mult is null then raise exception 'seat_unavailable'; end if;
  end if;
  subtotal:=round(coalesce(e.current_price,e.base_price,0)*coalesce(mult,1),2);
  if p_seat_id is not null and not exists(
    select 1 from public.seat_reservations where event_id=p_event_id and seat_id=p_seat_id
      and user_id=p_user_id and status='reserved' and reserved_until>now() for update
  ) then raise exception 'reservation_expired'; end if;
  if normalized_code<>'' then
    select * into pr from public.promo_codes where upper(code)=normalized_code and coalesce(is_active,true) for update;
    if not found then raise exception 'promo_invalid'; end if;
    if pr.expires_at is not null and pr.expires_at<=now() then raise exception 'promo_expired'; end if;
    if pr.max_uses is not null and coalesce(pr.current_uses,0)>=pr.max_uses then raise exception 'promo_limit_reached'; end if;
    if pr.organizer_id is not null and pr.organizer_id is distinct from e.organizer_id then raise exception 'promo_wrong_event'; end if;
    if pr.event_id is not null and pr.event_id<>e.id then raise exception 'promo_wrong_event'; end if;
    if pr.category_id is not null and pr.category_id is distinct from e.category_id then raise exception 'promo_wrong_category'; end if;
    if pr.min_amount is not null and subtotal<pr.min_amount then raise exception 'promo_minimum_not_met'; end if;
    if pr.only_new_users and exists(select 1 from public.registrations where user_id=p_user_id) then raise exception 'promo_new_users_only'; end if;
    if p_seat_id is not null and pr.seat_type is not null and not exists(
      select 1 from public.seats where id=p_seat_id and seat_type=pr.seat_type
    ) then raise exception 'promo_wrong_ticket_type'; end if;
    discount:=round(subtotal*least(greatest(pr.discount_percent,0),100)/100.0,2);
  end if;
  cost:=greatest(subtotal-discount,0);
  insert into public.wallet_accounts(user_id) values(p_user_id) on conflict do nothing;
  select * into w from public.wallet_accounts where user_id=p_user_id for update;
  if cost>w.balance then raise exception 'insufficient_balance'; end if;
  result:=public.register_for_event(p_user_id,p_event_id,true,p_seat_id);
  tid:=(result->'ticket'->>'id')::uuid; rid:=(result->'registration'->>'id')::uuid;
  if cost>0 then
    update public.wallet_accounts set balance=balance-cost,updated_at=now() where user_id=p_user_id returning * into w;
    insert into public.wallet_transactions(user_id,amount,balance_after,kind,reference_id,idempotency_key,description)
      values(p_user_id,-cost,w.balance,'ticket_purchase',tid,'purchase:'||tid,'Билет: '||e.title);
    insert into public.payments(user_id,ticket_id,amount,currency,payment_method,status,transaction_ref,promo_code_id)
      values(p_user_id,tid,cost,'KZT','wallet','completed','wallet:'||tid,case when normalized_code<>'' then pr.id else null end);
  end if;
  if normalized_code<>'' then
    update public.promo_codes set current_uses=coalesce(current_uses,0)+1 where id=pr.id;
    insert into public.promo_code_redemptions(promo_code_id,user_id,event_id,ticket_id,discount_amount)
      values(pr.id,p_user_id,p_event_id,tid,discount);
  end if;
  update public.tickets set price_paid=cost where id=tid;
  update public.registrations set total_paid=cost where id=rid;
  result:=jsonb_set(result,'{ticket,price_paid}',to_jsonb(cost));
  result:=jsonb_set(result,'{registration,total_paid}',to_jsonb(cost));
  return result||jsonb_build_object('balance',w.balance,'subtotal',subtotal,'discount',discount,
      'promoCode',case when normalized_code<>'' then normalized_code else null end);
end $$;
revoke all on function public.wallet_register_for_event_with_promo(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.wallet_register_for_event_with_promo(uuid,uuid,uuid,text) to service_role;