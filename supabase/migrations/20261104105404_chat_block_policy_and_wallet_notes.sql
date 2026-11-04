drop policy if exists direct_conversations_participant_select on public.direct_conversations;
create policy direct_conversations_participant_select on public.direct_conversations for select to authenticated
using (
  auth.uid() in (participant_a,participant_b)
  and not exists(select 1 from public.user_blocks b where (b.blocker_id=participant_a and b.blocked_id=participant_b) or (b.blocker_id=participant_b and b.blocked_id=participant_a))
);
drop policy if exists direct_messages_active_participant_select on public.direct_messages;
create policy direct_messages_active_participant_select on public.direct_messages for select to authenticated
using (exists(select 1 from public.direct_conversations c where c.id=conversation_id and c.status='active' and auth.uid() in (c.participant_a,c.participant_b)
  and not exists(select 1 from public.user_blocks b where (b.blocker_id=c.participant_a and b.blocked_id=c.participant_b) or (b.blocker_id=c.participant_b and b.blocked_id=c.participant_a))));
create or replace function public.admin_adjust_wallet(p_user_id uuid,p_amount numeric,p_actor_id uuid,p_note text default null)
returns numeric language plpgsql set search_path=public as $$
declare current_balance numeric; next_balance numeric;
begin
 if p_amount=0 or abs(p_amount)>100000000 then raise exception 'invalid_adjustment'; end if;
 insert into public.wallet_accounts(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
 select balance into current_balance from public.wallet_accounts where user_id=p_user_id for update;
 next_balance:=current_balance+p_amount;
 if next_balance<0 then raise exception 'insufficient_balance'; end if;
 update public.wallet_accounts set balance=next_balance,updated_at=now() where user_id=p_user_id;
 insert into public.wallet_transactions(user_id,amount,balance_after,kind,reference_id,admin_actor_id,description)
 values(p_user_id,p_amount,next_balance,'admin_adjustment',null,p_actor_id,nullif(left(btrim(p_note),240),''));
 return next_balance;
end $$;
revoke all on function public.admin_adjust_wallet(uuid,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_adjust_wallet(uuid,numeric,uuid,text) to service_role;