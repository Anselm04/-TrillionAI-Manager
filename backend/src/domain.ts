import {subscriptionEvent,economics} from './economics.ts';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
export type Action = 'campaign'|'deliver'|'support'|'improve'|'protect'|'educate'|'strategic';
export type Task = {id:string,key:string,action:Action,payload:any,priority:number,status:string,attempts:number,due:number,lease?:number,claim?:string,result?:any,approval?:{decision:string,at:number},error?:string};
export type State = {running:boolean,tasks:Task[],offers:any[],leads:any[],payments:any[],events:string[],audit:any[],memory:any[],costs:any[],subscriptions:any[],observations:any[]};
export const initial = ():State => ({running:false,tasks:[],offers:[],leads:[],payments:[],events:[],audit:[],memory:[],costs:[],subscriptions:[],observations:[]});
export function audit(s:State,event:string,details:any,now=Date.now()) { s.audit.push({id:randomUUID(),at:now,event,details}); }
export function enqueue(s:State,key:string,action:Action,payload:any,priority=50,now=Date.now()) {
 let task=s.tasks.find(t=>t.key===key); if(task) return task;
 task={id:randomUUID(),key,action,payload,priority,status:requiresApproval(action,payload)?'approval':'queued',attempts:0,due:now};
 s.tasks.push(task); audit(s,'task.created',{id:task.id,action,status:task.status},now); return task;
}
export function requiresApproval(action:Action,p:any) {
 // No autonomous spend is authorized by default. Integrations must enforce the same constraint.
 return action==='strategic' || Number(p.maxCostMinor)!==0 || p.hiring===true || p.borrowing===true || p.legalAgreement===true || p.pricingChange===true || p.highRisk===true || p.newDivision===true || p.enterpriseContract===true;
}
export function decide(s:State,id:string,decision:string,now=Date.now()) {
 const t=s.tasks.find(t=>t.id===id); if(!t || t.status!=='approval' || !['approve','reject'].includes(decision)) throw Error('invalid_approval');
 t.approval={decision,at:now};t.status=decision==='approve'?'queued':'rejected';audit(s,'owner.decision',{id,decision},now);
}
export function sellable(o:any,now=Date.now()) {
 return /^https:\/\//.test(o.purchaseUrl||'') && o.active===true && o.evidence?.checkout===true && o.evidence?.delivery===true && o.evidence?.legal===true && o.evidence?.product===true && o.evidence?.checkedAt>now-86400000 && o.priceMinor>0 && /^[a-z]{3}$/.test(o.currency) && /^price_/.test(o.stripePriceId||'') && /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(o.checkoutUrl||'');
}
export function plan(s:State,now=Date.now()) {
 if(!s.running) return;
 // Fulfil paid obligations before new acquisition. Receipt alone never means delivered.
 for(const p of s.payments.filter(p=>!p.refunded && !p.delivered)) {
  const o=s.offers.find(o=>o.id===p.offerId); if(o) enqueue(s,`delivery:${p.id}`,'deliver',{paymentId:p.id,offerId:o.id,customerId:p.customerId,system:o.system,maxCostMinor:0},100,now);
 }
 for(const p of s.payments.filter(p=>p.delivered && !p.refunded && !p.satisfaction)) enqueue(s,`satisfaction:${p.id}`,'support',{paymentId:p.id,customerId:p.customerId,system:'support',maxCostMinor:0},90,now);
 const offers=s.offers.filter(o=>sellable(o,now)).sort((a,b)=>(b.marginMinor*b.conversionEstimate)-(a.marginMinor*a.conversionEstimate));
 if(!offers.length) { if(!s.memory.some(m=>m.key==='no-ready-offer')) {s.memory.push({key:'no-ready-offer',at:now});audit(s,'mission.blocked',{reason:'No product with fresh checkout, delivery, legal and product evidence'},now);} return; }
 const day=Math.floor(now/86400000);
 // Failed routes cool down; choose the next offer rather than retrying a broken offer forever.
 const eligible=offers.filter(o=>!s.tasks.some(t=>t.action==='campaign' && t.payload.offerId===o.id && t.status==='dead' && t.due>now-86400000));
 const o=eligible[0];
 if(o) enqueue(s,`campaign:${o.id}:${day}`,'campaign',{offerId:o.id,system:'marketing',checkoutUrl:o.purchaseUrl,claims:o.approvedClaims,channel:'inbound',maxCostMinor:0,prohibit:['spam','fake_testimonials','unsupported_claims','paid_ads']},40,now);
}
export function claim(s:State,now=Date.now()) {
 if(!s.running) return null;
 for(const t of s.tasks) if(t.status==='running' && (t.lease||0)<now) {t.status=t.attempts>=5?'dead':'queued';t.due=now;audit(s,'task.lease_expired',{id:t.id},now);}
 const t=s.tasks.filter(t=>t.status==='queued' && t.due<=now).sort((a,b)=>b.priority-a.priority || a.due-b.due)[0];
 if(!t) return null;
 // Re-evaluate immutable risk fields on every execution.
 if(requiresApproval(t.action,t.payload) && t.approval?.decision!=='approve') {t.status='approval';return null;}
 t.status='running';t.attempts++;t.claim=randomUUID();t.lease=now+120000; audit(s,'task.claimed',{id:t.id,attempt:t.attempts},now); return structuredClone(t);
}
export function finish(s:State,id:string,token:string,result:any,error?:string,now=Date.now()) {
 const t=s.tasks.find(t=>t.id===id);if(!t || t.status!=='running' || t.claim!==token) return false;
 if(error) {t.error=error;t.status=t.attempts>=5?'dead':'queued';t.due=now+Math.min(3600000,1000*2**t.attempts);audit(s,'task.failed',{id,status:t.status,code:error},now);s.memory.push({at:now,taskId:id,outcome:error});return true;}
 if(result?.status!=='verified' || typeof result.evidenceUrl!=='string' || !result.evidenceUrl.startsWith('https://')) throw Error('unverified_result');
 t.status='done';t.result=result;t.error=undefined;
 const p=s.payments.find(p=>p.id===t.payload.paymentId);
 if(p && t.action==='deliver') {p.delivered=true;p.deliveryEvidence=result.evidenceUrl;}
 // Satisfaction is only established by authenticated customer feedback, never an adapter assertion.
 audit(s,'task.verified',{id,evidenceUrl:result.evidenceUrl},now);s.memory.push({at:now,taskId:id,outcome:'verified',evidenceUrl:result.evidenceUrl});return true;
}
export function verifySignature(raw:Buffer,header:string,secret:string,now=Date.now()) {
 const pieces=header.split(',').map(x=>x.split('='));const stamp=pieces.find(x=>x[0]==='t')?.[1];
 if(!stamp || !/^\d+$/.test(stamp) || Math.abs(now/1000-Number(stamp))>300) throw Error('invalid_signature');
 const expected=createHmac('sha256',secret).update(`${stamp}.`).update(raw).digest();
 if(!pieces.filter(x=>x[0]==='v1').some(x=>{const v=Buffer.from(x[1]||'','hex');return v.length===expected.length && timingSafeEqual(v,expected);})) throw Error('invalid_signature');
}
export function payment(s:State,event:any,now=Date.now()) {
 if(event.livemode!==true || typeof event.id!=='string') throw Error('live_event_required');
 if(s.events.includes(event.id)) return;
 if(subscriptionEvent(s,event)){s.events.push(event.id);return;}
 const p=event.data?.object;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
  if(p?.payment_status!=='paid' || p.livemode!==true || !p.customer || !p.payment_intent) throw Error('paid_customer_required');
  const offer=s.offers.find(o=>o.id===p.metadata?.manager_offer_id);
  // Binding is set server-side on checkout creation and independently checked on receipt.
  if(!offer || p.metadata?.manager_price_id!==offer.stripePriceId || p.currency!==offer.currency || p.amount_total!==offer.priceMinor) throw Error('offer_payment_mismatch');
  if(!s.payments.some(x=>x.id===p.payment_intent)) {s.payments.push({id:p.payment_intent,sessionId:p.id,offerId:offer.id,customerId:p.customer,amountMinor:p.amount_total,currency:p.currency,at:now,delivered:false,refunded:false});audit(s,'payment.confirmed',{id:p.payment_intent,offerId:offer.id},now);}
 } else if(event.type==='charge.refunded') {
  const paid=s.payments.find(x=>x.id===p.payment_intent);if(paid) {paid.refunded=true;paid.refundMinor=p.amount_refunded;audit(s,'payment.refunded',{id:paid.id},now);}
 }
 s.events.push(event.id);
}
export function metrics(s:State) {
 const live=s.payments.filter(p=>!p.refunded);const observed=economics(s);
 return {economics:observed,firstPayingCustomer:s.payments.length>0,firstCustomerDelivered:live.some(p=>p.delivered),customersAcquired:new Set(s.payments.map(p=>p.customerId)).size,retainedPayingCustomers:new Set(live.map(p=>p.customerId)).size,
  byCurrency:observed.byCurrency,
  mrrMinor:null,arrMinor:null,churn:null,customerLifetimeValue:null,marketingROI:null,conversionRate:null,
  supportOpen:s.leads.filter(l=>l.status==='support').length,deadTasks:s.tasks.filter(t=>t.status==='dead').length,
  productHealth:s.offers.map(o=>({id:o.id,sellable:sellable(o)})),
  unavailableReason:'Account-wide subscription reconciliation, attribution, traffic and cost coverage required; observed metrics are separately labeled.'};
}
