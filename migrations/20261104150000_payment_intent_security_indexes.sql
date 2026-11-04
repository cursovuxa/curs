
create policy payment_intents_deny_client_access on public.payment_intents
for all to anon,authenticated using(false) with check(false);
create index if not exists payment_intents_event_id_idx on public.payment_intents(event_id);
create index if not exists payment_intents_seat_id_idx on public.payment_intents(seat_id);
create index if not exists payment_intents_queue_token_id_idx on public.payment_intents(queue_token_id);
create index if not exists payment_intents_ticket_id_idx on public.payment_intents(ticket_id);
