-- Keep the complete internal estimator workspace while preserving approved documents.
alter table public.estimates add column estimator_context jsonb;
alter table public.fieldops_change_orders add column estimator_context jsonb;
alter table public.estimates add constraint estimates_estimator_context_object check(estimator_context is null or (jsonb_typeof(estimator_context)='object' and octet_length(estimator_context::text)<=100000));
alter table public.fieldops_change_orders add constraint changes_estimator_context_object check(estimator_context is null or (jsonb_typeof(estimator_context)='object' and octet_length(estimator_context::text)<=100000));
create table public.fieldops_estimate_saves(
 request_id uuid primary key, estimate_id uuid not null references public.estimates(id),
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table public.fieldops_estimate_saves enable row level security;
revoke all on public.fieldops_estimate_saves from public,anon,authenticated;
grant select,insert on public.fieldops_estimate_saves to service_role;

create function public.fieldops_load_estimate_editor(p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare e estimates; co fieldops_change_orders; document jsonb; rows jsonb; changes jsonb; signatures jsonb; context jsonb; revision text; locked boolean; pending uuid; current_total numeric;
begin
 select * into e from estimates where id=p_id for share;
 if not found then raise exception 'Estimate not found'; end if;
 perform 1 from fieldops_change_orders where parent_kind='estimate' and parent_id=p_id order by id for share;
 select coalesce(jsonb_agg(to_jsonb(i) order by sort_order,id),'[]'::jsonb) into rows from estimate_items i where estimate_id=p_id;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at,c.id),'[]'::jsonb) into changes from fieldops_change_orders c where parent_kind='estimate' and parent_id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'signed_at',d.signed_at) order by d.id),'[]'::jsonb) into signatures from fieldops_documents d where d.kind='estimate' and d.source_id=p_id and signed_at is not null;
 revision:=md5(jsonb_build_object('estimate',to_jsonb(e),'items',rows,'changes',changes,'signatures',signatures)::text);
 locked:=e.status in ('approved','converted') or e.approved_at is not null or jsonb_array_length(signatures)>0;
 select id into pending from fieldops_change_orders where parent_kind='estimate' and parent_id=p_id and status='draft' order by created_at desc,id desc limit 1;
 document:=to_jsonb(e)-array['estimator_context','create_request_payload'];context:=e.estimator_context;
 select * into co from fieldops_change_orders where parent_kind='estimate' and parent_id=p_id and status='approved' order by created_at desc,id desc limit 1;
 if found then
  current_total:=coalesce(e.total,0)+coalesce((select sum(c.total) from fieldops_change_orders c where c.parent_kind='estimate' and c.parent_id=p_id and c.status='approved'),0);
  rows:=co.items;context:=co.estimator_context;
  document:=document||jsonb_build_object('title',co.title,'description',co.description,'subtotal',current_total-coalesce(e.tax,0),'total',current_total);
 end if;
 return jsonb_build_object('doc',document,'items',rows,'estimator_context',context,'context_available',context is not null,'revision',revision,'locked',locked,'pending_change_order_id',pending);
end $$;
revoke all on function public.fieldops_load_estimate_editor(uuid) from public,anon,authenticated;
grant execute on function public.fieldops_load_estimate_editor(uuid) to service_role;

