import { initial, type State } from './domain.ts';
import { DatabaseSync } from 'node:sqlite';
export interface Store { transact<T>(fn:(s:State)=>T):Promise<T>; close():Promise<void> }
// Development/test only. Production requires PostgreSQL. Same transaction boundary for both stores.
export class LocalStore implements Store {
 db:DatabaseSync; constructor(path=':memory:') {this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS manager_state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');this.db.prepare('INSERT OR IGNORE INTO manager_state VALUES(1,?)').run(JSON.stringify(initial()));}
 async transact<T>(fn:(s:State)=>T):Promise<T> {this.db.exec('BEGIN IMMEDIATE');try {const s=JSON.parse((this.db.prepare('SELECT body FROM manager_state WHERE id=1').get() as any).body);const result=fn(s);this.db.prepare('UPDATE manager_state SET body=? WHERE id=1').run(JSON.stringify(s));this.db.exec('COMMIT');return structuredClone(result);}catch(e){this.db.exec('ROLLBACK');throw e;}}
 async close(){this.db.close();}
}
export async function postgresStore(url:string):Promise<Store> {
 const {Pool}=await import('pg');const pool=new Pool({connectionString:url,max:5,connectionTimeoutMillis:10000,statement_timeout:15000});
 return {async transact<T>(fn:(s:State)=>T):Promise<T> {const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query('SELECT body FROM manager.state WHERE id=1 FOR UPDATE');if(!r.rows[0]) throw Error('database_not_initialized');const s=r.rows[0].body;const value=fn(s);await c.query('UPDATE manager.state SET body=$1, updated_at=now() WHERE id=1',[JSON.stringify(s)]);await c.query('COMMIT');return structuredClone(value);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},async close(){await pool.end();}};
}
