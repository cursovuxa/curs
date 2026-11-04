create table public.wallet_accounts (
 user_id uuid primary key references public.users(id), balance numeric(14,2) not null default 0 check(balance>=0), updated_at timestamptz not null default now()
);
create table public.wallet_transactions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
 amount numeric(14,2) not null check(amount<>0), balance_after numeric(14,2) not null check(balance_after>=0),
 kind text not null check(kind in ('visual_topup','ticket_purchase','ticket_refund')),
 reference_id uuid, idempotency_key text unique, description text not null, created_at timestamptz not null default now()
);
create index wallet_transactions_user_created on public.wallet_transactions(user_id,created_at desc);
create table public.ticket_cancellations (
 ticket_id uuid primary key, user_id uuid, actor_id uuid, ticket_snapshot jsonb not null,
 refunded_amount numeric(14,2) not null default 0, options jsonb not null, created_at timestamptz not null default now()
);
alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.ticket_cancellations enable row level security;
revoke all on public.wallet_accounts,public.wallet_transactions,public.ticket_cancellations from anon,authenticated;
grant all on public.wallet_accounts,public.wallet_transactions,public.ticket_cancellations to service_role;

create function public.wallet_topup(p_user_id uuid,p_amount numeric,p_key text) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare w public.wallet_accounts%rowtype; prior public.wallet_transactions%rowtype;
begin
 if p_amount<=0 or p_amount>1000000 or p_amount<>round(p_amount,2) or length(p_key)<16 then raise exception 'invalid_amount'; end if;
 if not exists(select 1 from public.users where id=p_user_id and not coalesce(is_blocked,false)) then raise exception 'account_blocked'; end if;
 insert into public.wallet_accounts(user_id) values(p_user_id) on conflict do nothing;
 select * into w from public.wallet_accounts where user_id=p_user_id for update;
 select * into prior from public.wallet_transactions where idempotency_key=p_key;
 if found then
  if prior.user_id<>p_user_id or prior.amount<>p_amount then raise exception 'idempotency_conflict'; end if;
  return to_jsonb(prior);
 end if;
 if not exists(select 1 from public.platform_settings where key='visual_payments_enabled' and value='true'::jsonb) then raise exception 'payment_provider_required'; end if;
 update public.wallet_accounts set balance=balance+p_amount,updated_at=now() where user_id=p_user_id returning * into w;
 insert into public.wallet_transactions(user_id,amount,balance_after,kind,idempotency_key,description)
 values(p_user_id,p_amount,w.balance,'visual_topup',p_key,'Визуальное пополнение баланса') returning * into prior;
 return to_jsonb(prior);
end $$;

create function public.wallet_register_for_event(p_user_id uuid,p_event_id uuid,p_seat_id uuid default null) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare e public.events%rowtype; w public.wallet_accounts%rowtype; result jsonb; cost numeric(14,2); mult numeric:=1; tid uuid; rid uuid;
begin
 select * into e from public.events where id=p_event_id for update;
 if not found then raise exception 'event_unavailable'; end if;
 if not exists(select 1 from public.users where id=p_user_id and not coalesce(is_blocked,false)) then raise exception 'account_blocked'; end if;
 if p_seat_id is not null then select price_multiplier into mult from public.seats where id=p_seat_id and hall_id=e.hall_id; end if;
 cost:=round(coalesce(e.current_price,e.base_price,0)*coalesce(mult,1),2);
 insert into public.wallet_accounts(user_id) values(p_user_id) on conflict do nothing;
 select * into w from public.wallet_accounts where user_id=p_user_id for update;
 if cost>w.balance then raise exception 'insufficient_balance'; end if;
 result:=public.register_for_event(p_user_id,p_event_id,true,p_seat_id);
 tid:=(result->'ticket'->>'id')::uuid; rid:=(result->'registration'->>'id')::uuid;
 if cost>0 then
  update public.wallet_accounts set balance=balance-cost,updated_at=now() where user_id=p_user_id returning * into w;
  insert into public.wallet_transactions(user_id,amount,balance_after,kind,reference_id,idempotency_key,description)
  values(p_user_id,-cost,w.balance,'ticket_purchase',tid,'purchase:'||tid,'Билет: '||e.title);
  insert into public.payments(user_id,ticket_id,amount,currency,payment_method,status,transaction_ref)
  values(p_user_id,tid,cost,'KZT','wallet','completed','wallet:'||tid);
 end if;
 update public.tickets set price_paid=cost where id=tid;
 update public.registrations set total_paid=cost where id=rid;
 result:=jsonb_set(result,'{ticket,price_paid}',to_jsonb(cost));
 result:=jsonb_set(result,'{registration,total_paid}',to_jsonb(cost));
 return result||jsonb_build_object('balance',w.balance);
