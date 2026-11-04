create or replace function public.admin_delete_ticket_record(p_ticket_id uuid,p_actor_id uuid) returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  t public.tickets%rowtype;
  ev uuid;
  delete_action text;
  actor_label text;
begin
  select event_id into ev from public.tickets where id=p_ticket_id;
  if not found then return jsonb_build_object('deleted',true); end if;
  if ev is not null then perform 1 from public.events where id=ev for update; end if;
  select * into t from public.tickets where id=p_ticket_id for update;
  if not found then return jsonb_build_object('deleted',true); end if;
  if t.status='valid' then raise exception 'cancel_first'; end if;

  insert into public.ticket_cancellations(ticket_id,user_id,actor_id,ticket_snapshot,options)
  values(
    t.id,t.user_id,p_actor_id,
    to_jsonb(t)||jsonb_build_object(
      'payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.payments p where p.ticket_id=t.id),
      'refunds',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.refunds r where r.ticket_id=t.id)
    ),
    jsonb_build_object('delete',true,'automatic_retention',p_actor_id is null)
  ) on conflict(ticket_id) do nothing;

  update public.payments set ticket_id=null where ticket_id=t.id;
  update public.refunds set ticket_id=null where ticket_id=t.id;
  delete from public.tickets where id=t.id;
  delete from public.registrations where id=t.registration_id
    and not exists(select 1 from public.tickets where registration_id=t.registration_id);
  if ev is not null then
    delete from public.seat_reservations where event_id=ev and user_id=t.user_id and (seat_id=t.seat_id or t.seat_id is null);
    if t.status<>'used' then
      update public.events
         set available_seats=greatest(0,total_seats-(select count(*) from public.tickets where event_id=ev and status in ('valid','used'))),
             updated_at=now()
       where id=ev;
    end if;
  end if;

  delete_action:=case when p_actor_id is null then 'TICKET_AUTO_DELETED' else 'ADMIN_TICKET_DELETED' end;
  actor_label:=case when p_actor_id is null then 'FlowTix · автоочистка'
    else coalesce((select full_name from public.users where id=p_actor_id),'Администратор') end;
  insert into public.audit_logs(actor_id,actor_name,action,entity_type,entity_id,details)
  values(p_actor_id,actor_label,delete_action,'ticket',t.id::text,
    jsonb_build_object('ticket_number',t.ticket_number,'used_at',t.used_at,'automatic_retention',p_actor_id is null));
  return jsonb_build_object('deleted',true,'ticket_number',t.ticket_number);
end $$;

revoke all on function public.admin_delete_ticket_record(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_ticket_record(uuid,uuid) to service_role;

create or replace function public.purge_used_tickets_after_week(p_batch_size integer default 100) returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  item record;
  deleted_count integer:=0;
begin
  perform pg_advisory_xact_lock(71324004,1);
  for item in
    select id from public.tickets
     where status='used' and used_at is not null and used_at<=now()-interval '7 days'
     order by used_at asc
     limit least(greatest(coalesce(p_batch_size,100),1),500)
  loop
    perform public.admin_delete_ticket_record(item.id,null);
    deleted_count:=deleted_count+1;
  end loop;
  return deleted_count;
end $$;

revoke all on function public.purge_used_tickets_after_week(integer) from public,anon,authenticated;
grant execute on function public.purge_used_tickets_after_week(integer) to service_role;