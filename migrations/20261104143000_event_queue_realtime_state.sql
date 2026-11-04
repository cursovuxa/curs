
create table if not exists public.event_queue_state(
 event_id uuid primary key references public.events(id) on delete cascade,
 active_count integer not null default 0,
 waiting_count integer not null default 0,
 available_seats integer not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.event_queue_state enable row level security;
drop policy if exists event_queue_state_read_published on public.event_queue_state;
create policy event_queue_state_read_published on public.event_queue_state for select to authenticated
using(exists(select 1 from public.events e where e.id=event_id and e.status='published'));
revoke all on public.event_queue_state from anon,authenticated;
grant select on public.event_queue_state to authenticated;

create or replace function public.refresh_event_queue_state(p_event_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.event_queue_state(event_id,active_count,waiting_count,available_seats,updated_at)
 select e.id,
   (select count(*)::integer from public.queue_tokens q where q.event_id=e.id and q.status in('waiting','ready','payment')),
   (select count(*)::integer from public.queue_tokens q where q.event_id=e.id and q.status='waiting'),
   greatest(e.available_seats,0),now()
 from public.events e where e.id=p_event_id
 on conflict(event_id) do update set active_count=excluded.active_count,waiting_count=excluded.waiting_count,available_seats=excluded.available_seats,updated_at=now();
end $$;
revoke all on function public.refresh_event_queue_state(uuid) from public,anon,authenticated;

create or replace function public.sync_event_queue_state_from_queue()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then perform public.refresh_event_queue_state(old.event_id); return old; end if;
 perform public.refresh_event_queue_state(new.event_id);
 if tg_op='UPDATE' and old.event_id is distinct from new.event_id then perform public.refresh_event_queue_state(old.event_id); end if;
 return new;
end $$;
revoke all on function public.sync_event_queue_state_from_queue() from public,anon,authenticated;

create or replace function public.sync_event_queue_state_from_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then return old; end if;
 perform public.refresh_event_queue_state(new.id);
 return new;
end $$;
revoke all on function public.sync_event_queue_state_from_event() from public,anon,authenticated;

drop trigger if exists queue_tokens_realtime_state on public.queue_tokens;
create trigger queue_tokens_realtime_state after insert or update or delete on public.queue_tokens
for each row execute function public.sync_event_queue_state_from_queue();
drop trigger if exists events_realtime_queue_state on public.events;
create trigger events_realtime_queue_state after update of available_seats,status on public.events
for each row execute function public.sync_event_queue_state_from_event();

insert into public.event_queue_state(event_id,active_count,waiting_count,available_seats,updated_at)
select e.id,
 (select count(*)::integer from public.queue_tokens q where q.event_id=e.id and q.status in('waiting','ready','payment')),
 (select count(*)::integer from public.queue_tokens q where q.event_id=e.id and q.status='waiting'),
 greatest(e.available_seats,0),now()
from public.events e
on conflict(event_id) do update set active_count=excluded.active_count,waiting_count=excluded.waiting_count,available_seats=excluded.available_seats,updated_at=now();

do $$ begin alter publication supabase_realtime add table public.event_queue_state; exception when duplicate_object then null; end $$;
