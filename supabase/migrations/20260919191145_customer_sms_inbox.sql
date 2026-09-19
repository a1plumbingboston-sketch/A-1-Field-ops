-- Owner-managed customer service SMS. No public/employee database access.
alter table public.fieldops_text_messages drop constraint fieldops_text_messages_message_sid_check;
alter table public.fieldops_text_messages add constraint fieldops_text_messages_message_sid_check check(message_sid ~ '^(SM|MM)[0-9A-Fa-f]{32}$');
alter table public.fieldops_text_messages add column opt_out_type text
 check(opt_out_type in ('STOP','START','HELP'));
update public.fieldops_text_messages set opt_out_type=case
 when trim(body) ~* '^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)$' then 'STOP'
 when trim(body) ~* '^(start|unstop)$' then 'START'
 when trim(body) ~* '^(help|info)$' then 'HELP' end;
create index fieldops_text_messages_thread on public.fieldops_text_messages(from_number,to_number,received_at desc,message_sid desc);

create table public.fieldops_sms_threads(
 phone text primary key check(phone ~ '^\+1[0-9]{10}$'),
 last_read_at timestamptz not null default 'epoch',
 last_read_sid text not null default '',
 created_at timestamptz not null default now()
);
create table public.fieldops_sms_outbox(
 request_id uuid primary key,
 phone text not null check(phone ~ '^\+1[0-9]{10}$'),
 business_number text not null check(business_number ~ '^\+[1-9][0-9]{6,14}$'),
 body text not null check(length(trim(body)) between 1 and 1600),
 reply_to_sid text not null references public.fieldops_text_messages(message_sid),
 consent_basis text not null default 'customer_service_reply' check(consent_basis='customer_service_reply'),
 message_sid text unique check(message_sid ~ '^(SM|MM)[0-9A-Fa-f]{32}$'),
 status text not null default 'submitting' check(status in ('submitting','unconfirmed','accepted','queued','sending','sent','delivered','undelivered','failed','canceled')),
 error_code text, error_detail text, actor_hash text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index fieldops_sms_outbox_thread on public.fieldops_sms_outbox(phone,business_number,created_at desc,request_id desc);
alter table public.fieldops_sms_threads enable row level security;
alter table public.fieldops_sms_outbox enable row level security;
revoke all on public.fieldops_sms_threads,public.fieldops_sms_outbox from public,anon,authenticated;
grant select,insert,update on public.fieldops_sms_threads,public.fieldops_sms_outbox to service_role;
grant update(opt_out_type) on public.fieldops_text_messages to service_role;

create function public.fieldops_sms_customer(p_phone text) returns jsonb language sql stable security invoker set search_path=public as $$
 with matched as (
  select id,name from customers where
   case when length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))=10 then '+1'||regexp_replace(phone,'[^0-9]','','g')
    when regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ '^1[0-9]{10}$' then '+'||regexp_replace(phone,'[^0-9]','','g') end=p_phone
  limit 2
 ) select case when count(*)=1 then jsonb_agg(to_jsonb(matched))->0 else null end from matched;
$$;
create function public.fieldops_sms_state(p_phone text,p_business_number text) returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object(
  'blocked',coalesce((select opt_out_type='STOP' from fieldops_text_messages where from_number=p_phone and to_number=p_business_number and opt_out_type in ('STOP','START') order by received_at desc,message_sid desc limit 1),false),
  'reply_to_sid',(select message_sid from fieldops_text_messages where from_number=p_phone and to_number=p_business_number and opt_out_type is null and (length(trim(body))>0 or jsonb_array_length(media)>0) order by received_at desc,message_sid desc limit 1),
  'latest_inbound_sid',(select message_sid from fieldops_text_messages where from_number=p_phone and to_number=p_business_number order by received_at desc,message_sid desc limit 1)
 );
