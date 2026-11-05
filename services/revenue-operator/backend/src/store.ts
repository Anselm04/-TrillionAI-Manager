import {randomUUID} from 'node:crypto';
import type {Database,Sql} from './db.js';
import {approvalRequired} from './policy.js';
export interface NewTask {key:string;kind:string;system:string;payload:Record<string,unknown>;amount:number;priority:number}
export interface Task {id:string;kind:string;system:string;payload:Record<string,any>;amount:number;attempts:number;lease_token:string;[key:string]:any}
export class Store {
 constructor(public db:Database,public spendingLimit=0){}
 async audit(actor:string,action:string,subject:string,data:unknown={},tx:Sql=this.db){await tx.query('insert into manager_operator.audit(id,actor,action,subject,data) values($1,$2,$3,$4,$5)',[randomUUID(),actor,action,subject,JSON.stringify(data)]);}
 async setRunning(running:boolean,actor:string){await this.db.transaction(async tx=>{await tx.query('update manager_operator.settings set running=$1,updated_at=now()',[running]);await this.audit(actor,running?'run':'pause','mission',{},tx);});}
 async enqueue(t:NewTask,tx:Sql=this.db){
 const approval=approvalRequired(t.kind,t.amount,this.spendingLimit),id=randomUUID();
 const r=await tx.query(`insert into manager_operator.tasks(id,idem_key,kind,system,payload,amount,priority,status) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(idem_key) do nothing returning id`,[id,t.key,t.kind,t.system,JSON.stringify(t.payload),t.amount,t.priority,approval?'approval':'queued']);
 if(r.rows.length && approval) await tx.query('insert into manager_operator.approvals(id,task_id) values($1,$2)',[randomUUID(),id]);
 return r.rows[0]?.id;
 }
 async claim():Promise<Task|null>{return this.db.transaction(async tx=>{
 await tx.query(`update manager_operator.tasks set status='dead',last_error='LEASE_EXHAUSTED' where status='running' and lease_until<now() and attempts>=5`);
 const r=await tx.query(`with candidate as (
 select t.id from manager_operator.tasks t where (select running from manager_operator.settings where id=true)
 and ((t.status in ('queued','retry') and t.available_at<=now()) or (t.status='running' and t.lease_until<now()))
 and t.attempts<5 order by t.priority desc,t.created_at for update skip locked limit 1)
 update manager_operator.tasks t set status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '2 minutes',updated_at=now()
 from candidate c where t.id=c.id returning t.*`,[randomUUID()]);return r.rows[0]??null;
 });}
 async approvals(){return (await this.db.query(`select a.*,t.kind,t.system,t.amount,t.payload from manager_operator.approvals a join manager_operator.tasks t on t.id=a.task_id where a.decision is null order by a.created_at`)).rows;}
 async approve(id:string,decision:boolean,actor:string){return this.db.transaction(async tx=>{
 const r=await tx.query('update manager_operator.approvals set decision=$2,decided_by=$3 where id=$1 and decision is null and expires_at>now() returning task_id',[id,decision,actor]);
 if(!r.rows[0]) throw new Error('APPROVAL_UNAVAILABLE');
 await tx.query('update manager_operator.tasks set status=$2 where id=$1 and status=\'approval\'',[r.rows[0].task_id,decision?'queued':'rejected']);await this.audit(actor,'approval',id,{decision},tx);
 });}
 async complete(t:Task,result:any){return this.db.transaction(async tx=>{
 const r=await tx.query(`update manager_operator.tasks set status='done',result=$3,lease_until=null,updated_at=now() where id=$1 and lease_token=$2 and status='running' returning id`,[t.id,t.lease_token,JSON.stringify(result)]);
 if(!r.rows.length) return false;
 await tx.query('insert into manager_operator.observations(id,task_id,kind,data) values($1,$2,$3,$4)',[randomUUID(),t.id,t.kind,JSON.stringify(result)]);
 await this.audit('runtime','task_completed',t.id,{},tx);
 if(t.kind==='check_offer' && t.payload.offer_id){
 await tx.query('update manager_operator.offers set ready=true,verified_at=now(),evidence=$2 where id=$1',[t.payload.offer_id,JSON.stringify(result)]);
 }
 if(t.kind==='onboard' && t.payload.order_id){
 const order=(await tx.query('select o.*,f.system,f.cost_amount from manager_operator.orders o join manager_operator.offers f on f.id=o.offer_id where o.id=$1 and o.refunded=0',[t.payload.order_id])).rows[0];
 if(order)await this.enqueue({key:`deliver:${order.id}`,kind:'deliver',system:order.system,payload:{order_id:order.id,offer_id:order.offer_id},amount:order.cost_amount,priority:100},tx);
 }
 if(t.kind==='deliver' && t.payload.order_id){
 const order=await tx.query(`update manager_operator.orders set delivery_status='delivered' where id=$1 and refunded=0 returning id`,[t.payload.order_id]);
 if(order.rows.length) await this.enqueue({key:`satisfaction:${t.payload.order_id}`,kind:'satisfaction',system:'email',payload:{order_id:t.payload.order_id},amount:0,priority:80},tx);
 }
 if(t.kind==='qualify' && t.payload.lead_id) await tx.query("update manager_operator.leads set status='answered' where id=$1",[t.payload.lead_id]);
 if(t.kind==='support' && t.payload.ticket_id) await tx.query("update manager_operator.support set status='resolved' where id=$1",[t.payload.ticket_id]);
 return true;
 });}
 async fail(t:Task,code:string,permanent=false){await this.db.transaction(async tx=>{
 const status=permanent||t.attempts>=5?'dead':'retry';
 if(t.kind==='check_offer' && t.payload.offer_id)await tx.query('update manager_operator.offers set ready=false where id=$1',[t.payload.offer_id]);
 await tx.query(`update manager_operator.tasks set status=$3,last_error=$4,available_at=now()+($5*interval '1 second'),lease_until=null,updated_at=now() where id=$1 and lease_token=$2 and status='running'`,[t.id,t.lease_token,status,code,Math.min(3600,30*2**t.attempts)]);
 await this.audit('runtime','task_failed',t.id,{code,status},tx);
 });}
 async retry(id:string,actor:string){await this.db.transaction(async tx=>{const r=await tx.query("update manager_operator.tasks set status='queued',attempts=0,last_error=null where id=$1 and status='dead' returning id",[id]);if(!r.rows.length)throw new Error('TASK_UNAVAILABLE');await this.audit(actor,'retry',id,{},tx);});}
 async tasks(){return (await this.db.query('select * from manager_operator.tasks order by created_at desc limit 200')).rows;}
 async memory(){return (await this.db.query('select * from manager_operator.observations order by created_at desc limit 100')).rows;}
 async offers(){return (await this.db.query('select * from manager_operator.offers where active=true order by id')).rows;}
 async recordPayment(p:{id:string;livemode:boolean;session_id:string;payment_intent:string;customer_id:string;email:string;offer_id:string;amount:number;currency:string;external_customer:boolean}){
 await this.db.transaction(async tx=>{
 await tx.query('insert into manager_operator.payment_locks(payment_intent) values($1) on conflict do nothing',[p.payment_intent]);
 await tx.query('select payment_intent from manager_operator.payment_locks where payment_intent=$1 for update',[p.payment_intent]);
 const e=await tx.query("insert into manager_operator.events(id,type) values($1,'payment') on conflict do nothing returning id",[p.id]);if(!e.rows.length)return;
 const offer=(await tx.query('select * from manager_operator.offers where id=$1',[p.offer_id])).rows[0];
 if(!offer||offer.unit_amount!==p.amount||offer.currency!==p.currency)throw new Error('PAYMENT_OFFER_MISMATCH');
 const refund=(await tx.query('select amount from manager_operator.refunds where payment_intent=$1',[p.payment_intent])).rows[0]?.amount??0;
 const r=await tx.query(`insert into manager_operator.orders(id,payment_intent,customer_id,email,offer_id,amount,currency,livemode,external_customer,refunded) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing returning id`,[p.session_id,p.payment_intent,p.customer_id,p.email,p.offer_id,p.amount,p.currency,p.livemode,p.external_customer,refund]);
 if(r.rows.length&&p.livemode&&refund===0) await this.enqueue({key:`onboard:${p.session_id}`,kind:'onboard',system:'email',payload:{order_id:p.session_id,offer_id:offer.id},amount:0,priority:105},tx);
 await this.audit('stripe','payment_recorded',p.session_id,{livemode:p.livemode},tx);
 });}
 async refund(event:string,paymentIntent:string,amount:number){await this.db.transaction(async tx=>{
 await tx.query('insert into manager_operator.payment_locks(payment_intent) values($1) on conflict do nothing',[paymentIntent]);
 await tx.query('select payment_intent from manager_operator.payment_locks where payment_intent=$1 for update',[paymentIntent]);
 await tx.query("insert into manager_operator.events(id,type) values($1,'refund') on conflict do nothing",[event]);
 await tx.query(`insert into manager_operator.refunds(payment_intent,amount) values($1,$2) on conflict(payment_intent) do update set amount=greatest(manager_operator.refunds.amount,excluded.amount)`,[paymentIntent,amount]);
 await tx.query('update manager_operator.orders set refunded=greatest(refunded,$2) where payment_intent=$1',[paymentIntent,amount]);
 await tx.query(`update manager_operator.tasks set status='rejected',last_error='REFUNDED' where payload->>'order_id' in (select id from manager_operator.orders where payment_intent=$1) and status in ('queued','retry','approval')`,[paymentIntent]);
 });}
 async metrics(){
 const currencies=(await this.db.query(`with c as (select currency from manager_operator.orders union select currency from manager_operator.costs union select currency from manager_operator.subscriptions)
 select c.currency,
 (select count(distinct customer_id)::int from manager_operator.orders o where o.currency=c.currency and livemode and external_customer and amount>refunded) customers,
 (select min(created_at) from manager_operator.orders o where o.currency=c.currency and livemode and external_customer and amount>refunded) first_paying_customer_at,
 coalesce((select sum(amount-refunded) from manager_operator.orders o where o.currency=c.currency and livemode),0)::float8 net_collected,
 coalesce((select sum(monthly_amount) from manager_operator.subscriptions s where s.currency=c.currency and livemode and status='active'),0)::float8 mrr,
 coalesce((select sum(amount) from manager_operator.costs x where x.currency=c.currency),0)::float8 operating_cost,
 (select count(*)::int from manager_operator.subscriptions s where s.currency=c.currency and livemode and status='canceled') canceled_subscriptions,
 (select count(*)::int from manager_operator.subscriptions s where s.currency=c.currency and livemode) subscriptions
 from c order by c.currency`)).rows;
 const activity=(await this.db.query(`select (select count(*)::int from manager_operator.leads) leads,(select count(*)::int from manager_operator.support where status='open') open_support,(select count(*)::int from manager_operator.tasks where status='dead') failed_tasks,(select count(*)::int from manager_operator.analytics where kind='visit') visits`)).rows[0];
 return {currencies:currencies.map(c=>({...c,arr:c.mrr*12,conversion_rate:activity.leads?c.customers/activity.leads:null,realized_customer_value:c.customers?c.net_collected/c.customers:null,net_contribution:c.net_collected-c.operating_cost,churn_rate:c.subscriptions?c.canceled_subscriptions/c.subscriptions:null})),...activity,ltv:null,marketing_roi:null,gross_margin:null,limitations:['Amounts are currency minor units. No FX aggregation.','MRR is current subscription run-rate. Churn shown is lifetime subscription cancellation ratio, not monthly cohort churn.','Forecast LTV, attributed marketing ROI and gross margin require verified cost/attribution/cohort data.']};
 }
}