end $$;

create function public.admin_cancel_ticket(p_ticket_id uuid,p_actor_id uuid,p_refund boolean,p_block boolean,p_notify boolean) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare t public.tickets%rowtype; ev uuid; w public.wallet_accounts%rowtype; amount numeric(14,2):=0; old public.ticket_cancellations%rowtype;
begin
 select * into old from public.ticket_cancellations where ticket_id=p_ticket_id;
 if found then return jsonb_build_object('cancelled',true,'already_cancelled',true,'refunded',old.refunded_amount); end if;
 select event_id into ev from public.tickets where id=p_ticket_id;
 if ev is null then raise exception 'ticket_not_found'; end if;
 perform 1 from public.events where id=ev for update;
 select * into t from public.tickets where id=p_ticket_id for update;
 if not found then
  select * into old from public.ticket_cancellations where ticket_id=p_ticket_id;
  if found then return jsonb_build_object('cancelled',true,'already_cancelled',true,'refunded',old.refunded_amount); end if;
  raise exception 'ticket_not_found';
 end if;
 if t.status not in ('valid','used') then raise exception 'ticket_not_active'; end if;
 if p_block and t.user_id=p_actor_id then raise exception 'cannot_block_self'; end if;
 if p_refund then amount:=t.price_paid; end if;
 if amount>0 then
  insert into public.wallet_accounts(user_id) values(t.user_id) on conflict do nothing;
  select * into w from public.wallet_accounts where user_id=t.user_id for update;
  update public.wallet_accounts set balance=balance+amount,updated_at=now() where user_id=t.user_id returning * into w;
  insert into public.wallet_transactions(user_id,amount,balance_after,kind,reference_id,idempotency_key,description)
  values(t.user_id,amount,w.balance,'ticket_refund',t.id,'refund:'||t.id,'Возврат за билет '||t.ticket_number);
 end if;
 insert into public.ticket_cancellations(ticket_id,user_id,actor_id,ticket_snapshot,refunded_amount,options)
 values(t.id,t.user_id,p_actor_id,to_jsonb(t)||jsonb_build_object('payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payments p where ticket_id=t.id)),amount,jsonb_build_object('refund',p_refund,'block',p_block,'notify',p_notify));
 update public.payments set ticket_id=null,status=case when p_refund then 'refunded'::payment_status_enum else status end where ticket_id=t.id;
 delete from public.tickets where id=t.id;
 delete from public.registrations where id=t.registration_id and not exists(select 1 from public.tickets where registration_id=t.registration_id);
 delete from public.seat_reservations where event_id=t.event_id and user_id=t.user_id and (seat_id=t.seat_id or t.seat_id is null);
 update public.events set available_seats=least(total_seats,coalesce(available_seats,0)+1),updated_at=now() where id=t.event_id;
 if p_block then update public.users set is_blocked=true,updated_at=now() where id=t.user_id; end if;
 if p_notify then insert into public.notifications(user_id,title,message,type,channel)
 values(t.user_id,'Билет аннулирован','Билет '||t.ticket_number||' аннулирован. '||case when amount>0 then 'На баланс возвращено '||amount||' ₸.' else 'Место освобождено.' end,'ticket','in_app'); end if;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,details)
 values(p_actor_id,coalesce((select full_name from public.users where id=p_actor_id),'Администратор'),'ADMIN_TICKET_CANCELLED','ticket',t.id::text,jsonb_build_object('ticket_number',t.ticket_number,'refund',amount,'blocked',p_block,'notified',p_notify));
 return jsonb_build_object('cancelled',true,'refunded',amount,'user_id',t.user_id);
end $$;
revoke all on function public.wallet_topup(uuid,numeric,text),public.wallet_register_for_event(uuid,uuid,uuid),public.admin_cancel_ticket(uuid,uuid,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.wallet_topup(uuid,numeric,text),public.wallet_register_for_event(uuid,uuid,uuid),public.admin_cancel_ticket(uuid,uuid,boolean,boolean,boolean) to service_role;
