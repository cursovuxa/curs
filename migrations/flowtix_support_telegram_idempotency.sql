alter table public.support_messages add column if not exists telegram_update_id bigint unique;
