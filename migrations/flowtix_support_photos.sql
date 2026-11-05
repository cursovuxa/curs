alter table public.support_messages add column if not exists telegram_file_id text;
alter table public.support_messages add column if not exists media_mime_type text;
alter table public.support_messages alter column body set default '';
alter table public.support_messages drop constraint if exists support_messages_body_check;
alter table public.support_messages add constraint support_messages_body_check
  check (char_length(body) <= 2000 and (char_length(body) > 0 or telegram_file_id is not null));
