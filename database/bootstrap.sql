-- Apply once with a database owner. Use a dedicated runtime role with only the grants below.
BEGIN;
CREATE SCHEMA IF NOT EXISTS manager;
REVOKE ALL ON SCHEMA manager FROM PUBLIC;
CREATE TABLE IF NOT EXISTS manager.state (
 id integer PRIMARY KEY CHECK (id=1), body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON manager.state FROM PUBLIC;
ALTER TABLE manager.state ENABLE ROW LEVEL SECURITY;
INSERT INTO manager.state(id,body) VALUES(1,'{"running":false,"tasks":[],"offers":[],"leads":[],"payments":[],"events":[],"audit":[],"memory":[],"costs":[],"subscriptions":[],"observations":[]}') ON CONFLICT DO NOTHING;
-- Provision manager_runtime LOGIN with a secret outside source control, then grant:
-- GRANT USAGE ON SCHEMA manager TO manager_runtime;
-- GRANT SELECT, UPDATE ON manager.state TO manager_runtime;
-- CREATE POLICY runtime_state ON manager.state TO manager_runtime USING (true) WITH CHECK (true);
COMMIT;
