create schema if not exists manager_operator;
revoke all on schema manager_operator from public;
create table manager_operator.settings(id boolean primary key default true check(id),running boolean not null default false,updated_at timestamptz not null default now());
insert into manager_operator.settings(id) values(true);
create table manager_operator.offers(
 id text primary key,name text not null,system text not null,description text not null default '',
 stripe_account text not null default 'primary',price_id text not null,unit_amount integer not null check(unit_amount>0),currency text not null check(currency ~ '^[a-z]{3}$'),
 cost_amount integer not null check(cost_amount>=0),ready boolean not null default false,verified_at timestamptz,evidence jsonb,
 checkout_url text,demand integer not null default 0 check(demand>=0),active boolean not null default true,unique(stripe_account,price_id)
);
create table manager_operator.tasks(
 id uuid primary key,idem_key text unique not null,kind text not null,system text not null,payload jsonb not null,
 amount integer not null check(amount>=0),priority integer not null,status text not null check(status in ('queued','approval','running','retry','done','dead','rejected')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
 result jsonb,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index tasks_claim on manager_operator.tasks(status,available_at,priority desc);
create table manager_operator.approvals(id uuid primary key,task_id uuid unique not null references manager_operator.tasks(id),decision boolean,decided_by text,expires_at timestamptz not null default now()+interval '24 hours',created_at timestamptz not null default now());
create table manager_operator.events(id text primary key,type text not null,created_at timestamptz not null default now());
create table manager_operator.orders(
 id text primary key,payment_intent text unique,customer_id text not null,email text not null,offer_id text not null references manager_operator.offers(id),
 amount integer not null check(amount>0),currency text not null,livemode boolean not null,external_customer boolean not null,
 refunded integer not null default 0,delivery_status text not null default 'paid',satisfaction integer check(satisfaction between 1 and 5),
 created_at timestamptz not null default now()
);
create table manager_operator.payment_locks(payment_intent text primary key);
create table manager_operator.refunds(payment_intent text primary key,amount integer not null check(amount>=0));
create table manager_operator.subscriptions(id text primary key,customer_id text not null,currency text not null,monthly_amount numeric not null check(monthly_amount>=0),status text not null,livemode boolean not null,event_created bigint not null);
create table manager_operator.leads(id uuid primary key,email text not null,need text not null,source text not null,consent boolean not null,offer_id text references manager_operator.offers(id),status text not null default 'new',created_at timestamptz not null default now());
create table manager_operator.quotes(id uuid primary key,lead_id uuid not null references manager_operator.leads(id),offer_id text not null references manager_operator.offers(id),period bigint not null,url text,expires_at timestamptz,unique(lead_id,offer_id,period));
create table manager_operator.support(id uuid primary key,order_id text references manager_operator.orders(id),subject text not null,status text not null default 'open',created_at timestamptz not null default now());
create table manager_operator.costs(id text primary key,currency text not null,amount integer not null check(amount>=0),category text not null check(category in ('marketing','delivery','operations')),created_at timestamptz not null default now());
create table manager_operator.observations(id uuid primary key,task_id uuid references manager_operator.tasks(id),kind text not null,data jsonb not null,created_at timestamptz not null default now());
create table manager_operator.audit(id uuid primary key,actor text not null,action text not null,subject text not null,data jsonb not null default '{}',created_at timestamptz not null default now());
create table manager_operator.analytics(id text primary key,kind text not null check(kind in ('visit','enquiry')),source text not null,created_at timestamptz not null default now());
create table manager_operator.heartbeats(id text primary key,at timestamptz not null default now());
-- Private schema, no Data API grants or customer policies. Only backend DB role may access.
-- Enable RLS as additional protection if the schema is exposed accidentally.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='manager_operator' loop
 execute format('alter table manager_operator.%I enable row level security',t.tablename);
 execute format('revoke all on manager_operator.%I from public',t.tablename);
 end loop;
end $$;
-- Audit trail is append-only for normal SQL users (DB owner can still alter schema).
create function manager_operator.prevent_audit_change() returns trigger language plpgsql as $$ begin raise exception 'audit is append-only'; end $$;
create trigger audit_append_only before update or delete on manager_operator.audit for each row execute function manager_operator.prevent_audit_change();
revoke all on function manager_operator.prevent_audit_change() from public;
create table manager_operator.webhook_inbox(id text primary key,account text not null,body text not null,signature text not null,status text not null default 'pending',attempts integer not null default 0,available_at timestamptz not null default now(),last_error text,created_at timestamptz not null default now());
alter table manager_operator.webhook_inbox enable row level security;
revoke all on manager_operator.webhook_inbox from public;
