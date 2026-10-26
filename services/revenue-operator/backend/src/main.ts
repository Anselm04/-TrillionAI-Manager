import {setTimeout as delay} from 'node:timers/promises';
import {database} from './db.js';
import {loadConfig} from './config.js';
import {Store} from './store.js';
import {Runtime} from './runtime.js';
import {BridgeAdapter} from './adapters.js';
import {Billing} from './billing.js';
import {processInbox} from './inbox.js';
import {discover} from './inventory.js';
import {createApp} from './api.js';
const config=loadConfig(),db=database(config.databaseUrl),store=new Store(db);
const billing=new Billing(store,config.stripeAccounts);
const adapters=new Map(Object.entries(config.bridges).map(([system,c])=>[system,new BridgeAdapter(c,fetch,store,(lead,offer)=>billing.checkout(lead,offer,config.allowedOrigins[0]!))]));
const runtime=new Runtime(store,adapters,o=>billing.validateOffer(o));
const app=createApp(config,store,adapters,undefined,billing);
await db.query('select id from manager_operator.settings'); // fail startup before listening if unmigrated
await app.listen({port:config.port,host:'0.0.0.0'});
let stopping=false,lastPlan=0,lastDiscovery=0;
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{stopping=true;});
while(!stopping){
 try{
 // Billing continues while autonomous actions are paused: never lose a paid order.
 await processInbox(store,billing);
 if(Date.now()-lastDiscovery>=21600000){await discover(store,billing,config.sources);lastDiscovery=Date.now();}
 if(Date.now()-lastPlan>=60000){await runtime.plan();lastPlan=Date.now();}
 await runtime.work();
 await db.query("insert into manager_operator.heartbeats(id) values('worker') on conflict(id) do update set at=now()");
 }catch{console.error(JSON.stringify({event:'runtime_cycle_failed',at:new Date().toISOString()}));}
 if(!stopping)await delay(1000);
}
await app.close();await db.close();