$$;
create function public.fieldops_receive_text(p_message jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare inserted integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('sms-phone:'||(p_message->>'from_number'),0));
 insert into fieldops_text_messages(message_sid,from_number,to_number,body,media,opt_out_type)
 values(p_message->>'message_sid',p_message->>'from_number',p_message->>'to_number',p_message->>'body',coalesce(p_message->'media','[]'),p_message->>'opt_out_type')
 on conflict(message_sid) do nothing;
 get diagnostics inserted=row_count;
 if p_message->>'from_number' ~ '^\+1[0-9]{10}$' then
  insert into fieldops_sms_threads(phone) values(p_message->>'from_number') on conflict do nothing;
 end if;
 return jsonb_build_object('saved',true,'duplicate',inserted=0);
end $$;

create function public.fieldops_sms_list(p_business_number text,p_before_at timestamptz default null,p_before_phone text default null)
returns jsonb language sql stable security invoker set search_path=public as $$
 with activity as (
  select from_number phone,body,received_at at,message_sid id from fieldops_text_messages where to_number=p_business_number and from_number ~ '^\+1[0-9]{10}$'
  union all select phone,body,created_at,request_id::text from fieldops_sms_outbox where business_number=p_business_number
 ), latest as (
  select distinct on(phone) phone,body,at,id from activity order by phone,at desc,id desc
 ), page as (
  select * from latest where p_before_at is null or at<p_before_at or (at=p_before_at and phone>p_before_phone)
  order by at desc,phone asc limit 51
 ) select coalesce(jsonb_agg(jsonb_build_object(
  'phone',p.phone,'preview',left(p.body,160),'last_at',p.at,'customer',fieldops_sms_customer(p.phone),
  'blocked',(fieldops_sms_state(p.phone,p_business_number)->>'blocked')::boolean,
  'unread_count',(select count(*) from fieldops_text_messages m left join fieldops_sms_threads t on t.phone=m.from_number
   where m.from_number=p.phone and m.to_number=p_business_number and (m.received_at,m.message_sid)>(coalesce(t.last_read_at,'epoch'::timestamptz),coalesce(t.last_read_sid,'')))
 ) order by p.at desc,p.phone asc),'[]') from page p;
$$;

create function public.fieldops_sms_thread(p_phone text,p_business_number text,p_before_at timestamptz default null,p_before_id text default null)
returns jsonb language sql stable security invoker set search_path=public as $$
 with messages as (
  select message_sid id,message_sid sid,null::uuid request_id,'inbound' direction,body,received_at at,'received' status,null::text error_code,null::text error,jsonb_array_length(media) media_count
   from fieldops_text_messages where from_number=p_phone and to_number=p_business_number
  union all
  select request_id::text,message_sid,request_id,'outbound',body,created_at,status,error_code,error_detail,0 from fieldops_sms_outbox where phone=p_phone and business_number=p_business_number
 ), page as (
  select * from messages where p_before_at is null or (at,id)<(p_before_at,p_before_id) order by at desc,id desc limit 51
 ) select jsonb_build_object('phone',p_phone,'customer',fieldops_sms_customer(p_phone),'state',fieldops_sms_state(p_phone,p_business_number),
   'messages',coalesce((select jsonb_agg(to_jsonb(page) order by at desc,id desc) from page),'[]'));
$$;

