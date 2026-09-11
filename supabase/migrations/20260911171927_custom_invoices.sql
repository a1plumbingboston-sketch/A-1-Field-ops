alter table public.invoices add column if not exists custom_request_hash text;
create or replace function public.fieldops_create_invoice(p_id uuid,p_customer_id uuid,p_title text,p_description text,p_items jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c customers; existing invoices; fingerprint text;
begin
 if p_id is null or p_customer_id is null or nullif(btrim(p_title),'') is null then raise exception 'Choose a customer and enter a title';end if;
 fingerprint:=md5(jsonb_build_object('customer',p_customer_id,'title',p_title,'description',p_description,'items',p_items)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from invoices where id=p_id;
 if found then
  if existing.custom_request_hash is distinct from fingerprint then raise exception 'Request already used for a different invoice';end if;
  return jsonb_build_object('id',p_id,'existing',true);
 end if;
 select * into c from customers where id=p_customer_id;
 if not found or c.owner_id is null then raise exception 'Customer not found or owner is missing';end if;
 insert into invoices(id,owner_id,customer_id,title,description,status,subtotal,tax,total,custom_request_hash) values(p_id,c.owner_id,p_customer_id,p_title,p_description,'draft',0,0,0,fingerprint);
 perform fieldops_edit_document('invoice',p_id,p_title,p_description,p_items);
 return jsonb_build_object('id',p_id,'existing',false);
end $$;
revoke all on function public.fieldops_create_invoice(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fieldops_create_invoice(uuid,uuid,text,text,jsonb) to service_role;
