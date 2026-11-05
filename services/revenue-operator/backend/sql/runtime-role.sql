-- Run as migration administrator. Attach your separate LOGIN user to this role
-- outside source control. Never use the migration administrator for the API.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='manager_operator_runtime') then
 create role manager_operator_runtime nologin;
 end if;
end $$;
grant usage on schema manager_operator to manager_operator_runtime;
grant select,insert,update on all tables in schema manager_operator to manager_operator_runtime;
revoke update on manager_operator.audit from manager_operator_runtime;
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='manager_operator' loop
 execute format('create policy runtime_access on manager_operator.%I to manager_operator_runtime using (true) with check (true)',t.tablename);
 end loop;
end $$;
