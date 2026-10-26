import {readFile} from 'node:fs/promises';
import {database} from './db.js';
export async function migrate(url:string){
 const db=database(url);try{await db.transaction(async tx=>{
 await tx.query('select pg_advisory_xact_lock(74218001)');
 await tx.query('create table if not exists public.manager_operator_migrations(version integer primary key,applied_at timestamptz not null default now())');
 await tx.query('revoke all on public.manager_operator_migrations from public');
 await tx.query('alter table public.manager_operator_migrations enable row level security');
 if(!(await tx.query('select version from public.manager_operator_migrations where version=1')).rows.length){
 await tx.query(await readFile(new URL('../sql/001_manager.sql',import.meta.url),'utf8'));
 await tx.query('insert into public.manager_operator_migrations(version) values(1)');
 }
 });}finally{await db.close();}
}
if(process.argv[1]?.endsWith('migrate.ts')||process.argv[1]?.endsWith('migrate.js')){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');await migrate(process.env.DATABASE_URL);console.log('Manager migration applied.');
}
