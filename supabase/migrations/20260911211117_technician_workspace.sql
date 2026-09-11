-- Single-business FieldOps workspace. Existing owner access remains unchanged.
-- Employee codes are random 256-bit secrets; only SHA-256 digests are stored.
create table public.fieldops_staff (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 email text not null check(email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'), color text not null default '#2563eb' check(color ~ '^#[0-9a-fA-F]{6}$'),
 access_hash text not null unique check(access_hash ~ '^[0-9a-f]{64}$'), active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index fieldops_staff_email_unique on public.fieldops_staff(lower(email));
create table public.fieldops_appointments (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id),
 staff_id uuid references public.fieldops_staff(id), starts_at timestamptz not null, ends_at timestamptz not null,
 instructions text not null default '', status text not null default 'confirmed'
 check(status in ('confirmed','on_way','working','review','completed','cancelled','needs_help')),
 revision integer not null default 1, created_at timestamptz not null default now(),
 check(ends_at > starts_at and ends_at <= starts_at + interval '24 hours')
);
create index on public.fieldops_appointments(staff_id,starts_at);
create index on public.fieldops_appointments(job_id);
create table public.fieldops_team_events (
 id uuid primary key, appointment_id uuid not null references public.fieldops_appointments(id),
 staff_id uuid references public.fieldops_staff(id), actor_name text not null,
 kind text not null check(kind in ('message','photo','status','schedule')),
 text text not null default '', image_data text, created_at timestamptz not null default now()
);
create index on public.fieldops_team_events(appointment_id,created_at);
alter table public.fieldops_staff enable row level security;
alter table public.fieldops_appointments enable row level security;
alter table public.fieldops_team_events enable row level security;
revoke all on public.fieldops_staff,public.fieldops_appointments,public.fieldops_team_events from public,anon,authenticated;
grant select,insert,update on public.fieldops_staff,public.fieldops_appointments to service_role;
grant select,insert on public.fieldops_team_events to service_role;

create function public.fieldops_team(p_owner boolean,p_hash text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor fieldops_staff; ap fieldops_appointments; sid uuid; aid uuid; eid uuid;
 st timestamptz; en timestamptz; result jsonb; label text; content text; image text; state text;
begin
 -- Serialize workspace writes and permission changes, including disable/reassignment.
 perform pg_advisory_xact_lock(31712001);
 if not p_owner then
  select * into actor from fieldops_staff where access_hash=p_hash and active;
  if actor.id is null then raise exception 'Authentication required'; end if;
 end if;
 label:=case when p_owner then 'Owner' else actor.name end;
 if p_action='session' then return jsonb_build_object('owner',p_owner,'name',label); end if;
 if p_action='staff_save' then
  if not p_owner then raise exception 'Not permitted'; end if;
  if coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Valid work email required'; end if;
  if exists(select 1 from fieldops_staff where lower(email)=lower(trim(p_data->>'email')) and id is distinct from (p_data->>'id')::uuid) then raise exception 'An employee already uses this email'; end if;
  if length(trim(coalesce(p_data->>'name',''))) not between 1 and 100 then raise exception 'Employee name required'; end if;
  sid:=coalesce((p_data->>'id')::uuid,gen_random_uuid());
  if p_data->>'id' is null then
   insert into fieldops_staff(id,name,email,color,access_hash) values(sid,trim(p_data->>'name'),lower(trim(left(coalesce(p_data->>'email',''),200))),p_data->>'color',p_data->>'hash');
  else
   update fieldops_staff set name=trim(p_data->>'name'),email=lower(trim(left(coalesce(p_data->>'email',''),200))),color=p_data->>'color',active=(p_data->>'active')::boolean,access_hash=coalesce(p_data->>'hash',access_hash) where id=sid;
   if not found then raise exception 'Employee not found'; end if;
  end if;
  return jsonb_build_object('id',sid);
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at),'[]') into result from (
   select a.*,j.title,c.name customer_name,coalesce(nullif(j.address,''),c.address,'') address,
    s.name technician,s.color,
    (select max(e.created_at) from fieldops_team_events e where e.appointment_id=a.id) last_update
   from fieldops_appointments a join jobs j on j.id=a.job_id left join customers c on c.id=j.customer_id
   left join fieldops_staff s on s.id=a.staff_id
   where (p_owner or (a.staff_id=actor.id and a.status<>'cancelled'))
   and a.starts_at >= (p_data->>'from')::timestamptz and a.starts_at < (p_data->>'to')::timestamptz
  ) x;
  return jsonb_build_object('owner',p_owner,'name',label,'appointments',result,
   'staff',case when p_owner then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'color',color,'active',active) order by name),'[]') from fieldops_staff) else '[]'::jsonb end,
   'jobs',case when p_owner then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title from jobs where coalesce(to_jsonb(jobs)->>'archived_at','')='' and status is distinct from 'completed' order by created_at desc limit 500) x) else '[]'::jsonb end);
 end if;
 if p_action='schedule' then
  if not p_owner then raise exception 'Not permitted'; end if;
  aid:=coalesce((p_data->>'id')::uuid,(p_data->>'create_id')::uuid,gen_random_uuid());sid:=nullif(p_data->>'staff_id','')::uuid;
  st:=(p_data->>'starts_at')::timestamptz;en:=(p_data->>'ends_at')::timestamptz;
  if p_data->>'id' is null and exists(select 1 from fieldops_appointments where id=aid) then
   if exists(select 1 from fieldops_appointments where id=aid and job_id=(p_data->>'job_id')::uuid and staff_id is not distinct from sid and starts_at=st and ends_at=en and instructions=left(coalesce(p_data->>'instructions',''),4000)) then return jsonb_build_object('id',aid,'already_saved',true); end if;
   raise exception 'Request conflict';
  end if;
  if st is null or en is null or en<=st or en>st+interval '24 hours' then raise exception 'Choose valid start and end times'; end if;
  if sid is not null and not exists(select 1 from fieldops_staff where id=sid and active) then raise exception 'Employee is inactive'; end if;
  if exists(select 1 from fieldops_appointments where id<>aid and staff_id=sid and status not in ('cancelled','completed') and starts_at<en and ends_at>st) then raise exception 'Scheduling conflict: employee already has an appointment'; end if;
  if not exists(select 1 from jobs where id=(p_data->>'job_id')::uuid and coalesce(to_jsonb(jobs)->>'archived_at','')='') then raise exception 'Job unavailable'; end if;
  if p_data->>'id' is null then
   insert into fieldops_appointments(id,job_id,staff_id,starts_at,ends_at,instructions) values(aid,(p_data->>'job_id')::uuid,sid,st,en,left(coalesce(p_data->>'instructions',''),4000));
  else
   update fieldops_appointments set staff_id=sid,starts_at=st,ends_at=en,instructions=left(coalesce(p_data->>'instructions',''),4000),revision=revision+1
   where id=aid and revision=(p_data->>'revision')::integer and job_id=(p_data->>'job_id')::uuid and status not in ('completed','cancelled');
   if not found then raise exception 'Appointment changed or closed. Refresh before editing'; end if;
  end if;
  insert into fieldops_team_events(id,appointment_id,actor_name,kind,text) values(gen_random_uuid(),aid,label,'schedule','Appointment scheduled or updated');
  return jsonb_build_object('id',aid);
 end if;
 aid:=(p_data->>'appointment_id')::uuid;
 select * into ap from fieldops_appointments where id=aid;
 if ap.id is null or (not p_owner and (ap.staff_id is distinct from actor.id or ap.status='cancelled')) then raise exception 'Not permitted'; end if;
 if p_action='photo_read' then
  return jsonb_build_object('image_data',(select image_data from fieldops_team_events where id=(p_data->>'event_id')::uuid and appointment_id=aid and kind='photo'));
 end if;
 if p_action='detail' then
  return jsonb_build_object('appointment',to_jsonb(ap),'customer',(select jsonb_build_object('name',c.name,'phone',c.phone,'address',coalesce(nullif(j.address,''),c.address,''),'title',j.title) from jobs j left join customers c on c.id=j.customer_id where j.id=ap.job_id),
  'events',(select coalesce(jsonb_agg((to_jsonb(e)-'image_data')||jsonb_build_object('has_photo',image_data is not null) order by created_at),'[]') from fieldops_team_events e where appointment_id=aid));
 end if;
 if p_action not in ('message','photo','status') then raise exception 'Unknown action'; end if;
 eid:=(p_data->>'request_id')::uuid;
 if eid is null then raise exception 'Request ID required'; end if;
 if exists(select 1 from fieldops_team_events where id=eid) then
  if not exists(select 1 from fieldops_team_events where id=eid and appointment_id=aid and staff_id is not distinct from actor.id and kind=p_action) then raise exception 'Request conflict'; end if;
  return jsonb_build_object('saved',true,'already_saved',true);
 end if;
 if ap.status in ('completed','cancelled') then raise exception 'Appointment is closed'; end if;
 content:=trim(coalesce(p_data->>'text',''));image:=p_data->>'image_data';
 if length(content)>4000 then raise exception 'Keep updates under 4000 characters'; end if;
 if p_action='message' and content='' then raise exception 'Write a message first'; end if;
 if p_action='photo' and (image is null or length(image)>1800000 or image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then raise exception 'Choose a JPEG photo under 1.3 MB'; end if;
 if p_action='status' then
  state:=p_data->>'status';
  if not (state=any(case when p_owner then array['confirmed','on_way','working','review','completed','cancelled','needs_help'] else array['on_way','working','review','needs_help'] end)) or state is null then raise exception 'Not permitted'; end if;
  if state='review' and content='' then raise exception 'Describe completed work and any unresolved issues'; end if;
  if not p_owner and ap.status='review' then raise exception 'Awaiting owner review'; end if;
  if not p_owner and not ((state='on_way' and ap.status='confirmed') or (state='working' and ap.status in ('confirmed','on_way','needs_help')) or (state in ('review','needs_help') and ap.status in ('confirmed','on_way','working','needs_help'))) then raise exception 'Invalid status change'; end if;
  update fieldops_appointments set status=state,revision=revision+1 where id=aid;
  content:=state||case when content='' then '' else ': '||content end;
 end if;
 insert into fieldops_team_events(id,appointment_id,staff_id,actor_name,kind,text,image_data) values(eid,aid,actor.id,label,p_action,content,case when p_action='photo' then image else null end);
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.fieldops_team(boolean,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fieldops_team(boolean,text,text,jsonb) to service_role;
