-- Archive completed jobs without deleting financial or signed records.
alter table public.jobs add column archived_at timestamptz;
alter table public.jobs add constraint jobs_archive_completed_only check (archived_at is null or status='completed');

-- Resolve business ownership, not the number of unrelated auth logins.
create function public.fieldops_convert_lead(p_lead_id uuid,p_owner_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare lead_owner uuid; resolved_owner uuid; owner_count integer;
begin
 select owner_id into lead_owner from public.leads where id=p_lead_id for update;
 if not found then raise exception 'Lead not found'; end if;
 if lead_owner is not null and p_owner_id is not null and lead_owner<>p_owner_id then
  raise exception 'Lead belongs to a different configured owner';
 end if;
 resolved_owner:=coalesce(lead_owner,p_owner_id);
 if resolved_owner is null then
  select count(*),(array_agg(owner_id))[1] into owner_count,resolved_owner from (
   select owner_id from public.customers where owner_id is not null
   union select owner_id from public.jobs where owner_id is not null
  ) owners;
  if owner_count<>1 then raise exception 'Set the primary FieldOps owner before converting an unassigned lead'; end if;
 end if;
 return public.convert_lead_service(p_lead_id,resolved_owner);
end $$;
revoke all on function public.fieldops_convert_lead(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fieldops_convert_lead(uuid,uuid) to service_role;
notify pgrst,'reload schema';
