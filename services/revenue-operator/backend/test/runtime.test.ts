import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {Store} from '../src/store.js';
import {Runtime} from '../src/runtime.js';
async function fixture(){
 const pg=new PGlite();await pg.exec(await readFile(new URL('../sql/001_manager.sql',import.meta.url),'utf8'));
 const db:any={query:(s:string,p:any[]=[])=>pg.query(s,p),transaction:(f:any)=>pg.transaction(tx=>f({query:(s:string,p:any[]=[])=>tx.query(s,p)}))};
 return {pg,store:new Store(db)};
}
test('queue persists pause, task idempotency, approval, lease recovery and dead letters',async()=>{
 const {pg,store}=await fixture();try{
 await store.setRunning(true,'owner');
 const task={key:'one',kind:'pricing',system:'marketing',payload:{},amount:0,priority:1};
 await store.enqueue(task);await store.enqueue(task);
 assert.equal((await store.tasks()).length,1);
 assert.equal((await store.claim()),null);
 const approval=(await store.approvals())[0];assert.ok(approval);
 await store.approve(approval.id,true,'owner');
 const leased=await store.claim();assert.ok(leased);
 await store.db.query("update manager_operator.tasks set lease_until=now()-interval '1 second' where id=$1",[leased.id]);
 const reclaimed=await store.claim();assert.equal(reclaimed.id,leased.id);assert.notEqual(reclaimed.lease_token,leased.lease_token);
 assert.equal(await store.complete(leased,{evidence:'late'}),false);
 await store.fail(reclaimed,'PROVIDER_UNAVAILABLE',true);
 assert.equal((await store.tasks())[0].status,'dead');
 await store.setRunning(false,'owner');assert.equal(await store.claim(),null);
 }finally{await pg.close();}
});
test('paid order is atomic, duplicate webhook cannot create a second delivery and test payment cannot count',async()=>{
 const {pg,store}=await fixture();try{
 await store.db.query(`insert into manager_operator.offers(id,name,system,price_id,unit_amount,currency,cost_amount) values('carve','Carve','education','price_carve',2900,'nzd',0)`);
 const event={id:'evt_live',livemode:true,session_id:'cs_live',payment_intent:'pi_live',customer_id:'cus_real',email:'buyer@example.net',offer_id:'carve',amount:2900,currency:'nzd',external_customer:true};
 await store.recordPayment(event);await store.recordPayment(event);
 assert.equal((await store.tasks()).length,1);
 assert.equal((await store.metrics()).currencies[0].customers,1);
 await store.recordPayment({...event,id:'evt_test',session_id:'cs_test',payment_intent:'pi_test',livemode:false});
 assert.equal((await store.tasks()).length,1);
 await store.refund('evt_refund','pi_live',2900);
 assert.equal((await store.metrics()).currencies[0].customers,0);
 }finally{await pg.close();}
});
test('runtime dispatches once, verifies remote receipt before completing and records memory',async()=>{
 const {pg,store}=await fixture();try{
 let executions=0;
 const adapter:any={execute:async(t:any)=>{executions++;return {id:t.id,status:'completed',evidence:'https://service.example/evidence/1'};},verify:async()=>true};
 const runtime=new Runtime(store,new Map([['marketing',adapter]]));
 await store.setRunning(true,'owner');await store.enqueue({key:'acquire1',kind:'acquire',system:'marketing',payload:{},amount:0,priority:1});
 await runtime.work();await runtime.work();
 assert.equal(executions,1);assert.equal((await store.tasks())[0].status,'done');
 assert.equal((await store.memory()).length,1);
 }finally{await pg.close();}
});
test('an accepted or unverifiable delivery never becomes delivered',async()=>{
 const {pg,store}=await fixture();try{
 const runtime=new Runtime(store,new Map([['education',{execute:async()=>({id:'receipt',status:'accepted',evidence:'https://service.example/r'}),verify:async()=>false} as any]]));
 await store.setRunning(true,'owner');await store.enqueue({key:'delivery',kind:'deliver',system:'education',payload:{order_id:'missing'},amount:0,priority:100});
 await runtime.work();assert.notEqual((await store.tasks())[0].status,'done');
 }finally{await pg.close();}
});
test('customer journey survives restarts: paid → onboarding → verified delivery → satisfaction',async()=>{
 const {pg,store}=await fixture();try{
 await store.db.query(`insert into manager_operator.offers(id,name,system,price_id,unit_amount,currency,cost_amount) values('course','Course','education','price_c',1000,'nzd',0)`);
 await store.recordPayment({id:'evt_journey',livemode:true,session_id:'cs_journey',payment_intent:'pi_journey',customer_id:'cus_new',email:'student@example.net',offer_id:'course',amount:1000,currency:'nzd',external_customer:true});
 const calls:string[]=[];const adapter:any={execute:async(t:any)=>{calls.push(t.kind);return {id:t.id,status:'completed',evidence:'https://service.example/'+t.id};},verify:async()=>true};
 await store.setRunning(true,'owner');
 for(let i=0;i<3;i++) await new Runtime(new Store(store.db),new Map([['email',adapter],['education',adapter]])).work();
 assert.deepEqual(calls,['onboard','deliver','satisfaction']);
 assert.equal((await store.db.query('select delivery_status from manager_operator.orders')).rows[0].delivery_status,'delivered');
 assert.equal((await store.tasks()).filter(t=>t.status==='done').length,3);
 }finally{await pg.close();}
});
test('refund arriving before payment prevents fulfillment and revenue qualification',async()=>{
 const {pg,store}=await fixture();try{
 await store.db.query(`insert into manager_operator.offers(id,name,system,price_id,unit_amount,currency,cost_amount) values('course','Course','education','price_c',1000,'nzd',0)`);
 await store.refund('evt_refund_first','pi_late',1000);
 await store.recordPayment({id:'evt_late',livemode:true,session_id:'cs_late',payment_intent:'pi_late',customer_id:'cus_new',email:'student@example.net',offer_id:'course',amount:1000,currency:'nzd',external_customer:true});
 assert.equal((await store.tasks()).length,0);
 assert.equal((await store.metrics()).currencies[0].customers,0);
 }finally{await pg.close();}
});
test('paused runtime schedules no growth and approved amount cannot authorize another task',async()=>{
 const {pg,store}=await fixture();try{
 const runtime=new Runtime(store,new Map());await runtime.plan();assert.equal((await store.tasks()).length,0);
 await store.enqueue({key:'a',kind:'deliver',system:'appforge',payload:{},amount:500,priority:1});
 await store.enqueue({key:'b',kind:'deliver',system:'appforge',payload:{},amount:500,priority:1});
 const approvals=await store.approvals();await store.approve(approvals[0].id,true,'owner');
 await store.setRunning(true,'owner');assert.ok(await store.claim());assert.equal(await store.claim(),null);
 }finally{await pg.close();}
});
test('expired approval cannot execute and audit events cannot be edited',async()=>{
 const {pg,store}=await fixture();try{
 await store.enqueue({key:'a',kind:'borrow',system:'finance',payload:{},amount:0,priority:1});
 const a=(await store.approvals())[0];await store.db.query("update manager_operator.approvals set expires_at=now()-interval '1 second'");
 await assert.rejects(()=>store.approve(a.id,true,'owner'));
 await store.audit('owner','test','mission');
 await assert.rejects(()=>store.db.query("update manager_operator.audit set action='forged'"));
 }finally{await pg.close();}
});
test('private schema and runtime role restrict customers and immutable audit data',async()=>{
 const {pg,store}=await fixture();try{
 await pg.exec(await readFile(new URL('../sql/runtime-role.sql',import.meta.url),'utf8'));
 await pg.exec('set role manager_operator_runtime');
 assert.equal((await store.db.query('select * from manager_operator.settings')).rows.length,1);
 await assert.rejects(()=>store.db.query("update manager_operator.audit set action='forged'"));
 await pg.exec('reset role; create role untrusted_client; set role untrusted_client');
 await assert.rejects(()=>store.db.query('select * from manager_operator.orders'));
 await pg.exec('reset role');
 }finally{await pg.close();}
});
test('quote retry reuses the same Stripe session without changing idempotency parameters',async()=>{
 const {pg,store}=await fixture();try{
 const {Billing}=await import('../src/billing.js');const {randomUUID}=await import('node:crypto');const lead=randomUUID();
 await store.db.query(`insert into manager_operator.offers(id,name,system,price_id,unit_amount,currency,cost_amount,ready,verified_at) values('course','Course','education','price_c',1000,'nzd',0,true,now())`);
 await store.db.query("insert into manager_operator.leads(id,email,need,source,consent) values($1,'student@example.net','Learn carving','website',false)",[lead]);
 let calls=0;const billing=new Billing(store,[]);
 billing.clients.set('primary',{config:{id:'primary',key:'unit_test_only',webhookSecret:'unit_test_only',ownerEmails:['owner@example.net']},stripe:{prices:{retrieve:async()=>({active:true,recurring:null,billing_scheme:'per_unit',unit_amount:1000,currency:'nzd',product:{active:true,deleted:false}})},checkout:{sessions:{create:async()=>{calls++;return {url:'https://checkout.stripe.com/unit-test-only',expires_at:Math.floor(Date.now()/1000)+3600};}}}} as any});
 const first=await billing.checkout(lead,'course','https://manager.example');const second=await billing.checkout(lead,'course','https://manager.example');
 assert.equal(calls,1);assert.equal(first.url,second.url);assert.equal(first.quote_id,second.quote_id);
 }finally{await pg.close();}
});
