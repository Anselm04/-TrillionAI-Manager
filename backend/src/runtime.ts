import {plan,claim,finish,audit,defer} from './domain.ts';
import type {Store} from './store.ts';
import {execute,type Config,AdapterError} from './adapters.ts';
import {Waiting,type Env,processOutbox} from './services.ts';
import {nativeExecutor} from './native.ts';
import {commerce,incident} from './commerce.ts';
export type Executor=(task:any,config:Config)=>Promise<any>;
export async function cycle(store:Store,config:Config,run:Executor=execute){
 const task=await store.transact(s=>{plan(s);return claim(s);});if(!task)return;
 try{const result=await run(task,config);await store.transact(s=>finish(s,task.id,task.claim!,result));}
 catch(e){await store.transact(s=>{if(e instanceof Waiting)defer(s,task.id,task.claim!,e.code,e.delayMs);else finish(s,task.id,task.claim!,null,e instanceof AdapterError?e.code:'execution_failed');});}
}
export function startRuntime(store:Store,config:Config,onError:(e:unknown)=>void=()=>{},env:Env=process.env){
 let stopping=false;let timer:ReturnType<typeof setTimeout>;let pending:Promise<void>=Promise.resolve();
 const run=nativeExecutor(store,config,env);
 async function tick(){pending=(async()=>{
  await processOutbox(store,env);await cycle(store,config,run);
  await store.transact(s=>{if(!s.running)return;for(const ticket of commerce(s).tickets)if(ticket.status==='open'&&ticket.dueAt<Date.now())incident(s,`ticket:${ticket.id}`,'support_sla_breached',{ticketId:ticket.id});});
 })().catch(onError).then(()=>{if(!stopping)timer=setTimeout(tick,5000);});}
 void tick();return async()=>{stopping=true;clearTimeout(timer);await pending;await store.transact(s=>audit(s,'runtime.stopped',{}));};
}
