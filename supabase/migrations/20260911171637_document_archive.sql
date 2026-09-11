alter table public.estimates add column if not exists archived_at timestamptz;
alter table public.invoices add column if not exists archived_at timestamptz;
alter table public.jobs drop constraint if exists jobs_archive_completed_only;
create or replace function public.fieldops_protect_source() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare k text; sid uuid; before_doc jsonb; after_doc jsonb;
begin
 k:=case when tg_table_name in ('estimates','estimate_items') then 'estimate' when tg_table_name='fieldops_change_orders' then 'change_order' else 'invoice' end;
 if tg_table_name in ('estimate_items','invoice_items') then
   sid:=case when tg_op='DELETE' then (to_jsonb(old)->>(k||'_id'))::uuid else (to_jsonb(new)->>(k||'_id'))::uuid end;
   -- Item reassignment must protect the old parent too.
   if tg_op='UPDATE' and to_jsonb(old)->>(k||'_id') is distinct from to_jsonb(new)->>(k||'_id') then raise exception 'Move items by creating a new document'; end if;
 else
   sid:=old.id;
   if tg_op='UPDATE' then
    before_doc:=to_jsonb(old)-array['status','credit_amount','amount_paid','paid_at','sent_at','updated_at','approved_at','billing_invoice_id','archived_at'];
    after_doc:=to_jsonb(new)-array['status','credit_amount','amount_paid','paid_at','sent_at','updated_at','approved_at','billing_invoice_id','archived_at'];
    if before_doc=after_doc then return new; end if;
   end if;
 end if;
 -- Same row lock used by signing avoids edit/sign races.
 if k='estimate' then perform 1 from public.estimates where id=sid for update;
 elsif k='invoice' then perform 1 from public.invoices where id=sid for update;
 else perform 1 from public.fieldops_change_orders where id=sid for update; end if;
 if exists(select 1 from public.fieldops_documents where source_id=sid and kind in (k,case when k='invoice' then 'completion' else k end) and signed_at is not null) then
  raise exception 'Signed document is locked; create a separate change order';
 end if;
 update public.fieldops_documents set superseded_at=now() where source_id=sid and signed_at is null and superseded_at is null;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
