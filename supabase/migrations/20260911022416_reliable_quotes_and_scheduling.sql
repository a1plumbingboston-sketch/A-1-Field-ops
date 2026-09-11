-- Atomic quote creation with request identity, plus job links that do not mutate signed quotes.
alter table public.estimates add column create_request_id uuid unique;
alter table public.estimates add column create_request_payload jsonb;
alter table public.jobs add column source_estimate_id uuid unique references public.estimates(id);

create function public.fieldops_create_quote(p_request_id uuid,p_customer_id uuid,p_job_id uuid,p_title text,p_description text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c customers; e estimates; j jobs; item jsonb; qty numeric; price numeric; subtotal numeric:=0; payload jsonb;
begin
 if p_request_id is null or p_customer_id is null or nullif(btrim(p_title),'') is null or length(p_title)>300 then raise exception 'Choose a client and enter a quote title';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Enter 1–100 valid line items';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number' or nullif(btrim(item->>'description'),'') is null or length(item->>'description')>500 then raise exception 'Invalid line item';end if;
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  if qty<=0 or price<0 or qty*price>1000000000 then raise exception 'Invalid line item';end if;
  subtotal:=subtotal+round(qty*price,2);
 end loop;
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

create function public.fieldops_schedule_quote(p_estimate_id uuid,p_scheduled_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare e estimates; c customers; j jobs;
begin
 select * into e from estimates where id=p_estimate_id for update;
 if not found or e.status not in ('approved','converted') then raise exception 'Approve the quote before creating a job';end if;
 if e.customer_id is null then raise exception 'The quote needs a client';end if;
 select * into c from customers where id=e.customer_id;
 if not found or c.owner_id is distinct from e.owner_id then raise exception 'Quote and client ownership do not match';end if;
 select * into j from jobs where id=e.job_id or source_estimate_id=e.id limit 1;
 if found then return jsonb_build_object('job_id',j.id,'existing',true);end if;
 insert into jobs(owner_id,assigned_to,customer_id,title,address,status,scheduled_at,source_estimate_id)
 values(e.owner_id,e.owner_id,e.customer_id,coalesce(nullif(e.title,''),'Approved quote #'||e.estimate_number),concat_ws(', ',nullif(c.address,''),nullif(c.city,''),nullif(c.state,''),nullif(c.zip,'')),case when p_scheduled_at is null then 'new' else 'scheduled' end,p_scheduled_at,e.id)
 returning * into j;
 return jsonb_build_object('job_id',j.id,'existing',false);
end $$;
-- Invoker functions retain the existing table RLS/access-key checks, including for anonymous calls.
revoke all on function public.fieldops_create_quote(uuid,uuid,uuid,text,text,jsonb),public.fieldops_schedule_quote(uuid,timestamptz) from public;
grant execute on function public.fieldops_create_quote(uuid,uuid,uuid,text,text,jsonb),public.fieldops_schedule_quote(uuid,timestamptz) to anon,authenticated,service_role;

create or replace function public.fieldops_complete_job(p_job_id uuid default null,p_estimate_id uuid default null) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare j jobs; e estimates; inv invoices; rows jsonb; sub numeric; customer uuid; owner uuid;
begin
 if p_job_id is null and p_estimate_id is null then raise exception 'Choose a job or estimate'; end if;
 if p_job_id is not null then
  select * into j from jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  select * into e from estimates where (job_id=p_job_id or id=j.source_estimate_id) and status in ('approved','converted') order by approved_at desc nulls last,created_at desc limit 1 for update;
 else
  select * into e from estimates where id=p_estimate_id for update;
  if not found or e.status not in ('approved','converted') then raise exception 'Estimate must be approved first'; end if;
  if e.job_id is null then select * into j from jobs where source_estimate_id=e.id;end if;
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
 values(owner,customer,coalesce(p_job_id,e.job_id,j.id),e.id,coalesce(e.title,j.title),coalesce(e.description,j.notes),'draft',coalesce(e.subtotal,sub),coalesce(e.tax,0),coalesce(e.total,sub)) returning * into inv;
 insert into invoice_items(invoice_id,description,quantity,unit_price,line_total,sort_order)
 select inv.id,x->>'description',(x->>'quantity')::numeric,(x->>'unit_price')::numeric,(x->>'line_total')::numeric,n::int from jsonb_array_elements(rows) with ordinality as t(x,n);
 if e.id is not null then update invoices set credit_amount=coalesce((select -sum(total) from fieldops_change_orders where parent_kind='estimate' and parent_id=e.id and status='approved' and total<0),0) where id=inv.id; end if;
 if p_job_id is not null then update jobs set status='completed',updated_at=now() where id=p_job_id;end if;
 return jsonb_build_object('completed',true,'existing',false,'invoice_id',inv.id);
end $$;
revoke all on function public.fieldops_complete_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fieldops_complete_job(uuid,uuid) to service_role;

