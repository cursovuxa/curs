
alter table public.event_queue_state add column if not exists event_status text not null default 'published';
drop policy if exists event_queue_state_read_published on public.event_queue_state;
create policy event_queue_state_read_published on public.event_queue_state for select to authenticated using(event_status='published');

create or replace function public.refresh_event_queue_state(p_event_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.event_queue_state(event_id,active_count,waiting_count,available_seats,updated_at,event_status)
 select e.id,
   (select count(*)::integer from public.queue_tokens q where q.event_id=e.id and q.status in('waiting','ready','payment')),
   (select count(*)::integer from public.queue_tokens q where q.event_id=e.id and q.status='waiting'),
   greatest(e.available_seats,0),now(),e.status::text
 from public.events e where e.id=p_event_id
 on conflict(event_id) do update set active_count=excluded.active_count,waiting_count=excluded.waiting_count,available_seats=excluded.available_seats,updated_at=now(),event_status=excluded.event_status;
end $$;
revoke all on function public.refresh_event_queue_state(uuid) from public,anon,authenticated;

update public.event_queue_state q set event_status=e.status::text from public.events e where e.id=q.event_id;

drop policy if exists queue_tokens_read_own on public.queue_tokens;
create policy queue_tokens_read_own on public.queue_tokens for select to authenticated using(user_id=(select auth.uid()));
create index if not exists queue_tokens_user_id_idx on public.queue_tokens(user_id);
