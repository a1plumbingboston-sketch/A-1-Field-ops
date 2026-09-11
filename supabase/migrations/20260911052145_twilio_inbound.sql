create table public.fieldops_text_messages (
 message_sid text primary key check(message_sid ~ '^SM[0-9A-Fa-f]{32}$'),
 from_number text not null, to_number text not null,
 body text not null check(length(body)<=10000),
 media jsonb not null default '[]'::jsonb,
 received_at timestamptz not null default now()
);
create index fieldops_text_messages_received on public.fieldops_text_messages(received_at desc);
alter table public.fieldops_text_messages enable row level security;
revoke all on public.fieldops_text_messages from public,anon,authenticated;
grant select,insert on public.fieldops_text_messages to service_role;
