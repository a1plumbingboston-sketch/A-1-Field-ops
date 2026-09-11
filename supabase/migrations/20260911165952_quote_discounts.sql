-- Allow explicit dollar discounts without changing signed snapshots or access grants.
create or replace function public.fieldops_create_quote(p_request_id uuid,p_customer_id uuid,p_job_id uuid,p_title text,p_description text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c customers; e estimates; j jobs; item jsonb; qty numeric; price numeric; subtotal numeric:=0; payload jsonb;
begin
 if p_request_id is null or p_customer_id is null or nullif(btrim(p_title),'') is null or length(p_title)>300 then raise exception 'Choose a client and enter a quote title';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Enter 1–100 valid line items';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number' or nullif(btrim(item->>'description'),'') is null or length(item->>'description')>500 then raise exception 'Invalid line item';end if;
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  if qty<=0 or (price<0 and (item->>'description'<>'Discount' or qty<>1)) or qty*price>1000000000 then raise exception 'Invalid line item';end if;
  subtotal:=subtotal+round(qty*price,2);
 end loop;
 if subtotal<0 then raise exception 'Discount exceeds subtotal';end if;
 if subtotal>1000000000 then raise exception 'Quote total is too large';end if;
 select * into c from customers where id=p_customer_id;
 if not found or c.owner_id is null then raise exception 'Client not found or owner is missing';end if;
 payload:=jsonb_build_object('customer',p_customer_id,'job',p_job_id,'title',btrim(p_title),'description',coalesce(p_description,''),'items',p_items);
 perform pg_advisory_xact_lock(hashtextextended('fieldops-quote:'||p_request_id::text,0));
 select * into e from estimates where create_request_id=p_request_id;
 if found then
  if e.create_request_payload is distinct from payload then raise exception 'This save request already created a different quote. Review the saved quote before starting another';end if;
  return jsonb_build_object('id',e.id,'existing',true);
 end if;
 if p_job_id is not null then
  select * into j from jobs where id=p_job_id and customer_id=p_customer_id for share;
  if not found or j.owner_id<>c.owner_id or j.status in ('completed','cancelled') or j.archived_at is not null then raise exception 'Choose an active job belonging to this client, or leave Job blank';end if;
 end if;
 insert into estimates(owner_id,customer_id,job_id,title,description,status,subtotal,tax,total,create_request_id,create_request_payload)
 values(c.owner_id,c.id,p_job_id,btrim(p_title),coalesce(p_description,''),'draft',subtotal,0,subtotal,p_request_id,payload) returning * into e;
 insert into estimate_items(estimate_id,description,quantity,unit_price,line_total,sort_order)
 select e.id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,round((x->>'quantity')::numeric*(x->>'unit_price')::numeric,2),n::int
 from jsonb_array_elements(p_items) with ordinality as t(x,n);
 return jsonb_build_object('id',e.id,'existing',false);
end $$;
create or replace function public.fieldops_edit_document(p_kind text,p_id uuid,p_title text,p_description text,p_items jsonb) returns jsonb language plpgsql set search_path=public,pg_temp as $$
<<edit>>
declare d jsonb; subtotal numeric:=0; tax numeric; total numeric; row jsonb; locked boolean; co fieldops_change_orders; base numeric;
begin
 if p_kind='invoice' then select to_jsonb(i) into d from invoices i where id=p_id for update;
 elsif p_kind='estimate' then select to_jsonb(e) into d from estimates e where id=p_id for update;
 else raise exception 'Invalid document kind'; end if;
 if d is null then raise exception 'Document not found'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'At least one line item is required (maximum 100)'; end if;
 for row in select value from jsonb_array_elements(p_items) loop
  if coalesce(row->>'description','')='' or (row->>'quantity')::numeric<=0 or ((row->>'unit_price')::numeric<0 and (row->>'description'<>'Discount' or (row->>'quantity')::numeric<>1)) then raise exception 'Invalid line item'; end if;
  subtotal:=subtotal+round((row->>'quantity')::numeric*(row->>'unit_price')::numeric,2);
 end loop;
 if subtotal<0 then raise exception 'Discount exceeds subtotal';end if;
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
