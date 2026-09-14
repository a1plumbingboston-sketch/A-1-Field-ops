-- Audit trail for owner-key-gated actions (payments, documents, tools).
-- The office/owner key currently authorizes these actions with zero attribution:
-- anyone holding it is indistinguishable in the data. This does not change who
-- is allowed to do what — it only records who (if identifiable) did it and when.
-- If an employee access code cookie is present alongside the owner key, we
-- resolve and record that employee; otherwise the actor is labeled 'Owner'.
create table public.fieldops_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check(length(action) between 1 and 100),
  target_kind text check(target_kind is null or length(target_kind) between 1 and 100),
  target_id uuid,
  staff_id uuid references public.fieldops_staff(id),
  actor_label text not null check(length(actor_label) between 1 and 100),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.fieldops_audit_log(target_kind, target_id, created_at);
create index on public.fieldops_audit_log(created_at);
alter table public.fieldops_audit_log enable row level security;
revoke all on public.fieldops_audit_log from public, anon, authenticated;
grant select, insert on public.fieldops_audit_log to service_role;

-- Best-effort logger: callers should never let a logging failure block the
-- underlying business action. p_hash is the SHA-256 access-code digest of an
-- employee cookie, if one was present on the request; null means owner-only.
create function public.fieldops_audit(p_action text, p_target_kind text, p_target_id uuid, p_hash text default null, p_detail jsonb default '{}')
returns uuid language plpgsql security invoker set search_path=public, pg_temp as $$
declare actor fieldops_staff; label text; rid uuid;
begin
  if p_hash is not null then
    select * into actor from fieldops_staff where access_hash = p_hash and active;
  end if;
  label := coalesce(actor.name, 'Owner');
  insert into fieldops_audit_log(action, target_kind, target_id, staff_id, actor_label, detail)
  values (p_action, p_target_kind, p_target_id, actor.id, label, coalesce(p_detail, '{}'))
  returning id into rid;
  return rid;
end $$;
revoke all on function public.fieldops_audit(text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fieldops_audit(text, text, uuid, text, jsonb) to service_role;