create function public.fieldops_save_estimate_editor(
 p_estimate_id uuid,p_request_id uuid,p_expected_revision text,p_customer_id uuid,p_job_id uuid,p_title text,p_description text,p_notes text,p_items jsonb,p_estimator_context jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
<<save>>
declare e estimates; c customers; j jobs; co fieldops_change_orders; previous fieldops_estimate_saves; loaded jsonb; payload jsonb; result jsonb; item jsonb; qty numeric; price numeric; subtotal numeric:=0; total numeric; base numeric; created jsonb; id uuid;
begin
 if p_request_id is null or p_customer_id is null or nullif(btrim(p_title),'') is null or length(p_title)>300 or length(coalesce(p_description,''))>20000 or length(coalesce(p_notes,''))>12000 then raise exception 'Choose a client and enter a valid quote title and scope'; end if;
 if jsonb_typeof(p_estimator_context) is distinct from 'object' or p_estimator_context->>'version' is distinct from '1' or jsonb_typeof(p_estimator_context->'fields') is distinct from 'object' or octet_length(p_estimator_context::text)>100000 then raise exception 'Invalid estimator context'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Enter 1–100 valid line items'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number' or nullif(btrim(item->>'description'),'') is null or length(item->>'description')>500 then raise exception 'Invalid line item'; end if;
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  if qty<=0 or qty>1000000 or abs(price)>1000000000 or abs(qty*price)>1000000000 or (price<0 and (item->>'description'<>'Discount' or qty<>1)) then raise exception 'Invalid line item'; end if;
  subtotal:=subtotal+round(qty*price,2);
 end loop;
 if subtotal<0 then raise exception 'Discount exceeds subtotal';end if;
 if subtotal>1000000000 then raise exception 'Quote total is too large';end if;
 payload:=jsonb_build_object('estimate_id',p_estimate_id,'customer_id',p_customer_id,'job_id',p_job_id,'title',btrim(p_title),'description',coalesce(p_description,''),'notes',p_notes,'items',p_items,'estimator_context',p_estimator_context,'expected_revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('fieldops-estimate-editor:'||p_request_id::text,0));
 select * into previous from fieldops_estimate_saves where request_id=p_request_id;
 if found then
  if previous.payload is distinct from payload then raise exception 'This request already saved different details. Reopen the saved quote before trying a different save';end if;
  return previous.result||jsonb_build_object('existing',true);
 end if;
 select * into c from customers where customers.id=p_customer_id for share;
 if not found or c.owner_id is null then raise exception 'Client not found or owner is missing';end if;
 -- Complete Job locks job before estimate. Match that order to avoid a save/complete deadlock.
 if p_estimate_id is not null then select * into e from estimates where estimates.id=p_estimate_id;end if;
 perform 1 from jobs where jobs.id=p_job_id or jobs.id=e.job_id order by jobs.id for share;
 if p_estimate_id is not null then
  select * into e from estimates where estimates.id=p_estimate_id for update;
  if not found then raise exception 'Estimate not found';end if;
  if e.owner_id is not null and e.owner_id is distinct from c.owner_id then raise exception 'Choose a customer belonging to the same business';end if;
  loaded:=fieldops_load_estimate_editor(e.id);
  if p_expected_revision is null or p_expected_revision is distinct from loaded->>'revision' then raise exception 'This quote changed on another device or was approved. Reopen it before saving your changes';end if;
  if loaded->>'pending_change_order_id' is not null then raise exception 'A pending change order already exists. Review or cancel it before editing again';end if;
  if (loaded->>'locked')::boolean and (p_customer_id is distinct from e.customer_id or p_job_id is distinct from e.job_id) then raise exception 'Approved or signed quote: customer and job cannot be reassigned. Save as new quote instead';end if;
 end if;
 if p_job_id is not null then
  select * into j from jobs where jobs.id=p_job_id and customer_id=p_customer_id for share;
  if not found or j.owner_id is distinct from c.owner_id then raise exception 'Choose a job belonging to this customer';end if;
  if (p_estimate_id is null or p_job_id is distinct from e.job_id) and (j.status in ('completed','cancelled') or j.archived_at is not null) then raise exception 'Choose an active job belonging to this client, or leave Job blank';end if;
 end if;
 if p_estimate_id is null then
  created:=fieldops_create_quote(p_request_id,p_customer_id,p_job_id,btrim(p_title),coalesce(p_description,''),p_items);id:=(created->>'id')::uuid;
  update estimates set estimator_context=p_estimator_context,notes=coalesce(p_notes,notes),updated_at=now() where estimates.id=save.id;
  loaded:=fieldops_load_estimate_editor(id);
  result:=jsonb_build_object('id',id,'created',true,'updated',false,'existing',false,'total',subtotal,'revision',loaded->>'revision');
 else
  id:=e.id;total:=subtotal+coalesce(e.tax,0);
  if total<0 or total>1000000000 then raise exception 'Quote total is too large';end if;
  if (loaded->>'locked')::boolean then
   if p_notes is not null and p_notes is distinct from coalesce(e.notes,'') then raise exception 'Approved quote notes are preserved. Put revised customer scope in the description or Save as new quote';end if;
   base:=(loaded->'doc'->>'total')::numeric;
   insert into fieldops_change_orders(parent_kind,parent_id,customer_id,job_id,base_total,total,title,description,items,estimator_context)
   values('estimate',id,e.customer_id,e.job_id,base,total-base,btrim(p_title),coalesce(p_description,''),p_items,p_estimator_context) returning * into co;
   result:=jsonb_build_object('id',id,'created',false,'updated',false,'existing',false,'change_order_id',co.id,'total',co.total,'base_total',base,'revised_total',total);
  else
   delete from estimate_items where estimate_id=save.id;
   insert into estimate_items(estimate_id,description,quantity,unit_price,line_total,sort_order)
   select id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,round((x->>'quantity')::numeric*(x->>'unit_price')::numeric,2),n::int from jsonb_array_elements(p_items) with ordinality as t(x,n);
   update estimates set customer_id=p_customer_id,job_id=p_job_id,title=btrim(p_title),description=coalesce(p_description,''),notes=coalesce(p_notes,e.notes),subtotal=save.subtotal,total=save.total,estimator_context=p_estimator_context,updated_at=now() where estimates.id=save.id;
   result:=jsonb_build_object('id',id,'created',false,'updated',true,'existing',false,'total',total);
  end if;
  loaded:=fieldops_load_estimate_editor(id);result:=result||jsonb_build_object('revision',loaded->>'revision');
 end if;
 insert into fieldops_estimate_saves(request_id,estimate_id,payload,result) values(p_request_id,id,payload,result);
 return result;
end $$;
revoke all on function public.fieldops_save_estimate_editor(uuid,uuid,text,uuid,uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fieldops_save_estimate_editor(uuid,uuid,text,uuid,uuid,text,text,text,jsonb,jsonb) to service_role;

create or replace function public.fieldops_document_data(p_kind text,p_id uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$
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
 -- Internal intake and request journals never enter customer snapshots or links.
 d:=d-array['estimator_context','create_request_payload'];
 return jsonb_build_object('kind',p_kind,'doc',d,'customer',coalesce(c,'{}'),'job',coalesce(j,'{}'),'items',its,'payments',pays);
end $$;

notify pgrst,'reload schema';
