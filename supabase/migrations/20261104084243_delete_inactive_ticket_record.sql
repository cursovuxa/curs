create function public.admin_delete_ticket_record(p_ticket_id uuid,p_actor_id uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare t public.tickets%rowtype; ev uuid;
begin
 select event_id into ev from public.tickets where id=p_ticket_id;
 if ev is null then return jsonb_build_object('deleted',true); end if;
 perform 1 from public.events where id=ev for update;
 select * into t from public.tickets where id=p_ticket_id for update;
 if not found then return jsonb_build_object('deleted',true); end if;
 if t.status in ('valid','used') then raise exception 'cancel_first'; end if;
 insert into public.ticket_cancellations(ticket_id,user_id,actor_id,ticket_snapshot,options)
 values(t.id,t.user_id,p_actor_id,to_jsonb(t),'{"delete":true}'::jsonb) on conflict do nothing;
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