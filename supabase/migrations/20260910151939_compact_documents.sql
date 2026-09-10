alter table public.invoices add column credit_amount numeric not null default 0;
alter table public.payments add column request_id uuid unique;
-- v31: document snapshots, separate change orders, atomic signing and edits.
create table public.fieldops_change_orders (
 id uuid primary key default gen_random_uuid(), change_order_number bigint generated always as identity unique,
 parent_kind text not null check(parent_kind in ('estimate','invoice')), parent_id uuid not null,
 customer_id uuid references public.customers(id), job_id uuid references public.jobs(id),
 base_total numeric not null, total numeric not null, title text, description text,
 items jsonb not null, status text not null default 'draft' check(status in ('draft','approved','cancelled')),
 billing_invoice_id uuid references public.invoices(id), created_at timestamptz not null default now()
);
create unique index fieldops_one_pending_change on public.fieldops_change_orders(parent_kind,parent_id) where status='draft';
create table public.fieldops_documents (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('estimate','invoice','change_order','completion','receipt')),
 source_id uuid not null, token text not null unique, snapshot jsonb not null,
 customer_name text, signature_data text, exceptions text, signed_at timestamptz,
 signed_pdf text, signed_pdf_sha256 text, expires_at timestamptz not null default now()+interval '30 days',
 superseded_at timestamptz, created_at timestamptz not null default now()
);
create index fieldops_documents_source on public.fieldops_documents(kind,source_id,created_at desc);
alter table public.fieldops_change_orders enable row level security;
alter table public.fieldops_documents enable row level security;
revoke all on public.fieldops_documents,public.fieldops_change_orders from anon,authenticated;
grant all on public.fieldops_documents,public.fieldops_change_orders to service_role;
grant usage,select on sequence public.fieldops_change_orders_change_order_number_seq to service_role;
-- Prevent editing or deleting signed snapshots even with a privileged application key.
create function public.fieldops_protect_snapshot() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.signed_at is not null then raise exception 'Signed documents are immutable'; end if;
 if tg_op='UPDATE' and new.snapshot is distinct from old.snapshot then raise exception 'Document snapshots are immutable'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger protect_snapshot before update or delete on public.fieldops_documents for each row execute function public.fieldops_protect_snapshot();
-- A trigger needs visibility of the private signature table even for browser writes.
-- It only rejects mutations; it grants no data access and cannot be invoked as an RPC.
create function public.fieldops_protect_source() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
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
    before_doc:=to_jsonb(old)-array['status','credit_amount','amount_paid','paid_at','sent_at','updated_at','approved_at','billing_invoice_id'];
    after_doc:=to_jsonb(new)-array['status','credit_amount','amount_paid','paid_at','sent_at','updated_at','approved_at','billing_invoice_id'];
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
revoke all on function public.fieldops_protect_source() from public,anon,authenticated;
create trigger protect_estimate before update or delete on public.estimates for each row execute function public.fieldops_protect_source();
create trigger protect_invoice before update or delete on public.invoices for each row execute function public.fieldops_protect_source();
create trigger protect_estimate_items before insert or update or delete on public.estimate_items for each row execute function public.fieldops_protect_source();
create trigger protect_invoice_items before insert or update or delete on public.invoice_items for each row execute function public.fieldops_protect_source();
create trigger protect_change_order before update or delete on public.fieldops_change_orders for each row execute function public.fieldops_protect_source();
create function public.fieldops_document_data(p_kind text,p_id uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare d jsonb; c jsonb; j jsonb; its jsonb; pays jsonb:='[]'; parent jsonb;
begin
 if p_kind='estimate' then
  select to_jsonb(e) into d from estimates e where id=p_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by sort_order,id),'[]') into its from estimate_items i where estimate_id=p_id;
 elsif p_kind in ('invoice','completion','receipt') then
  select to_jsonb(i) into d from invoices i where id=p_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by sort_order,id),'[]') into its from invoice_items i where invoice_id=p_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by created_at,id),'[]') into pays from payments p where invoice_id=p_id;
 elsif p_kind='change_order' then
  select to_jsonb(co) into d from fieldops_change_orders co where id=p_id;
  its:=d->'items';
  if d->>'parent_kind'='estimate' then select to_jsonb(e) into parent from estimates e where id=(d->>'parent_id')::uuid;
  else select to_jsonb(i) into parent from invoices i where id=(d->>'parent_id')::uuid; end if;
  d:=d||jsonb_build_object('parent_number',coalesce(parent->'estimate_number',parent->'invoice_number'),'subtotal',d->'total','tax',0);
 else raise exception 'Invalid document type'; end if;
 if d is null then raise exception 'Document not found'; end if;
 select to_jsonb(x) into c from customers x where id=(d->>'customer_id')::uuid;
 select to_jsonb(x) into j from jobs x where id=(d->>'job_id')::uuid;
 return jsonb_build_object('kind',p_kind,'doc',d,'customer',coalesce(c,'{}'),'job',coalesce(j,'{}'),'items',its,'payments',pays);
