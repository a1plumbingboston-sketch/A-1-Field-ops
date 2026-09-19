-- Owner-configurable hourly labor rate, split into two independent ranges:
-- 'service' (day-to-day service calls) and 'construction' (remodels/builds).
-- Only server code using the service-role key can read or write this table.
create table public.fieldops_labor_rate_settings (
  profile text primary key check (profile in ('service','construction')),
  min_rate numeric not null check (min_rate > 0 and min_rate <= 1000),
  max_rate numeric not null check (max_rate >= min_rate and max_rate <= 1000),
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.fieldops_labor_rate_settings enable row level security;
revoke all on public.fieldops_labor_rate_settings from public, anon, authenticated;
grant select, insert, update on public.fieldops_labor_rate_settings to service_role;

insert into public.fieldops_labor_rate_settings (profile, min_rate, max_rate) values
  ('service', 120, 200),
  ('construction', 120, 200);
