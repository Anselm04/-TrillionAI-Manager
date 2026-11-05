import pg from 'pg';
export interface Sql {query(sql:string,params?:any[]):Promise<{rows:any[]}>}
export interface Database extends Sql {transaction<T>(fn:(tx:Sql)=>Promise<T>):Promise<T>}
export function database(url:string): Database & {close():Promise<void>} {
 const pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
 return {query:(s,p)=>pool.query(s,p),async transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()};
}
