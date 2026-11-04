
alter table public.queue_tokens add column if not exists reserved_until timestamptz;
create unique index if not exists queue_tokens_event_number_uq on public.queue_tokens(event_id,queue_number);
create unique index if not exists queue_tokens_active_user_uq on public.queue_tokens(event_id,user_id) where status in ('waiting','ready','payment');
alter table public.queue_tokens enable row level security;
drop policy if exists queue_tokens_read_own on public.queue_tokens;
create policy queue_tokens_read_own on public.queue_tokens for select to authenticated using(user_id=auth.uid());
grant select on public.queue_tokens to authenticated;
do $$ begin alter publication supabase_realtime add table public.queue_tokens; exception when duplicate_object then null; end $$;

create table if not exists public.payment_intents(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete cascade,
 event_id uuid not null references public.events(id) on delete cascade,
 seat_id uuid references public.seats(id) on delete set null,
 queue_token_id uuid references public.queue_tokens(id) on delete set null,
 provider text not null, provider_reference text, checkout_url text,
 amount numeric(14,2) not null check(amount>=0), currency varchar(3) not null default 'KZT',
 status text not null default 'pending' check(status in('pending','paid','failed','expired','cancelled')),
 idempotency_key text not null, capacity_reserved boolean not null default false,
 ticket_id uuid references public.tickets(id) on delete set null,
 expires_at timestamptz not null default now()+interval '15 minutes',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
create index if not exists payment_intents_expiry_idx on public.payment_intents(expires_at) where status='pending';
create unique index if not exists payment_intents_provider_reference_uq on public.payment_intents(provider,provider_reference) where provider_reference is not null;
alter table public.payment_intents enable row level security;
revoke all on public.payment_intents from anon,authenticated;
grant all on public.payment_intents to service_role;

create or replace function public.promote_event_queue(p_event_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; expired_count integer; promote_count integer; token record;
begin
 select * into e from public.events where id=p_event_id for update;
 if not found then return; end if;
 update public.queue_tokens set status='waiting',reserved_until=null where event_id=p_event_id and status='ready' and reserved_until<=now();
 get diagnostics expired_count=row_count;
 if expired_count>0 then update public.events set available_seats=least(total_seats,available_seats+expired_count),updated_at=now() where id=p_event_id returning * into e; end if;
 promote_count:=least(greatest(coalesce(e.available_seats,0),0),(select count(*)::integer from public.queue_tokens where event_id=p_event_id and status='waiting'));
 if promote_count<=0 then return; end if;
 update public.events set available_seats=available_seats-promote_count,updated_at=now() where id=p_event_id returning * into e;
 for token in select id from public.queue_tokens where event_id=p_event_id and status='waiting' order by queue_number for update skip locked limit promote_count loop
  update public.queue_tokens set status='ready',reserved_until=now()+interval '10 minutes' where id=token.id;
  insert into public.notifications(user_id,title,message,type,channel)
   select q.user_id,'Ваша очередь подошла','Для мероприятия «'||e.title||'» освободилось место. У вас есть 10 минут, чтобы оформить билет.','queue','in_app' from public.queue_tokens q where q.id=token.id;
 end loop;
end $$;

create or replace function public.join_event_queue(p_user_id uuid,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; q public.queue_tokens%rowtype; ahead_count integer;
begin
 select * into e from public.events where id=p_event_id and status='published' for update;
 if not found then raise exception 'event_unavailable'; end if;
 if not exists(select 1 from public.users where id=p_user_id and not coalesce(is_blocked,false)) then raise exception 'account_blocked'; end if;
 if exists(select 1 from public.registrations where event_id=p_event_id and user_id=p_user_id) then raise exception 'already_registered'; end if;
 perform public.promote_event_queue(p_event_id);
 select * into q from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status in('waiting','ready','payment') for update;
 if not found then
  insert into public.queue_tokens(event_id,user_id,queue_number,status) select p_event_id,p_user_id,coalesce(max(queue_number),0)+1,'waiting' from public.queue_tokens where event_id=p_event_id returning * into q;
  perform public.promote_event_queue(p_event_id);
  select * into q from public.queue_tokens where id=q.id;
 end if;
 select count(*)::integer into ahead_count from public.queue_tokens x where x.event_id=p_event_id and x.status='waiting' and x.queue_number<q.queue_number;
 select * into e from public.events where id=p_event_id;
 return jsonb_build_object('joined',true,'queueNumber',q.queue_number,'status',q.status,'ahead',case when q.status='ready' then 0 else ahead_count end,'reservedUntil',q.reserved_until,'activeCount',(select count(*) from public.queue_tokens where event_id=p_event_id and status in('waiting','ready','payment')),'available',e.available_seats>0);
end $$;

create or replace function public.get_event_queue_status(p_user_id uuid,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; q public.queue_tokens%rowtype; ahead_count integer;
begin
 select * into e from public.events where id=p_event_id and status='published' for update;
 if not found then raise exception 'event_unavailable'; end if;
 perform public.promote_event_queue(p_event_id);
 select * into q from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status in('waiting','ready','payment') order by created_at desc limit 1;
 select * into e from public.events where id=p_event_id;
 if q.id is null then return jsonb_build_object('joined',false,'available',e.available_seats>0,'activeCount',(select count(*) from public.queue_tokens where event_id=p_event_id and status in('waiting','ready','payment'))); end if;
 select count(*)::integer into ahead_count from public.queue_tokens x where x.event_id=p_event_id and x.status='waiting' and x.queue_number<q.queue_number;
 return jsonb_build_object('joined',true,'queueNumber',q.queue_number,'status',q.status,'ahead',case when q.status='ready' then 0 else ahead_count end,'reservedUntil',q.reserved_until,'activeCount',(select count(*) from public.queue_tokens where event_id=p_event_id and status in('waiting','ready','payment')),'available',e.available_seats>0);
end $$;

create or replace function public.leave_event_queue(p_user_id uuid,p_event_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.queue_tokens%rowtype;
begin
 select * into q from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status in('waiting','ready') for update;
 if not found then return false; end if;
 update public.queue_tokens set status='cancelled',reserved_until=null where id=q.id;
 if q.status='ready' then update public.events set available_seats=least(total_seats,available_seats+1),updated_at=now() where id=p_event_id; end if;
 perform public.promote_event_queue(p_event_id);
 return true;
end $$;

create or replace function public.register_for_event(p_user_id uuid,p_event_id uuid,p_visual_payments_enabled boolean default false,p_seat_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; r public.registrations%rowtype; t public.tickets%rowtype; s public.seats%rowtype; q public.queue_tokens%rowtype; reserved_by_queue boolean:=false; v_seat_label text:='Без места'; v_seat_type seat_type_enum:='free';
begin
 select * into e from public.events where id=p_event_id and status='published' for update;
 if not found then raise exception 'event_unavailable'; end if;
 select * into q from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status='ready' and reserved_until>now() for update;
 reserved_by_queue:=found;
 if coalesce(e.available_seats,0)<1 and not reserved_by_queue then raise exception 'sold_out'; end if;
 if coalesce(e.current_price,e.base_price,0)>0 and not coalesce(p_visual_payments_enabled,false) then raise exception 'payment_provider_required'; end if;
 if exists(select 1 from public.registrations where event_id=p_event_id and user_id=p_user_id) then raise exception 'already_registered'; end if;
 if e.hall_id is not null and p_seat_id is null then raise exception 'seat_required'; end if;
 if p_seat_id is not null then
  select * into s from public.seats where id=p_seat_id and hall_id=e.hall_id for update;
  if not found then raise exception 'seat_unavailable'; end if;
  if exists(select 1 from public.tickets where event_id=p_event_id and seat_id=p_seat_id and status in('valid','used')) then raise exception 'seat_unavailable'; end if;
  if not exists(select 1 from public.seat_reservations where event_id=p_event_id and seat_id=p_seat_id and user_id=p_user_id and status='reserved' and reserved_until>now() for update) then raise exception 'reservation_expired'; end if;
  v_seat_label:=s.row_label||s.seat_number::text;v_seat_type:=s.seat_type;
 end if;
 insert into public.registrations(event_id,user_id,total_paid) values(p_event_id,p_user_id,0) returning * into r;
 if not reserved_by_queue then update public.events set available_seats=available_seats-1,updated_at=now() where id=p_event_id; end if;
 insert into public.tickets(ticket_number,registration_id,event_id,user_id,seat_id,seat_label,seat_type,price_paid,qr_code_hash)
 values('FT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),r.id,p_event_id,p_user_id,p_seat_id,v_seat_label,v_seat_type,0,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')) returning * into t;
 if p_seat_id is not null then update public.seat_reservations set status='booked',reserved_until=now() where event_id=p_event_id and seat_id=p_seat_id and user_id=p_user_id and status='reserved'; end if;
 if reserved_by_queue then update public.queue_tokens set status='completed',reserved_until=null where id=q.id; end if;
 insert into public.notifications(user_id,title,message,type,channel) values(p_user_id,'Билет оформлен','Место '||v_seat_label||' забронировано за вами. Билет '||t.ticket_number,'ticket','in_app');
 return jsonb_build_object('registration',to_jsonb(r),'ticket',to_jsonb(t));
end $$;

create or replace function public.reserve_event_seat(p_user_id uuid,p_event_id uuid,p_seat_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype;s public.seats%rowtype;r public.seat_reservations%rowtype; queued boolean:=false;
begin
 select * into e from public.events where id=p_event_id and status='published' for update;
 if not found or e.hall_id is null then raise exception 'event_unavailable'; end if;
 select exists(select 1 from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status='ready' and reserved_until>now()) into queued;
 if coalesce(e.available_seats,0)<1 and not queued then raise exception 'sold_out'; end if;
 select * into s from public.seats where id=p_seat_id and hall_id=e.hall_id for update;
 if not found then raise exception 'seat_unavailable'; end if;
 if exists(select 1 from public.tickets where event_id=p_event_id and seat_id=p_seat_id and status in('valid','used')) then raise exception 'seat_unavailable'; end if;
 delete from public.seat_reservations where event_id=p_event_id and user_id=p_user_id and seat_id<>p_seat_id and status='reserved';
 insert into public.seat_reservations(event_id,seat_id,user_id,reserved_until,status) values(p_event_id,p_seat_id,p_user_id,now()+interval '10 minutes','reserved')
 on conflict(event_id,seat_id) do update set user_id=excluded.user_id,reserved_until=excluded.reserved_until,status='reserved'
 where (seat_reservations.status='reserved' and(seat_reservations.reserved_until<=now() or seat_reservations.user_id=p_user_id))
 or(seat_reservations.status='booked' and not exists(select 1 from public.tickets where event_id=p_event_id and seat_id=p_seat_id and status in('valid','used')))
 returning * into r;
 if not found then raise exception 'seat_unavailable'; end if;
 return jsonb_build_object('reservation_id',r.id,'seat_id',r.seat_id,'reserved_until',r.reserved_until);
end $$;

create or replace function public.create_payment_intent(p_user_id uuid,p_event_id uuid,p_seat_id uuid,p_idempotency_key text,p_provider text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype;s public.seats%rowtype;q public.queue_tokens%rowtype;i public.payment_intents%rowtype;amount_value numeric(14,2);from_queue boolean:=false;
begin
 if length(coalesce(p_idempotency_key,''))<12 or length(p_idempotency_key)>120 then raise exception 'invalid_idempotency_key'; end if;
 select * into i from public.payment_intents where user_id=p_user_id and idempotency_key=p_idempotency_key;
 if found then return to_jsonb(i); end if;
 select * into e from public.events where id=p_event_id and status='published' for update;
 if not found then raise exception 'event_unavailable'; end if;
 if not exists(select 1 from public.users where id=p_user_id and not coalesce(is_blocked,false)) then raise exception 'account_blocked'; end if;
 if exists(select 1 from public.registrations where event_id=p_event_id and user_id=p_user_id) then raise exception 'already_registered'; end if;
 amount_value:=round(coalesce(e.current_price,e.base_price,0),2);
 if amount_value<=0 then raise exception 'payment_not_required'; end if;
 if e.hall_id is not null and p_seat_id is null then raise exception 'seat_required'; end if;
 if p_seat_id is not null then
  select * into s from public.seats where id=p_seat_id and hall_id=e.hall_id for update;
  if not found then raise exception 'seat_unavailable'; end if;
  amount_value:=round(amount_value*coalesce(s.price_multiplier,1),2);
  if not exists(select 1 from public.seat_reservations where event_id=p_event_id and seat_id=p_seat_id and user_id=p_user_id and status='reserved' and reserved_until>now() for update) then raise exception 'reservation_expired'; end if;
 end if;
 select * into q from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status='ready' and reserved_until>now() for update;
 if found then from_queue:=true;update public.queue_tokens set status='payment' where id=q.id;
 elsif coalesce(e.available_seats,0)<1 then raise exception 'sold_out';
 else update public.events set available_seats=available_seats-1,updated_at=now() where id=p_event_id; end if;
 if p_seat_id is not null then update public.seat_reservations set reserved_until=now()+interval '15 minutes' where event_id=p_event_id and seat_id=p_seat_id and user_id=p_user_id and status='reserved'; end if;
 insert into public.payment_intents(user_id,event_id,seat_id,queue_token_id,provider,amount,currency,idempotency_key,capacity_reserved,expires_at)
 values(p_user_id,p_event_id,p_seat_id,case when from_queue then q.id else null end,p_provider,amount_value,'KZT',p_idempotency_key,true,now()+interval '15 minutes') returning * into i;
 return to_jsonb(i);
end $$;

create or replace function public.update_payment_checkout(p_intent_id uuid,p_provider_reference text,p_checkout_url text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.payment_intents%rowtype;
begin update public.payment_intents set provider_reference=p_provider_reference,checkout_url=p_checkout_url,updated_at=now() where id=p_intent_id and status='pending' and expires_at>now() returning * into i; if not found then raise exception 'payment_intent_expired'; end if; return to_jsonb(i); end $$;

create or replace function public.cancel_payment_intent(p_intent_id uuid,p_status text default 'cancelled')
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.payment_intents%rowtype;
begin
 if p_status not in('failed','expired','cancelled') then raise exception 'invalid_payment_status'; end if;
 select * into i from public.payment_intents where id=p_intent_id for update;
 if not found or i.status<>'pending' then return false; end if;
 update public.payment_intents set status=p_status,updated_at=now() where id=i.id;
 if i.capacity_reserved then update public.events set available_seats=least(total_seats,available_seats+1),updated_at=now() where id=i.event_id; end if;
 if i.seat_id is not null then update public.seat_reservations set reserved_until=now() where event_id=i.event_id and seat_id=i.seat_id and user_id=i.user_id and status='reserved'; end if;
 if i.queue_token_id is not null then update public.queue_tokens set status='waiting',reserved_until=null where id=i.queue_token_id and status='payment'; end if;
 perform public.promote_event_queue(i.event_id);
 return true;
end $$;

create or replace function public.settle_payment_intent(p_intent_id uuid,p_provider_reference text,p_amount numeric,p_currency text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.payment_intents%rowtype;e public.events%rowtype;s public.seats%rowtype;r public.registrations%rowtype;t public.tickets%rowtype;place text:='Без места';kind public.seat_type_enum:='free';
begin
 select * into i from public.payment_intents where id=p_intent_id for update;
 if not found or i.status<>'pending' then raise exception 'payment_intent_not_pending'; end if;
 if i.provider_reference is distinct from p_provider_reference then raise exception 'payment_reference_mismatch'; end if;
 if round(p_amount,2)<>i.amount or upper(p_currency)<>i.currency then raise exception 'payment_amount_mismatch'; end if;
 if i.expires_at<=now() then raise exception 'payment_intent_expired'; end if;
 select * into e from public.events where id=i.event_id and status='published' for update;
 if not found then raise exception 'event_unavailable'; end if;
 if i.seat_id is not null then
  select * into s from public.seats where id=i.seat_id and hall_id=e.hall_id;
  if not found or not exists(select 1 from public.seat_reservations where event_id=i.event_id and seat_id=i.seat_id and user_id=i.user_id and status='reserved' and reserved_until>now()) then raise exception 'reservation_expired'; end if;
  place:=s.row_label||s.seat_number::text;kind:=s.seat_type;
 end if;
 insert into public.registrations(event_id,user_id,total_paid) values(i.event_id,i.user_id,i.amount) returning * into r;
 insert into public.tickets(ticket_number,registration_id,event_id,user_id,seat_id,seat_label,seat_type,price_paid,qr_code_hash)
 values('FT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),r.id,i.event_id,i.user_id,i.seat_id,place,kind,i.amount,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')) returning * into t;
 if i.seat_id is not null then update public.seat_reservations set status='booked',reserved_until=now() where event_id=i.event_id and seat_id=i.seat_id and user_id=i.user_id and status='reserved'; end if;
 insert into public.payments(user_id,ticket_id,amount,currency,payment_method,status,transaction_ref) values(i.user_id,t.id,i.amount,i.currency,i.provider,'completed',i.provider||':'||i.id);
 update public.payment_intents set status='paid',ticket_id=t.id,updated_at=now() where id=i.id;
 if i.queue_token_id is not null then update public.queue_tokens set status='completed',reserved_until=null where id=i.queue_token_id; end if;
 insert into public.notifications(user_id,title,message,type,channel) values(i.user_id,'Билет оформлен','Оплата прошла. Билет '||t.ticket_number||' готов.','ticket','in_app');
 return jsonb_build_object('ticket',to_jsonb(t),'registration',to_jsonb(r),'paymentIntentId',i.id);
end $$;

create or replace function public.get_payment_intent(p_intent_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',i.id,'status',i.status,'ticketId',i.ticket_id,'checkoutUrl',i.checkout_url,'expiresAt',i.expires_at) from public.payment_intents i where i.id=p_intent_id and i.user_id=p_user_id $$;

create or replace function public.expire_payment_intents()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare i record;n integer:=0;
begin
 for i in select id from public.payment_intents where status='pending' and expires_at<=now() order by expires_at limit 100 for update skip locked loop
  perform public.cancel_payment_intent(i.id,'expired');n:=n+1;
 end loop;
 return n;
end $$;

revoke all on function public.promote_event_queue(uuid) from public,anon,authenticated;
revoke all on function public.join_event_queue(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_event_queue_status(uuid,uuid) from public,anon,authenticated;
revoke all on function public.leave_event_queue(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_payment_intent(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.update_payment_checkout(uuid,text,text) from public,anon,authenticated;
revoke all on function public.cancel_payment_intent(uuid,text) from public,anon,authenticated;
revoke all on function public.settle_payment_intent(uuid,text,numeric,text) from public,anon,authenticated;
revoke all on function public.get_payment_intent(uuid,uuid) from public,anon,authenticated;
revoke all on function public.expire_payment_intents() from public,anon,authenticated;
grant execute on function public.join_event_queue(uuid,uuid),public.get_event_queue_status(uuid,uuid),public.leave_event_queue(uuid,uuid),public.create_payment_intent(uuid,uuid,uuid,text,text),public.update_payment_checkout(uuid,text,text),public.cancel_payment_intent(uuid,text),public.settle_payment_intent(uuid,text,numeric,text),public.get_payment_intent(uuid,uuid),public.expire_payment_intents() to service_role;


-- A queue promotion reserves one unit of capacity. Registration must consume that
-- reservation instead of checking/decrementing the event's remaining capacity again.
create or replace function public.register_for_event(p_user_id uuid,p_event_id uuid,p_visual_payments_enabled boolean default false,p_seat_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype;r public.registrations%rowtype;t public.tickets%rowtype;s public.seats%rowtype;q public.queue_tokens%rowtype;reserved_by_queue boolean:=false;place text:='Без места';kind public.seat_type_enum:='free';
begin
 select * into e from public.events where id=p_event_id and status='published' for update;
 if not found then raise exception 'event_unavailable'; end if;
 select * into q from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status='ready' and reserved_until>now() for update;
 reserved_by_queue:=found;
 if coalesce(e.available_seats,0)<1 and not reserved_by_queue then raise exception 'sold_out'; end if;
 if coalesce(e.current_price,e.base_price,0)>0 and not coalesce(p_visual_payments_enabled,false) then raise exception 'payment_provider_required'; end if;
 if exists(select 1 from public.registrations where event_id=p_event_id and user_id=p_user_id) then raise exception 'already_registered'; end if;
 if e.hall_id is not null and p_seat_id is null then raise exception 'seat_required'; end if;
 if p_seat_id is not null then
  select * into s from public.seats where id=p_seat_id and hall_id=e.hall_id for update;
  if not found then raise exception 'seat_unavailable'; end if;
  if exists(select 1 from public.tickets where event_id=p_event_id and seat_id=p_seat_id and status in('valid','used')) then raise exception 'seat_unavailable'; end if;
  if not exists(select 1 from public.seat_reservations where event_id=p_event_id and seat_id=p_seat_id and user_id=p_user_id and status='reserved' and reserved_until>now() for update) then raise exception 'reservation_expired'; end if;
  place:=s.row_label||s.seat_number::text;kind:=s.seat_type;
 end if;
 insert into public.registrations(event_id,user_id,total_paid) values(p_event_id,p_user_id,0) returning * into r;
 if not reserved_by_queue then update public.events set available_seats=available_seats-1,updated_at=now() where id=p_event_id; end if;
 insert into public.tickets(ticket_number,registration_id,event_id,user_id,seat_id,seat_label,seat_type,price_paid,qr_code_hash)
 values('FT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),r.id,p_event_id,p_user_id,p_seat_id,place,kind,0,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')) returning * into t;
 if p_seat_id is not null then update public.seat_reservations set status='booked',reserved_until=now() where event_id=p_event_id and seat_id=p_seat_id and user_id=p_user_id and status='reserved'; end if;
 if reserved_by_queue then update public.queue_tokens set status='completed',reserved_until=null where id=q.id; end if;
 insert into public.notifications(user_id,title,message,type,channel) values(p_user_id,'Билет оформлен','Место '||place||' забронировано за вами. Билет '||t.ticket_number,'ticket','in_app');
 return jsonb_build_object('registration',to_jsonb(r),'ticket',to_jsonb(t));
end $$;

create or replace function public.reserve_event_seat(p_user_id uuid,p_event_id uuid,p_seat_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype;s public.seats%rowtype;r public.seat_reservations%rowtype;queued boolean:=false;
begin
 select * into e from public.events where id=p_event_id and status='published' for update;
 if not found or e.hall_id is null then raise exception 'event_unavailable'; end if;
 select exists(select 1 from public.queue_tokens where event_id=p_event_id and user_id=p_user_id and status='ready' and reserved_until>now()) into queued;
 if coalesce(e.available_seats,0)<1 and not queued then raise exception 'sold_out'; end if;
 select * into s from public.seats where id=p_seat_id and hall_id=e.hall_id for update;
 if not found then raise exception 'seat_unavailable'; end if;
 if exists(select 1 from public.tickets where event_id=p_event_id and seat_id=p_seat_id and status in('valid','used')) then raise exception 'seat_unavailable'; end if;
 delete from public.seat_reservations where event_id=p_event_id and user_id=p_user_id and seat_id<>p_seat_id and status='reserved';
 insert into public.seat_reservations(event_id,seat_id,user_id,reserved_until,status) values(p_event_id,p_seat_id,p_user_id,now()+interval '10 minutes','reserved')
 on conflict(event_id,seat_id) do update set user_id=excluded.user_id,reserved_until=excluded.reserved_until,status='reserved'
 where (seat_reservations.status='reserved' and(seat_reservations.reserved_until<=now() or seat_reservations.user_id=p_user_id))
 or(seat_reservations.status='booked' and not exists(select 1 from public.tickets where event_id=p_event_id and seat_id=p_seat_id and status in('valid','used')))
 returning * into r;
 if not found then raise exception 'seat_unavailable'; end if;
 return jsonb_build_object('reservation_id',r.id,'seat_id',r.seat_id,'reserved_until',r.reserved_until);
end $$;

revoke all on function public.register_for_event(uuid,uuid,boolean,uuid) from public,anon,authenticated;
revoke all on function public.reserve_event_seat(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_for_event(uuid,uuid,boolean,uuid),public.reserve_event_seat(uuid,uuid,uuid) to service_role;
