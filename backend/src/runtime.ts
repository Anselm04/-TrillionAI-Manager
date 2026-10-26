import { plan, claim, finish, audit } from './domain.ts';
import type {Store} from './store.ts';
import {execute,type Config,AdapterError} from './adapters.ts';
export async function cycle(store:Store,config:Config,run=execute) {
 const task=await store.transact(s=>{plan(s);return claim(s);});if(!task)return;
 try {const result=await run(task,config);await store.transact(s=>finish(s,task.id,task.claim!,result));}
 catch(e) {await store.transact(s=>finish(s,task.id,task.claim!,null,e instanceof AdapterError?e.code:'execution_failed'));}
}
export function startRuntime(store:Store,config:Config,onError:(e:unknown)=>void=()=>{}) {
 let stopping=false;let timer:ReturnType<typeof setTimeout>;let pending:Promise<void>=Promise.resolve();
 function tick(){pending=cycle(store,config).catch(onError).then(()=>{if(!stopping)timer=setTimeout(tick,5000);});}
 tick();return async()=>{stopping=true;clearTimeout(timer);await pending;await store.transact(s=>audit(s,'runtime.stopped',{}));};
}
