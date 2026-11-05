import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/api.js';
import {BridgeAdapter} from '../src/adapters.js';
const config:any={allowedOrigins:['https://manager.example'],ownerIds:['owner'],supabaseUrl:'https://auth.example',supabaseKey:'public',ingressToken:'a'.repeat(40),stripeAccounts:[]};
test('owner API denies missing and non-owner identities; ingress cannot run mission',async()=>{
 const store:any={setRunning:async()=>{},metrics:async()=>({})};
 const app=createApp(config,store,new Map(),async(token:string)=>token==='owner-token'?'owner':'someone');
 assert.equal((await app.inject({method:'POST',url:'/v1/mission',payload:{running:true}})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:'/v1/mission',headers:{authorization:'Bearer other'},payload:{running:true}})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/v1/mission',headers:{authorization:'Bearer '+config.ingressToken},payload:{running:true}})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/v1/mission',headers:{authorization:'Bearer owner-token'},payload:{running:true}})).statusCode,200);
 await app.close();
});
test('bridge requires idempotency capability and independently verifies matching receipt',async()=>{
 const t:any={id:'task1',kind:'acquire',amount:0,payload:{},system:'marketing'};
 const responses=[{version:1,idempotency:true,operations:['acquire']},{id:'receipt',status:'completed',task_id:'task1',evidence:'https://marketing.example/post/1'},{id:'receipt',status:'completed',task_id:'wrong',evidence:'https://marketing.example/post/1'}];
 const adapter=new BridgeAdapter({url:'https://marketing.example',token:'secret',operations:['acquire']},async()=>new Response(JSON.stringify(responses.shift()),{status:200}));
 const r=await adapter.execute(t);assert.equal(await adapter.verify(t,r),false);
});
test('bridge denies unapproved operation before network access',async()=>{
 let calls=0;const adapter=new BridgeAdapter({url:'https://marketing.example',token:'secret',operations:['acquire']},async()=>{calls++;return new Response('{}');});
 await assert.rejects(()=>adapter.execute({id:'x',kind:'borrow',amount:0,payload:{}} as any));assert.equal(calls,0);
});
test('Stripe ingress verifies raw signature and durably deduplicates before acknowledging',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFile}=await import('node:fs/promises');const {Store}=await import('../src/store.js');const {default:Stripe}=await import('stripe');
 const pg=new PGlite();await pg.exec(await readFile(new URL('../sql/001_manager.sql',import.meta.url),'utf8'));
 const db:any={query:(s:string,p:any[]=[])=>pg.query(s,p),transaction:(f:any)=>pg.transaction(tx=>f({query:(s:string,p:any[]=[])=>tx.query(s,p)}))};
 const signing='unit_test_only';const account={id:'primary',key:'unit_test_key',webhookSecret:signing,ownerEmails:['owner@example.net']};
 const app=createApp({...config,stripeAccounts:[account]},new Store(db),new Map());
 try{
 const payload=JSON.stringify({id:'evt_unit_only',type:'customer.created',livemode:false,data:{object:{id:'cus_test'}}});
 const signature=Stripe.webhooks.generateTestHeaderString({payload,secret:signing});
 const send=(sig:string)=>app.inject({method:'POST',url:'/webhooks/stripe/primary',headers:{'content-type':'application/json','stripe-signature':sig},payload});
 assert.equal((await send('invalid')).statusCode,400);
 assert.equal((await send(signature)).statusCode,200);assert.equal((await send(signature)).statusCode,200);
 assert.equal((await db.query('select * from manager_operator.webhook_inbox')).rows.length,1);
 }finally{await app.close();await pg.close();}
});
