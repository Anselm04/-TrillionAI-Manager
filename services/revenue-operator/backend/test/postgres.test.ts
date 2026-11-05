import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database} from '../src/db.js';
import {Store} from '../src/store.js';
test('real PostgreSQL workers cannot claim the same task concurrently',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;
 if(new URL(url).pathname!=='/manager_test')throw new Error('Use a dedicated empty manager_test database');
 const db=database(url);try{
 await db.query(await readFile(new URL('../sql/001_manager.sql',import.meta.url),'utf8'));
 const store=new Store(db);await store.setRunning(true,'test');
 await store.enqueue({key:'concurrency',kind:'acquire',system:'marketing',payload:{},amount:0,priority:50});
 const claims=await Promise.all(Array.from({length:10},()=>store.claim()));
 assert.equal(claims.filter(Boolean).length,1);
 }finally{await db.query('drop schema if exists manager_operator cascade');await db.close();}
});