end $$;
create function public.fieldops_start_document(p_kind text,p_id uuid,p_token text,p_snapshot jsonb) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare current_data jsonb; existing fieldops_documents; result fieldops_documents;
begin
 if p_kind='estimate' then perform 1 from estimates where id=p_id for update;
 elsif p_kind='change_order' then perform 1 from fieldops_change_orders where id=p_id for update;
 else perform 1 from invoices where id=p_id for update; end if;
 if p_kind<>'receipt' then
 select * into existing from fieldops_documents where kind=p_kind and source_id=p_id and signed_at is not null order by created_at desc limit 1;
 if found then return to_jsonb(existing); end if; end if;
 current_data:=fieldops_document_data(p_kind,p_id);
 if current_data is distinct from (p_snapshot - array['terms','authorization','html','css','logo','template_version']) then raise exception 'Document changed while preparing it; reopen and retry'; end if;
 update fieldops_documents set superseded_at=now() where kind=p_kind and source_id=p_id and signed_at is null and superseded_at is null;
 insert into fieldops_documents(kind,source_id,token,snapshot) values(p_kind,p_id,p_token,p_snapshot) returning * into result;
 return to_jsonb(result);
end $$;
create function public.fieldops_edit_document(p_kind text,p_id uuid,p_title text,p_description text,p_items jsonb) returns jsonb language plpgsql set search_path=public,pg_temp as $$
<<edit>>
declare d jsonb; subtotal numeric:=0; tax numeric; total numeric; row jsonb; locked boolean; co fieldops_change_orders; base numeric;
begin
 if p_kind='invoice' then select to_jsonb(i) into d from invoices i where id=p_id for update;
 elsif p_kind='estimate' then select to_jsonb(e) into d from estimates e where id=p_id for update;
 else raise exception 'Invalid document kind'; end if;
 if d is null then raise exception 'Document not found'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'At least one line item is required (maximum 100)'; end if;
 for row in select value from jsonb_array_elements(p_items) loop
  if coalesce(row->>'description','')='' or (row->>'quantity')::numeric<=0 or (row->>'unit_price')::numeric<0 then raise exception 'Invalid line item'; end if;
  subtotal:=subtotal+round((row->>'quantity')::numeric*(row->>'unit_price')::numeric,2);
 end loop;
 tax:=coalesce((d->>'tax')::numeric,0);total:=subtotal+tax;
 select exists(select 1 from fieldops_documents where source_id=p_id and kind in (p_kind,'completion') and signed_at is not null) into locked;
 if locked then
  if exists(select 1 from fieldops_change_orders where parent_kind=p_kind and parent_id=p_id and status='draft') then raise exception 'A pending change order already exists; review or cancel it first'; end if;
  base:=(d->>'total')::numeric+coalesce((select sum(c.total) from fieldops_change_orders c where parent_kind=p_kind and parent_id=p_id and status='approved'),0);
  insert into fieldops_change_orders(parent_kind,parent_id,customer_id,job_id,base_total,total,title,description,items)
  values(p_kind,p_id,(d->>'customer_id')::uuid,(d->>'job_id')::uuid,base,total-base,p_title,p_description,p_items) returning * into co;
  return jsonb_build_object('change_order_id',co.id,'total',co.total,'base_total',base,'revised_total',total,'updated',false);
 end if;
 if p_kind='invoice' then
  delete from invoice_items where invoice_id=p_id;
  insert into invoice_items(invoice_id,description,quantity,unit_price,line_total,sort_order) select p_id,x->>'description',(x->>'quantity')::numeric,(x->>'unit_price')::numeric,round((x->>'quantity')::numeric*(x->>'unit_price')::numeric,2),n::int from jsonb_array_elements(p_items) with ordinality as t(x,n);
  update invoices set title=p_title,description=p_description,subtotal=edit.subtotal,total=edit.total,updated_at=now() where id=p_id;
 else
  delete from estimate_items where estimate_id=p_id;
  insert into estimate_items(estimate_id,description,quantity,unit_price,line_total,sort_order) select p_id,x->>'description',(x->>'quantity')::numeric,(x->>'unit_price')::numeric,round((x->>'quantity')::numeric*(x->>'unit_price')::numeric,2),n::int from jsonb_array_elements(p_items) with ordinality as t(x,n);
  update estimates set title=p_title,description=p_description,subtotal=edit.subtotal,total=edit.total,updated_at=now() where id=p_id;
 end if;
 return jsonb_build_object('updated',true,'total',total);
