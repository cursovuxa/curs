create or replace function public.staff_check_in_ticket(p_ticket_number text,p_event_id uuid,p_staff_id uuid,p_bypass_assignment boolean default false)
returns jsonb language plpgsql set search_path to 'public','pg_temp' as $function$
declare t public.tickets%rowtype;e public.events%rowtype;v_employee_id uuid;updated_ticket public.tickets%rowtype;
begin
 if p_ticket_number is null or length(trim(p_ticket_number))<5 or p_event_id is null or p_staff_id is null then raise exception 'ticket_invalid'; end if;
 select * into t from public.tickets where ticket_number=upper(trim(p_ticket_number)) for update;
 if not found then raise exception 'ticket_not_found'; end if;
 if t.event_id<>p_event_id then raise exception 'wrong_event'; end if;
 if t.status='used' then raise exception 'ticket_already_used'; end if;
 if t.status<>'valid' then raise exception 'ticket_invalid'; end if;
 select * into e from public.events where id=t.event_id;
 if not found or e.status::text='cancelled' then raise exception 'ticket_invalid'; end if;
 if exists(select 1 from public.user_blocks b where b.blocker_id=e.organizer_id and b.blocked_id=t.user_id) then raise exception 'organizer_blocked_user'; end if;
 if (e.start_date+coalesce(e.end_time,e.start_time,time '23:59:59')) < (now() at time zone 'Asia/Qyzylorda') then raise exception 'ticket_expired'; end if;
 if not coalesce(p_bypass_assignment,false) then
  select emp.id into v_employee_id from public.employees emp where emp.user_id=p_staff_id;
  if v_employee_id is null or not exists(select 1 from public.event_staff_assignments assignment where assignment.event_id=t.event_id and assignment.employee_id=v_employee_id and assignment.status='assigned') then raise exception 'staff_assignment_required'; end if;
 end if;
 update public.tickets set status='used',used_at=now(),used_by_staff_id=p_staff_id where id=t.id and status='valid' returning * into updated_ticket;
 if not found then raise exception 'ticket_already_used'; end if;
 return jsonb_build_object('id',updated_ticket.id,'ticket_number',updated_ticket.ticket_number,'event_id',updated_ticket.event_id,'user_id',updated_ticket.user_id,'status',updated_ticket.status,'used_at',updated_ticket.used_at,'event_title',e.title);
end;$function$;
revoke all on function public.staff_check_in_ticket(text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.staff_check_in_ticket(text,uuid,uuid,boolean) to service_role;