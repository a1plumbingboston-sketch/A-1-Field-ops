-- A-1 FieldOps v29: immutable invoice e-signature records.
-- Run once in the Supabase SQL editor before using customer e-signatures.
create extension if not exists pgcrypto;

create table if not exists public.invoice_signatures (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  revision integer not null default 1,
  token text not null unique,
  customer_name text,
  customer_email text,
  signature_data text,
  signed_at timestamptz,
  sent_at timestamptz,
  expires_at timestamptz,
  superseded_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists invoice_signatures_invoice_idx on public.invoice_signatures(invoice_id, revision desc, created_at desc);
create index if not exists invoice_signatures_token_idx on public.invoice_signatures(token);

alter table public.invoice_signatures enable row level security;
-- No browser policies are intentionally added. Public signing goes only through
-- Vercel server endpoints using the service-role key and an unguessable token.
