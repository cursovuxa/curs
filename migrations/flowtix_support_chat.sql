create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('user','admin')),
  sender_id uuid references public.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  telegram_message_id bigint unique,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_conversation_created_idx
  on public.support_messages(conversation_id, created_at desc);
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_conversations, public.support_messages from anon, authenticated;
grant select on public.support_conversations, public.support_messages to authenticated;
drop policy if exists support_conversations_read_own on public.support_conversations;
create policy support_conversations_read_own on public.support_conversations
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists support_messages_read_own on public.support_messages;
create policy support_messages_read_own on public.support_messages
  for select to authenticated using (
    exists (
      select 1 from public.support_conversations c
      where c.id = support_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end $$;
