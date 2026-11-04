create or replace function public.admin_cancel_ticket(p_ticket_id uuid,p_actor_id uuid,p_refund boolean,p_block boolean,p_notify boolean,p_delete boolean default false) returns jsonb language plpgsql set search_path=public,pg_temp as $$
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
 values(t.id,t.user_id,p_actor_id,to_jsonb(t)||jsonb_build_object('payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payments p where ticket_id=t.id),'refunds',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.refunds r where ticket_id=t.id)),amount,jsonb_build_object('refund',p_refund,'block',p_block,'notify',p_notify,'delete',p_delete));
 update public.payments set ticket_id=null,status=case when p_refund then 'refunded'::payment_status_enum else status end where ticket_id=t.id;
 if p_delete then delete from public.tickets where id=t.id;
 else update public.tickets set status='cancelled',registration_id=null where id=t.id; end if;
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


create or replace function public.admin_delete_ticket_record(p_ticket_id uuid,p_actor_id uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare t public.tickets%rowtype; ev uuid;
begin
 select event_id into ev from public.tickets where id=p_ticket_id;
 if ev is null then return jsonb_build_object('deleted',true); end if;
 perform 1 from public.events where id=ev for update;
 select * into t from public.tickets where id=p_ticket_id for update;
 if not found then return jsonb_build_object('deleted',true); end if;
 if t.status in ('valid','used') then raise exception 'cancel_first'; end if;
 insert into public.ticket_cancellations(ticket_id,user_id,actor_id,ticket_snapshot,options)
 values(t.id,t.user_id,p_actor_id,to_jsonb(t)||jsonb_build_object('payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payments p where ticket_id=t.id),'refunds',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.refunds r where ticket_id=t.id)),'{"delete":true}'::jsonb) on conflict do nothing;
 update public.payments set ticket_id=null where ticket_id=t.id;
 delete from public.tickets where id=t.id;
 delete from public.registrations where id=t.registration_id and not exists(select 1 from public.tickets where registration_id=t.registration_id);
 delete from public.seat_reservations where event_id=ev and user_id=t.user_id and (seat_id=t.seat_id or t.seat_id is null);
 update public.events set available_seats=greatest(0,total_seats-(select count(*) from public.tickets where event_id=ev and status in ('valid','used'))),updated_at=now() where id=ev;
 insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,details)
 values(p_actor_id,coalesce((select full_name from public.users where id=p_actor_id),'Администратор'),'ADMIN_TICKET_DELETED','ticket',t.id::text,jsonb_build_object('ticket_number',t.ticket_number));
 return jsonb_build_object('deleted',true);
end $$;
revoke all on function public.admin_delete_ticket_record(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_ticket_record(uuid,uuid) to service_role;