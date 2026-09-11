-- Private business tools: only authenticated FieldOps server routes access these tables.
create table public.fieldops_pricebook (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 160),
 description text not null default '', category text not null default '',
 quantity numeric not null default 1 check(quantity>0 and quantity<=1000000),
 unit_price numeric(12,2) not null check(unit_price>=0),
 archived_at timestamptz, created_at timestamptz not null default now()
);
create table public.fieldops_job_photos (
 id uuid primary key, job_id uuid not null references public.jobs(id),
 caption text not null default '', phase text not null check(phase in ('before','during','after')),
 image_data text not null check(length(image_data)<=1400000 and image_data like 'data:image/jpeg;base64,%'),
 deleted_at timestamptz, created_at timestamptz not null default now()
);
create index fieldops_job_photos_job on public.fieldops_job_photos(job_id,created_at desc);
create table public.fieldops_deliveries (
 id uuid primary key default gen_random_uuid(), kind text not null, source_id uuid not null,
 recipient text not null, provider_id text, status text not null default 'sending',
 detail text, checked_at timestamptz, created_at timestamptz not null default now()
);
create index fieldops_deliveries_source on public.fieldops_deliveries(kind,source_id,created_at desc);
alter table public.fieldops_pricebook enable row level security;
alter table public.fieldops_job_photos enable row level security;
alter table public.fieldops_deliveries enable row level security;
revoke all on public.fieldops_pricebook,public.fieldops_job_photos,public.fieldops_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.fieldops_pricebook,public.fieldops_job_photos,public.fieldops_deliveries to service_role;
