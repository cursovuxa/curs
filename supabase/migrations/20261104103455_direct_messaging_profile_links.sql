create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references public.users(id) on delete cascade,
  participant_b uuid not null references public.users(id) on delete cascade,
  request_by uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','declined')),
  cleared_at_a timestamptz,
  cleared_at_b timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_conversations_pair_order check (participant_a < participant_b),
  constraint direct_conversations_request_participant check (request_by in (participant_a,participant_b)),
  constraint direct_conversations_no_self check (participant_a <> participant_b),
  unique (participant_a, participant_b)
);
create index if not exists direct_conversations_a_updated_idx on public.direct_conversations(participant_a, updated_at desc);
create index if not exists direct_conversations_b_updated_idx on public.direct_conversations(participant_b, updated_at desc);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body varchar(512) not null check (length(btrim(body)) between 1 and 512),
  created_at timestamptz not null default now()
);
create index if not exists direct_messages_conversation_created_idx on public.direct_messages(conversation_id, created_at desc, id desc);

create table if not exists public.profile_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  url text not null check (length(url) between 8 and 2048),
  platform text not null default 'website' check (platform in ('telegram','youtube','instagram','tiktok','vk','discord','x','website')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  moderated_by uuid references public.users(id) on delete set null,
  moderated_at timestamptz
);
create unique index if not exists profile_links_unique_active_url on public.profile_links(user_id, lower(url)) where status in ('pending','approved');
create index if not exists profile_links_moderation_idx on public.profile_links(status, created_at desc);

alter table public.wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind = any (array['visual_topup','ticket_purchase','ticket_refund','admin_adjustment']::text[]));
alter table public.wallet_transactions add column if not exists admin_actor_id uuid references public.users(id) on delete set null;

alter table public.user_blocks enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;
alter table public.profile_links enable row level security;

revoke all on public.user_blocks, public.direct_conversations, public.direct_messages, public.profile_links from anon, authenticated;
grant select on public.user_blocks, public.direct_conversations, public.direct_messages, public.profile_links to authenticated;
grant select on public.profile_links to anon;

drop policy if exists user_blocks_participant_select on public.user_blocks;
create policy user_blocks_participant_select on public.user_blocks for select to authenticated
  using (auth.uid() = blocker_id or auth.uid() = blocked_id);

drop policy if exists direct_conversations_participant_select on public.direct_conversations;
create policy direct_conversations_participant_select on public.direct_conversations for select to authenticated
  using (auth.uid() = participant_a or auth.uid() = participant_b);

drop policy if exists direct_messages_active_participant_select on public.direct_messages;
create policy direct_messages_active_participant_select on public.direct_messages for select to authenticated
  using (exists (
    select 1 from public.direct_conversations c
    where c.id = conversation_id and c.status = 'active'
      and auth.uid() in (c.participant_a, c.participant_b)
  ));

drop policy if exists profile_links_approved_select on public.profile_links;
create policy profile_links_approved_select on public.profile_links for select to anon, authenticated
  using (status = 'approved' or (auth.uid() is not null and auth.uid() = user_id));

create or replace function public.guard_direct_message()
returns trigger
language plpgsql
set search_path = public
as $$
declare c public.direct_conversations%rowtype;
begin
  select * into c from public.direct_conversations where id = new.conversation_id for update;
  if not found or c.status <> 'active' then raise exception 'conversation_not_active'; end if;
  if new.sender_id not in (c.participant_a,c.participant_b) then raise exception 'sender_not_participant'; end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = c.participant_a and b.blocked_id = c.participant_b)
       or (b.blocker_id = c.participant_b and b.blocked_id = c.participant_a)
  ) then raise exception 'user_blocked'; end if;
  if length(btrim(new.body)) not between 1 and 512 then raise exception 'message_length_invalid'; end if;
  return new;
end;
$$;
drop trigger if exists direct_messages_guard on public.direct_messages;
create trigger direct_messages_guard before insert or update on public.direct_messages
for each row execute function public.guard_direct_message();

create or replace function public.guard_ticket_user_block()
returns trigger
language plpgsql
set search_path = public
as $$
declare event_organizer uuid;
begin
  if new.user_id is null or new.event_id is null then return new; end if;
  select organizer_id into event_organizer from public.events where id = new.event_id;
  if event_organizer is not null and exists (
    select 1 from public.user_blocks b
    where b.blocker_id = event_organizer and b.blocked_id = new.user_id
  ) then raise exception 'organizer_blocked_user'; end if;
  return new;
end;
$$;
drop trigger if exists tickets_guard_user_block on public.tickets;
create trigger tickets_guard_user_block before insert or update of user_id,event_id on public.tickets
for each row execute function public.guard_ticket_user_block();

create or replace function public.purge_direct_message_data()
returns jsonb
language plpgsql
set search_path = public
as $$
declare old_messages integer := 0; empty_chats integer := 0;
begin
  delete from public.direct_messages where created_at <= now() - interval '7 days';
  get diagnostics old_messages = row_count;
  delete from public.direct_conversations
   where cleared_at_a is not null and cleared_at_b is not null;
  get diagnostics empty_chats = row_count;
  return jsonb_build_object('messages_deleted',old_messages,'conversations_deleted',empty_chats);
end;
$$;
revoke all on function public.purge_direct_message_data() from public, anon, authenticated;
grant execute on function public.purge_direct_message_data() to service_role;

create or replace function public.admin_adjust_wallet(
  p_user_id uuid, p_amount numeric, p_actor_id uuid, p_note text default null
)
returns numeric
language plpgsql
set search_path = public
as $$
declare current_balance numeric; next_balance numeric;
begin
  if p_amount = 0 or abs(p_amount) > 100000000 then raise exception 'invalid_adjustment'; end if;
  insert into public.wallet_accounts(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
  select balance into current_balance from public.wallet_accounts where user_id=p_user_id for update;
  next_balance := current_balance + p_amount;
  if next_balance < 0 then raise exception 'insufficient_balance'; end if;
  update public.wallet_accounts set balance=next_balance,updated_at=now() where user_id=p_user_id;
  insert into public.wallet_transactions(user_id,amount,balance_after,kind,reference_id,admin_actor_id)
  values(p_user_id,p_amount,next_balance,'admin_adjustment',null,p_actor_id);
  return next_balance;
end;
$$;
revoke all on function public.admin_adjust_wallet(uuid,numeric,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_adjust_wallet(uuid,numeric,uuid,text) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;