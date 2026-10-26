import type {State} from './domain.ts';
import {audit} from './domain.ts';
// Only signed Stripe subscription events reach this function in the HTTP service.
export function subscriptionEvent(s:State,event:any){
 const obj=event.data?.object;
 if(!event.type?.startsWith('customer.subscription.')||event.livemode!==true||obj?.livemode!==true)return false;
 const offer=s.offers.find(o=>o.id===obj.metadata?.manager_offer_id);
 if(!offer)return true; // Other products in the Stripe account do not enter Manager's ledger.
 if(!Number.isInteger(event.created))throw Error('subscription_timestamp_required');
 const prior=s.subscriptions.find(x=>x.id===obj.id);
 if(prior && prior.eventCreated>=event.created)return true;
 let mrr=0,known=true,currency:string|undefined;
 for(const item of obj.items?.data||[]){
  const price=item.price,recurring=price?.recurring;
  if(currency && currency!==price?.currency)known=false;
  if(price?.currency)currency=price.currency;
  if(!Number.isInteger(price?.unit_amount)||!Number.isInteger(item.quantity)||!recurring||!['month','year'].includes(recurring.interval)||!Number.isInteger(recurring.interval_count)||recurring.interval_count<=0||price.billing_scheme!=='per_unit'||recurring.usage_type==='metered') {known=false;continue;}
  mrr+=price.unit_amount*item.quantity/(recurring.interval_count*(recurring.interval==='year'?12:1));
 }
 if(!currency || !obj.items?.data?.length || obj.items.has_more)known=false;
 const row={id:obj.id,customerId:obj.customer,offerId:offer.id,status:obj.status,currency,mrrMinor:known?mrr:null,startedAt:obj.start_date*1000,canceledAt:obj.canceled_at?obj.canceled_at*1000:null,eventCreated:event.created,observedAt:Date.now()};
 if(prior)Object.assign(prior,row);else s.subscriptions.push(row);
 audit(s,'subscription.observed',{id:obj.id,status:obj.status});return true;
}
export function recordObservation(s:State,p:any){
 if(typeof p.id!=='string'||!Number.isSafeInteger(p.at)||Math.abs(Date.now()-p.at)>86400000||!['traffic','cost','health'].includes(p.kind)||typeof p.source!=='string')throw Error('invalid_observation');
 if(s.observations.some(x=>x.id===p.id))return;
 if(p.kind==='cost' && (!Number.isSafeInteger(p.amountMinor)||p.amountMinor<0||!/^[a-z]{3}$/.test(p.currency)||!['marketing','delivery','operations'].includes(p.category)||typeof p.evidenceUrl!=='string'||!p.evidenceUrl.startsWith('https://')))throw Error('invalid_cost');
 if(p.kind==='traffic' && (!Number.isSafeInteger(p.visitors)||p.visitors<0||typeof p.windowStart!=='number'||typeof p.windowEnd!=='number'||p.windowEnd<=p.windowStart))throw Error('invalid_traffic');
 if(p.kind==='health' && (!['healthy','degraded','down'].includes(p.status)||typeof p.productId!=='string'))throw Error('invalid_health');
 s.observations.push(p);if(p.kind==='cost')s.costs.push(p);audit(s,'observation.recorded',{id:p.id,kind:p.kind,source:p.source});
}
export function economics(s:State,now=Date.now()){
 const active=s.subscriptions.filter(x=>['active','past_due'].includes(x.status));
 const currencies=[...new Set([...s.payments.map(p=>p.currency),...s.costs.map(c=>c.currency),...active.map(x=>x.currency)].filter(Boolean))];
 const byCurrency=Object.fromEntries(currencies.map(currency=>{
  const paid=s.payments.filter(p=>p.currency===currency);const revenue=paid.reduce((n,p)=>n+p.amountMinor-(p.refundMinor||0),0);
  const costs=s.costs.filter(c=>c.currency===currency);const operatingCost=costs.reduce((n,c)=>n+c.amountMinor,0);const cogs=costs.filter(c=>c.category==='delivery').reduce((n,c)=>n+c.amountMinor,0);
  const subs=active.filter(x=>x.currency===currency);const mrr=subs.some(x=>x.mrrMinor===null)?null:subs.reduce((n,x)=>n+x.mrrMinor,0);
  const customers=new Set(paid.map(p=>p.customerId)).size;
  return [currency,{revenueMinor:revenue,observedMrrMinor:mrr,observedArrMinor:mrr===null?null:mrr*12,operatingCostMinor:operatingCost,observedGrossMargin:revenue>0?(revenue-cogs)/revenue:null,realizedLifetimeRevenuePerCustomerMinor:customers?revenue/customers:null}];
 }));
 const traffic=s.observations.filter(o=>o.kind==='traffic').sort((a,b)=>b.windowEnd-a.windowEnd)[0];
 const converted=traffic?new Set(s.payments.filter(p=>p.at>=traffic.windowStart&&p.at<traffic.windowEnd).map(p=>p.customerId)).size:0;
 const start=now-30*86400000;const cohort=s.subscriptions.filter(x=>x.startedAt<start && (!x.canceledAt||x.canceledAt>=start));
 return {byCurrency,observedConversionRate:traffic?.visitors?converted/traffic.visitors:null,observedThirtyDayChurn:cohort.length?cohort.filter(x=>x.canceledAt&&x.canceledAt<=now).length/cohort.length:null,
 marketingROI:null,marketingROIReason:'Payment-to-campaign attribution is not connected.',subscriptionCoverage:'Observed signed events only; full Stripe account reconciliation pending.',
 productHealth:s.observations.filter(x=>x.kind==='health').map(x=>({productId:x.productId,status:x.status,observedAt:x.at,stale:x.at<now-300000})),
 costCoverage:'Only authenticated, evidence-backed cost observations; not full accounting.'};
}
