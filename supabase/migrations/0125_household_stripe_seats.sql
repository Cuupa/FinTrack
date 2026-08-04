alter table public.billing_config
  add column if not exists household_member_price text;
alter table public.billing_config
  add column if not exists household_member_price_display text;

create table if not exists public.household_seat_addons (
  household_id uuid primary key references public.households (id) on delete cascade,
  stripe_subscription_item_id text not null unique,
  quantity integer not null default 0 check (quantity >= 0),
  status text not null default 'inactive',
  updated_at timestamptz not null default now()
);
alter table public.household_seat_addons enable row level security;
drop policy if exists "household members view seat addon" on public.household_seat_addons;
create policy "household members view seat addon" on public.household_seat_addons
  for select using (household_id = public.my_household_id());

create or replace function public.enforce_household_member_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  max_members integer := 2;
begin
  select 2 + coalesce(quantity, 0) into max_members
  from public.household_seat_addons
  where household_id = new.household_id and status in ('active', 'trialing');
  if (select count(*) from public.household_members where household_id = new.household_id) >= max_members then
    raise exception 'household member limit reached';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_household_member_limit() from public;
drop trigger if exists enforce_household_member_limit on public.household_members;
create trigger enforce_household_member_limit
  before insert on public.household_members
  for each row execute function public.enforce_household_member_limit();

insert into public.schema_migrations (version) values ('0125_household_stripe_seats')
on conflict (version) do nothing;
