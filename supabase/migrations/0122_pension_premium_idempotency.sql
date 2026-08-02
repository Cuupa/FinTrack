-- A policy premium has two effects that must never split: it creates the
-- ledger row and advances the policy's booked-through date. The contract row
-- lock serialises retries, and the existing row is returned if a response was
-- lost after the original commit.
--
-- Every column of the ledger row is a parameter. A shorter signature that
-- hardcoded the unused ones to null would make this path drop fields the
-- ordinary insert keeps, and the two stores would disagree again. Postgres
-- overloads rather than replaces when the parameter list changes, so the
-- earlier signature is dropped by name first.
drop function if exists public.book_pension_premium(uuid, uuid, date, numeric, text, text, uuid);

create or replace function public.book_pension_premium(
  p_account_id uuid,
  p_contract_id uuid,
  p_date date,
  p_amount numeric,
  p_payee text,
  p_note text,
  p_category_id uuid default null,
  p_recurring_id uuid default null,
  p_transfer_account_id uuid default null,
  p_planned_id uuid default null,
  p_savings_plan_id uuid default null,
  p_transaction_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform 1
  from public.pension_contracts
  where id = p_contract_id
  for update;
  if not found then
    raise exception 'pension contract % not found', p_contract_id;
  end if;

  select id into v_id
  from public.spending_transactions
  where pension_contract_id = p_contract_id and date = p_date
  order by created_at
  limit 1;

  if v_id is null then
    insert into public.spending_transactions (
      id, user_id, account_id, category_id, date, amount, payee, note,
      recurring_id, transfer_account_id, planned_id, savings_plan_id, pension_contract_id
    ) values (
      coalesce(p_transaction_id, gen_random_uuid()), auth.uid(), p_account_id,
      p_category_id, p_date, p_amount, p_payee, p_note,
      p_recurring_id, p_transfer_account_id, p_planned_id, p_savings_plan_id, p_contract_id
    )
    returning id into v_id;
  end if;

  -- Unconditional: a row written before this was one operation can have left
  -- the cursor behind, and only the retry can move it forward.
  update public.pension_contracts
  set last_booked_date = greatest(coalesce(last_booked_date, p_date), p_date)
  where id = p_contract_id;

  return v_id;
end;
$$;