end $$;
create function public.fieldops_sign_document(p_token text,p_name text,p_signature text,p_exceptions text,p_signed_at timestamptz,p_pdf text,p_hash text) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare s fieldops_documents; co fieldops_change_orders; parent jsonb; inv uuid;
begin
 select * into s from fieldops_documents where token=p_token;
 if not found then raise exception 'Document not found'; end if;
 if s.kind='estimate' then perform 1 from estimates where id=s.source_id for update;
 elsif s.kind='change_order' then perform 1 from fieldops_change_orders where id=s.source_id for update;
 else perform 1 from invoices where id=s.source_id for update; end if;
 select * into s from fieldops_documents where token=p_token for update;
 if s.signed_at is not null then return jsonb_build_object('signed',true,'already_signed',true,'signed_at',s.signed_at); end if;
 if s.superseded_at is not null or s.expires_at<now() then raise exception 'Signing link expired or replaced'; end if;
 if s.kind='receipt' then raise exception 'Receipts do not require a signature'; end if;
 if length(p_name)<2 or length(p_pdf)<100 or length(p_signature)<1000 then raise exception 'Invalid signature'; end if;
 if s.kind='change_order' then
  select * into co from fieldops_change_orders where id=s.source_id for update;
  if co.status<>'draft' then raise exception 'Change order is no longer pending'; end if;
  if co.parent_kind='invoice' then select to_jsonb(i) into parent from invoices i where id=co.parent_id;
  else select to_jsonb(e) into parent from estimates e where id=co.parent_id; end if;
  if co.total<>0 then
   insert into invoices(owner_id,customer_id,job_id,title,description,status,subtotal,tax,total)
   values((parent->>'owner_id')::uuid,co.customer_id,co.job_id,'Change Order #'||co.change_order_number,
    'Separate adjustment to '||co.parent_kind||' #'||coalesce(parent->>'invoice_number',parent->>'estimate_number')||'. '||co.description,case when co.total<0 then 'paid' else 'draft' end,co.total,0,co.total) returning id into inv;
   insert into invoice_items(invoice_id,description,quantity,unit_price,line_total,sort_order)
   values(inv,'Approved Change Order #'||co.change_order_number||' adjustment',1,co.total,co.total,0);
  end if;
  if co.total<0 then
   update invoices set credit_amount=credit_amount-co.total,updated_at=now() where (co.parent_kind='invoice' and id=co.parent_id) or (co.parent_kind='estimate' and estimate_id=co.parent_id);
  end if;
  update fieldops_change_orders set status='approved',billing_invoice_id=inv where id=co.id;
 elsif s.kind='estimate' then update estimates set status='approved',approved_at=now(),updated_at=now() where id=s.source_id;
 end if;
 update fieldops_documents set customer_name=p_name,signature_data=p_signature,exceptions=p_exceptions,signed_at=p_signed_at,signed_pdf=p_pdf,signed_pdf_sha256=p_hash where id=s.id;
 return jsonb_build_object('signed',true,'signed_at',p_signed_at,'billing_invoice_id',inv);
