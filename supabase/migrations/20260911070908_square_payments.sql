-- Refunds use negative ledger entries; ordinary payments must remain positive.
alter table public.payments drop constraint if exists payments_amount_check;
alter table public.payments add constraint payments_amount_check check(amount>0 or (amount<0 and method='square_refund'));
-- Private payment links and retry-safe attempts. Card details never reach FieldOps.
create table public.fieldops_square_checkouts (
 id uuid primary key default gen_random_uuid(), token text unique not null,
 invoice_id uuid not null references public.invoices(id), amount numeric(12,2) not null check(amount>0),
 status text not null default 'open' check(status in ('open','processing','paid','failed')),
 source_id text, payment_id text unique, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days'
);
alter table public.fieldops_square_checkouts enable row level security;
revoke all on public.fieldops_square_checkouts from public,anon,authenticated;
grant select,insert,update on public.fieldops_square_checkouts to service_role;
create table public.fieldops_square_events (
 provider_id text primary key, checkout_id uuid not null references public.fieldops_square_checkouts(id),
 amount numeric not null, created_at timestamptz not null default now()
);
alter table public.fieldops_square_events enable row level security;
revoke all on public.fieldops_square_events from public,anon,authenticated;
grant select,insert on public.fieldops_square_events to service_role;
create function public.fieldops_square_begin(p_token text,p_source text) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare c fieldops_square_checkouts; inv invoices; paid numeric;
begin
 select * into c from fieldops_square_checkouts where token=p_token;
 if not found then raise exception 'Payment link not found'; end if;
 select * into inv from invoices where id=c.invoice_id for update;
 select * into c from fieldops_square_checkouts where token=p_token for update;
 if c.status in ('processing','paid') then return to_jsonb(c); end if;
 if c.status<>'open' or c.expires_at<now() then raise exception 'Payment link expired; request a new link'; end if;
 if exists(select 1 from fieldops_square_checkouts where invoice_id=c.invoice_id and status='processing') then raise exception 'A payment is pending'; end if;
 select coalesce(sum(amount),0) into paid from payments where invoice_id=c.invoice_id and status in ('succeeded','completed','paid');
 if inv.status='void' or c.amount>inv.total-coalesce(inv.credit_amount,0)-paid then raise exception 'Invoice balance changed; request a new link'; end if;
 if length(p_source)<5 or length(p_source)>500 then raise exception 'Invalid payment token'; end if;
 update fieldops_square_checkouts set status='processing',source_id=p_source where id=c.id returning * into c;
 return to_jsonb(c);
end $$;
create function public.fieldops_square_record(p_checkout uuid,p_payment text,p_event text,p_amount numeric) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare c fieldops_square_checkouts; paid numeric; inv invoices;
begin
 select * into c from fieldops_square_checkouts where id=p_checkout;
 if not found then raise exception 'Payment link not found'; end if;
 select * into inv from invoices where id=c.invoice_id for update;
 select * into c from fieldops_square_checkouts where id=p_checkout for update;
 if c.payment_id is not null and c.payment_id<>p_payment then raise exception 'Payment identity conflict'; end if;
 if p_amount=0 or p_amount<>round(p_amount,2) then raise exception 'Invalid payment amount'; end if;
 if exists(select 1 from fieldops_square_events where provider_id=p_event) then return jsonb_build_object('recorded',true); end if;
 if p_amount>0 and (p_amount<>c.amount or c.status not in ('processing','paid')) then raise exception 'Payment amount conflict'; end if;
 if p_amount<0 and (c.status<>'paid' or -p_amount>(select coalesce(sum(amount),0) from fieldops_square_events where checkout_id=c.id)) then raise exception 'Refund pending payment reconciliation'; end if;
 insert into fieldops_square_events(provider_id,checkout_id,amount) values(p_event,c.id,p_amount);
 insert into payments(invoice_id,amount,method,status,request_id) values(c.invoice_id,p_amount,case when p_amount>0 then 'square' else 'square_refund' end,'succeeded',gen_random_uuid());
 update fieldops_square_checkouts set status='paid',payment_id=p_payment,source_id=null where id=c.id;
 select coalesce(sum(amount),0) into paid from payments where invoice_id=c.invoice_id and status in ('succeeded','completed','paid');
 update invoices set amount_paid=paid,status=case when paid+coalesce(credit_amount,0)>=total then 'paid' when paid>0 then 'partial' else 'sent' end,paid_at=case when paid+coalesce(credit_amount,0)>=total then now() else null end,updated_at=now() where id=c.invoice_id;
 return jsonb_build_object('recorded',true,'balance',inv.total-coalesce(inv.credit_amount,0)-paid);
end $$;
-- Prevent offline payments or price edits racing an in-flight card charge.
create function public.fieldops_square_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_table_name='payments' then
 perform 1 from invoices where id=new.invoice_id for update;
 if new.method not in ('square','square_refund') and exists(select 1 from fieldops_square_checkouts where invoice_id=new.invoice_id and status='processing') then raise exception 'Square payment pending; refresh before recording another payment'; end if;
 else
 if (new.total is distinct from old.total or new.credit_amount is distinct from old.credit_amount or new.status='void') and exists(select 1 from fieldops_square_checkouts where invoice_id=old.id and status='processing') then raise exception 'Square payment pending; cannot change invoice yet'; end if;
 end if;
 return new;
end $$;
create trigger square_payment_guard before insert on public.payments for each row execute function public.fieldops_square_guard();
create trigger square_invoice_guard before update on public.invoices for each row execute function public.fieldops_square_guard();
revoke all on function public.fieldops_square_begin(text,text),public.fieldops_square_record(uuid,text,text,numeric),public.fieldops_square_guard() from public,anon,authenticated;
grant execute on function public.fieldops_square_begin(text,text),public.fieldops_square_record(uuid,text,text,numeric) to service_role;
