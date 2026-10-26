import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('PostgreSQL bootstrap is repeatable and runtime role is isolated by schema and RLS',async()=>{
 const pg=new PGlite();try {
 const sql=await readFile(new URL('../../database/bootstrap.sql',import.meta.url),'utf8');
 await pg.exec(sql);await pg.exec(sql);
 await pg.exec('CREATE ROLE manager_runtime; CREATE ROLE public_client; GRANT USAGE ON SCHEMA manager TO manager_runtime; GRANT SELECT,UPDATE ON manager.state TO manager_runtime; CREATE POLICY runtime_state ON manager.state TO manager_runtime USING (true) WITH CHECK (true);');
 await pg.exec('SET ROLE manager_runtime; BEGIN; SELECT body FROM manager.state WHERE id=1 FOR UPDATE;');
 await pg.query("UPDATE manager.state SET body=jsonb_set(body,'{running}','true') WHERE id=1");await pg.exec('COMMIT');
 const result=await pg.query<{body:any}>('SELECT body FROM manager.state WHERE id=1');assert.equal(result.rows[0].body.running,true);
 await assert.rejects(pg.exec('DELETE FROM manager.state'));
 await pg.exec('RESET ROLE; SET ROLE public_client');await assert.rejects(pg.exec('SELECT * FROM manager.state'));
 await pg.exec('RESET ROLE; CREATE ROLE untrusted_reader; GRANT USAGE ON SCHEMA manager TO untrusted_reader; GRANT SELECT ON manager.state TO untrusted_reader; SET ROLE untrusted_reader');
 assert.equal((await pg.query('SELECT * FROM manager.state')).rows.length,0);
 }finally{await pg.close();}
});
