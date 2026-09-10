CREATE OR REPLACE FUNCTION public.convert_lead_service(p_lead_id uuid, p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_lead public.leads%rowtype;
  v_customer_id uuid;
  v_job_id uuid;
begin
  if p_owner_id is null then raise exception 'Owner required'; end if;
  if not exists (select 1 from auth.users where id = p_owner_id) then raise exception 'Configured owner not found'; end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and (owner_id = p_owner_id or owner_id is null)
  for update;

  if not found then raise exception 'Lead not found'; end if;

  if v_lead.customer_id is not null and v_lead.job_id is not null then
    return jsonb_build_object('customer_id',v_lead.customer_id,'job_id',v_lead.job_id,'already_converted',true);
  end if;

  insert into public.customers(owner_id,name,phone,email,address,city,state,zip,notes)
  values(
    p_owner_id,v_lead.name,v_lead.phone,v_lead.email,v_lead.address,v_lead.city,coalesce(v_lead.state,'MA'),v_lead.zip,
    concat_ws(E'\n','Created from lead: '||v_lead.source, nullif(v_lead.message,''))
  ) returning id into v_customer_id;

  insert into public.jobs(owner_id,assigned_to,customer_id,title,service_type,status,address,notes)
  values(
    p_owner_id,p_owner_id,v_customer_id,coalesce(nullif(v_lead.service_type,''),'Service Call'),v_lead.service_type,'new',
    concat_ws(', ',nullif(v_lead.address,''),nullif(v_lead.city,''),nullif(v_lead.state,''),nullif(v_lead.zip,'')),v_lead.message
  ) returning id into v_job_id;

  update public.leads
  set owner_id=p_owner_id,customer_id=v_customer_id,job_id=v_job_id,status='won',converted_at=now(),updated_at=now()
  where id=p_lead_id;

  return jsonb_build_object('customer_id',v_customer_id,'job_id',v_job_id,'already_converted',false);
end;
$function$

