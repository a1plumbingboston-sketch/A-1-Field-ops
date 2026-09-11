-- Private company finance workspace. Access only through the owner-authorized API.
create table public.fieldops_cost_profile (
 id text primary key check(id='company'), inputs jsonb not null,
 updated_at timestamptz not null default now()
);
create table public.fieldops_finance_entries (
 id uuid primary key,
 entry_date date not null,
 kind text not null check(kind in ('expense','loan_received','owner_contribution','owner_draw','loan_principal','asset_purchase','tax_payment')),
 category text not null,
 payee text not null check(length(payee) between 1 and 160),
 amount numeric(14,2) not null check(amount>0),
 status text not null check(status in ('paid','due')),
 notes text not null default '',
 created_at timestamptz not null default now(),
 voided_at timestamptz,
 void_reason text
);
alter table public.fieldops_cost_profile enable row level security;
alter table public.fieldops_finance_entries enable row level security;
revoke all on public.fieldops_cost_profile,public.fieldops_finance_entries from public,anon,authenticated;
grant select,insert,update on public.fieldops_cost_profile,public.fieldops_finance_entries to service_role;
create index fieldops_finance_entries_date on public.fieldops_finance_entries(entry_date,id) where voided_at is null;