end $$;
-- Only authenticated server handlers may call these privileged data workflows.
revoke all on function public.fieldops_document_data(text,uuid),public.fieldops_start_document(text,uuid,text,jsonb),public.fieldops_edit_document(text,uuid,text,text,jsonb),public.fieldops_sign_document(text,text,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.fieldops_document_data(text,uuid),public.fieldops_start_document(text,uuid,text,jsonb),public.fieldops_edit_document(text,uuid,text,text,jsonb),public.fieldops_sign_document(text,text,text,text,timestamptz,text,text) to service_role;
-- Complete Job and estimate conversion commit invoice + items together.
create function public.fieldops_complete_job(p_job_id uuid default null,p_estimate_id uuid default null) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare j jobs; e estimates; inv invoices; rows jsonb; sub numeric; customer uuid; owner uuid;
begin
 if p_job_id is null and p_estimate_id is null then raise exception 'Choose a job or estimate'; end if;
 if p_job_id is not null then
  select * into j from jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  select * into e from estimates where job_id=p_job_id and status in ('approved','converted') order by approved_at desc nulls last,created_at desc limit 1 for update;
 else
  select * into e from estimates where id=p_estimate_id for update;
  if not found or e.status not in ('approved','converted') then raise exception 'Estimate must be approved first'; end if;
 end if;
 select i.* into inv from invoices i where (e.id is not null and i.estimate_id=e.id) or (p_job_id is not null and i.job_id=p_job_id and not exists(select 1 from fieldops_change_orders c where c.billing_invoice_id=i.id)) order by created_at limit 1;
 if found then if p_job_id is not null then update jobs set status='completed',updated_at=now() where id=p_job_id;end if;return jsonb_build_object('completed',true,'existing',true,'invoice_id',inv.id); end if;
 customer:=coalesce(e.customer_id,j.customer_id);owner:=coalesce(e.owner_id,j.owner_id);
 if customer is null then raise exception 'Job must have a customer before completion'; end if;
 if e.id is not null then select coalesce(jsonb_agg(to_jsonb(i) order by sort_order,id),'[]') into rows from estimate_items i where estimate_id=e.id;
 else select coalesce(jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'line_total',round(quantity*unit_price,2)) order by created_at,id),'[]') into rows from job_materials where job_id=p_job_id and billable=true; end if;
 if jsonb_array_length(rows)=0 then rows:=jsonb_build_array(jsonb_build_object('description',coalesce(j.title,e.title,'Completed service - review pricing'),'quantity',1,'unit_price',0,'line_total',0)); end if;
 select sum((x->>'line_total')::numeric) into sub from jsonb_array_elements(rows) x;
 insert into invoices(owner_id,customer_id,job_id,estimate_id,title,description,status,subtotal,tax,total)
 values(owner,customer,coalesce(p_job_id,e.job_id),e.id,coalesce(e.title,j.title),coalesce(e.description,j.notes),'draft',coalesce(e.subtotal,sub),coalesce(e.tax,0),coalesce(e.total,sub)) returning * into inv;
 insert into invoice_items(invoice_id,description,quantity,unit_price,line_total,sort_order)
 select inv.id,x->>'description',(x->>'quantity')::numeric,(x->>'unit_price')::numeric,(x->>'line_total')::numeric,n::int from jsonb_array_elements(rows) with ordinality as t(x,n);
 if e.id is not null then update invoices set credit_amount=coalesce((select -sum(total) from fieldops_change_orders where parent_kind='estimate' and parent_id=e.id and status='approved' and total<0),0) where id=inv.id; end if;
 if p_job_id is not null then update jobs set status='completed',updated_at=now() where id=p_job_id;end if;
 return jsonb_build_object('completed',true,'existing',false,'invoice_id',inv.id);
end $$;
revoke all on function public.fieldops_complete_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fieldops_complete_job(uuid,uuid) to service_role;

create function public.fieldops_record_payment(p_invoice_id uuid,p_amount numeric,p_method text,p_request_id uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare inv invoices; paid numeric; existing payments;
begin
 select * into inv from invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 select * into existing from payments where request_id=p_request_id;
 if found then
  if existing.invoice_id<>p_invoice_id or existing.amount<>p_amount or existing.method<>p_method then raise exception 'Payment request conflict'; end if;
  return jsonb_build_object('recorded',true,'already_recorded',true);
 end if;
 if p_amount<=0 or p_amount<>round(p_amount,2) or p_request_id is null or p_method not in ('cash','check','card_external','bank_external','other') then raise exception 'Invalid payment'; end if;
 select coalesce(sum(amount),0) into paid from payments where invoice_id=p_invoice_id and status in ('succeeded','completed','paid');
 if p_amount>inv.total-inv.credit_amount-paid then raise exception 'Payment exceeds remaining balance'; end if;
 if inv.status='void' then raise exception 'Cannot pay a void invoice'; end if;
 insert into payments(invoice_id,amount,method,status,request_id) values(p_invoice_id,p_amount,p_method,'succeeded',p_request_id);
 paid:=paid+p_amount;
 update invoices set amount_paid=paid,status=case when paid+credit_amount>=total then 'paid' else 'partial' end,paid_at=case when paid+credit_amount>=total then now() else null end,updated_at=now() where id=p_invoice_id;
 return jsonb_build_object('recorded',true,'amount_paid',paid,'balance',inv.total-inv.credit_amount-paid);
end $$;
revoke all on function public.fieldops_record_payment(uuid,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.fieldops_record_payment(uuid,numeric,text,uuid) to service_role;