create function public.fieldops_sms_mark_read(p_phone text,p_business_number text,p_through_sid text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare stamp timestamptz;
begin
 select received_at into stamp from fieldops_text_messages where message_sid=p_through_sid and from_number=p_phone and to_number=p_business_number;
 if not found then raise exception 'INVALID_INPUT: viewed message is unavailable'; end if;
 insert into fieldops_sms_threads(phone,last_read_at,last_read_sid) values(p_phone,stamp,p_through_sid)
 on conflict(phone) do update set last_read_at=excluded.last_read_at,last_read_sid=excluded.last_read_sid
 where (fieldops_sms_threads.last_read_at,fieldops_sms_threads.last_read_sid)<(excluded.last_read_at,excluded.last_read_sid);
 return jsonb_build_object('saved',true);
end $$;

create function public.fieldops_sms_claim(p_request_id uuid,p_phone text,p_business_number text,p_body text,p_reply_to_sid text,p_actor_hash text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare prior fieldops_sms_outbox; state jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('sms-request:'||p_request_id::text,0));
 select * into prior from fieldops_sms_outbox where request_id=p_request_id for update;
 if found then
  if prior.phone<>p_phone or prior.business_number<>p_business_number or prior.body<>p_body or prior.reply_to_sid<>p_reply_to_sid then raise exception 'REQUEST_CONFLICT: this send request already belongs to different content'; end if;
  return jsonb_build_object('claimed',false,'message',to_jsonb(prior));
 end if;
 if p_phone !~ '^\+1[0-9]{10}$' or length(trim(p_body)) not between 1 and 1600 then raise exception 'INVALID_INPUT: choose a valid phone and reply'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sms-phone:'||p_phone,0));
 state:=fieldops_sms_state(p_phone,p_business_number);
 if (state->>'blocked')::boolean then raise exception 'OPTED_OUT: this customer has opted out; they must text START before further replies'; end if;
 if not exists(select 1 from fieldops_text_messages where message_sid=p_reply_to_sid and from_number=p_phone and to_number=p_business_number and opt_out_type is null and (length(trim(body))>0 or jsonb_array_length(media)>0)) then raise exception 'REPLY_REQUIRED: choose an incoming customer service inquiry to reply to'; end if;
 if (select count(*) from fieldops_sms_outbox where phone=p_phone and created_at>now()-interval '1 minute')>=10 then raise exception 'RATE_LIMITED: wait a minute before sending another reply'; end if;
 insert into fieldops_sms_outbox(request_id,phone,business_number,body,reply_to_sid,actor_hash) values(p_request_id,p_phone,p_business_number,p_body,p_reply_to_sid,p_actor_hash) returning * into prior;
 return jsonb_build_object('claimed',true,'message',to_jsonb(prior));
end $$;

create function public.fieldops_sms_result(p_request_id uuid,p_message_sid text,p_status text,p_error_code text default null,p_error_detail text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare row fieldops_sms_outbox; old_rank integer; new_rank integer;
begin
 select * into row from fieldops_sms_outbox where request_id=p_request_id for update;
 if not found then raise exception 'MESSAGE_NOT_FOUND: send request is unavailable'; end if;
 if p_message_sid is not null and row.message_sid is not null and p_message_sid<>row.message_sid then raise exception 'REQUEST_CONFLICT: provider message does not match the send request'; end if;
 if p_status not in ('unconfirmed','accepted','queued','sending','sent','delivered','undelivered','failed','canceled') then raise exception 'INVALID_INPUT: unsupported message status'; end if;
 old_rank:=case row.status when 'submitting' then 0 when 'unconfirmed' then 0 when 'accepted' then 1 when 'queued' then 1 when 'sending' then 2 when 'sent' then 3 when 'delivered' then 5 else 4 end;
 new_rank:=case p_status when 'unconfirmed' then 0 when 'accepted' then 1 when 'queued' then 1 when 'sending' then 2 when 'sent' then 3 when 'delivered' then 5 else 4 end;
 update fieldops_sms_outbox set message_sid=coalesce(message_sid,p_message_sid),
  status=case when new_rank>=old_rank then p_status else status end,
  error_code=case when new_rank>=old_rank then left(p_error_code,40) else error_code end,
  error_detail=case when new_rank>=old_rank then left(p_error_detail,500) else error_detail end,
  updated_at=now() where request_id=p_request_id returning * into row;
 return to_jsonb(row);
end $$;

revoke all on function public.fieldops_sms_customer(text),public.fieldops_sms_state(text,text),public.fieldops_receive_text(jsonb),public.fieldops_sms_list(text,timestamptz,text),public.fieldops_sms_thread(text,text,timestamptz,text),public.fieldops_sms_mark_read(text,text,text),public.fieldops_sms_claim(uuid,text,text,text,text,text),public.fieldops_sms_result(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.fieldops_sms_customer(text),public.fieldops_sms_state(text,text),public.fieldops_receive_text(jsonb),public.fieldops_sms_list(text,timestamptz,text),public.fieldops_sms_thread(text,text,timestamptz,text),public.fieldops_sms_mark_read(text,text,text),public.fieldops_sms_claim(uuid,text,text,text,text,text),public.fieldops_sms_result(uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
