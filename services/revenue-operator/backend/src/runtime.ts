import type {Store,Task} from './store.js';
import {rankOffers} from './policy.js';
export interface Receipt {id:string;status:'accepted'|'completed';evidence:string;[key:string]:unknown}
export interface Adapter {execute(t:Task):Promise<Receipt>;verify(t:Task,r:Receipt):Promise<boolean>}
export class OperationError extends Error {constructor(public code:string,public permanent=false){super(code);}}
export class Runtime {
 constructor(public store:Store,public adapters:Map<string,Adapter>,public validateOffer?:(offer:any)=>Promise<boolean>){}
 async plan(now=Date.now()){
 const s=this.store,day=new Date(now).toISOString().slice(0,10);
 if(!(await s.db.query('select running from manager_operator.settings where id=true')).rows[0]?.running)return;
 const offers=await s.offers();
 for(const o of offers) if(!o.verified_at||now-Date.parse(o.verified_at)>3600000) await s.enqueue({key:`offer:${o.id}:${Math.floor(now/3600000)}`,kind:'check_offer',system:o.system,payload:{offer_id:o.id},amount:0,priority:90});
 const ranked=rankOffers(offers.map(o=>({...o,verified_at:o.verified_at?new Date(o.verified_at).toISOString():null})),now);
 // Failed paths reduce rank; successful paths regain priority. Never retry forever on one offer.
 const history=(await s.db.query(`select payload->>'offer_id' id,count(*)::int failures from manager_operator.tasks where kind='acquire' and status='dead' and created_at>now()-interval '7 days' group by 1`)).rows;
 ranked.sort((a,b)=>(b.unit_amount-b.cost_amount)*(1+b.demand)/(1+(history.find(h=>h.id===b.id)?.failures??0))-(a.unit_amount-a.cost_amount)*(1+a.demand)/(1+(history.find(h=>h.id===a.id)?.failures??0)));
 for(const o of ranked.slice(0,3)) await s.enqueue({key:`growth:${o.id}:${day}`,kind:'acquire',system:'marketing',payload:{offer_id:o.id,mode:'inbound',paid_ads:false},amount:0,priority:50});
 const leads=(await s.db.query("select * from manager_operator.leads where status='new' order by created_at limit 50")).rows;
 for(const lead of leads){const offer=ranked.find(o=>o.id===lead.offer_id)??ranked[0];if(offer)await s.enqueue({key:`qualify:${lead.id}`,kind:'qualify',system:'email',payload:{lead_id:lead.id,offer_id:offer.id},amount:0,priority:85});}
 const tickets=(await s.db.query("select id from manager_operator.support where status='open' limit 50")).rows;
 for(const ticket of tickets) await s.enqueue({key:`support:${ticket.id}`,kind:'support',system:'support',payload:{ticket_id:ticket.id},amount:0,priority:110});
 await s.enqueue({key:`secure:${Math.floor(now/3600000)}`,kind:'secure',system:'secure',payload:{mode:'observe_only'},amount:0,priority:95});
 await s.enqueue({key:`optimize:${day}`,kind:'optimize',system:'analytics',payload:{mode:'recommend',pricing_changes:false},amount:0,priority:30});
 await s.db.query("insert into manager_operator.heartbeats(id) values('planner') on conflict(id) do update set at=now()");
 }
 async work(){const t=await this.store.claim();if(!t)return false;
 try{
 const adapter=this.adapters.get(t.system);if(!adapter)throw new OperationError('INTEGRATION_NOT_CONFIGURED',true);
 if(t.payload.order_id){const order=(await this.store.db.query('select * from manager_operator.orders where id=$1',[t.payload.order_id])).rows[0];if(!order||order.refunded>0||!order.livemode)throw new OperationError('ORDER_NOT_FULFILLABLE',true);}
 if(t.kind==='check_offer'){
 const offer=(await this.store.db.query('select * from manager_operator.offers where id=$1',[t.payload.offer_id])).rows[0];
 if(!offer||!this.validateOffer||!await this.validateOffer(offer))throw new OperationError('CHECKOUT_NOT_VERIFIED',true);
 }
 if((t.kind==='acquire'||t.kind==='qualify')&&t.payload.offer_id){
 const offer=(await this.store.db.query("select id from manager_operator.offers where id=$1 and active and ready and verified_at>now()-interval '24 hours'",[t.payload.offer_id])).rows[0];
 if(!offer)throw new OperationError('OFFER_NOT_READY',true);
 }
 const receipt=await adapter.execute(t);
 if(t.kind==='check_offer'){
 const c=receipt.checks as any;if(!c?.delivery||!c?.legal||!c?.support)throw new OperationError('OFFER_EVIDENCE_INCOMPLETE',true);
 }
 if(receipt.status!=='completed'||!await adapter.verify(t,receipt))throw new OperationError('RESULT_NOT_VERIFIED');
 await this.store.complete(t,receipt);
 }catch(e){const error=e instanceof OperationError?e:new OperationError('INTEGRATION_FAILED');await this.store.fail(t,error.code,error.permanent);}
 return true;
 }
}
