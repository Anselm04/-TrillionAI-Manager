import type {State} from './domain.ts';
import {recordPurchase,commerce,queueEmail,revokeAccess} from './commerce.ts';
export function recurringPayment(s:State,event:any,now=Date.now()){
 const p=event.data?.object;if(!p)return false;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&(p.mode==='subscription'||p.subscription)){
  if(p.livemode!==true)throw Error('live_event_required');
  if(p.payment_status!=='paid'||!Number.isSafeInteger(p.amount_total)||p.amount_total<=0)return true;
  const offer=s.offers.find(o=>o.id===p.metadata?.manager_offer_id&&o.billingMode==='subscription');
  if(!offer||offer.stripePriceId!==p.metadata?.manager_price_id||offer.currency!==p.currency||offer.priceMinor!==p.amount_total||!p.customer||typeof p.subscription!=='string')throw Error('offer_payment_mismatch');
  const id=`sub_initial:${p.subscription}`;let row=s.payments.find(x=>x.id===id);
  if(!row){row={id,sessionId:p.id,subscriptionId:p.subscription,offerId:offer.id,customerId:p.customer,amountMinor:p.amount_total,currency:p.currency,at:now,delivered:false,refunded:false};s.payments.push(row);}
  row.sessionId=p.id;recordPurchase(s,row,p);return true;
 }
 if(!['invoice.payment_succeeded','invoice.payment_failed'].includes(event.type))return false;
 const details=p.parent?.subscription_details||p.subscription_details;
 const subscriptionId=details?.subscription||p.subscription;
 const meta=details?.metadata||{};const existing=s.subscriptions.find(x=>x.id===subscriptionId);
 const offer=s.offers.find(o=>o.id===(meta.manager_offer_id||existing?.offerId)&&o.billingMode==='subscription');
 if(!offer)return true;
 if(event.type==='invoice.payment_failed'){
  const person=commerce(s).customers.find(x=>(x.stripeCustomerIds||[]).includes(p.customer));
  if(person)queueEmail(s,`invoice-failed:${p.id}`,person.id,'Your subscription payment needs attention','Your subscription payment could not be completed. Open your account to review billing or cancel anytime.');
  return true;
 }
 if(p.livemode!==true||p.status!=='paid'||p.paid_out_of_band===true||!Number.isSafeInteger(p.amount_paid)||p.amount_paid<=0||!p.customer||!subscriptionId)return true;
 const lines=p.lines?.data||[];
 if(!lines.some((x:any)=>(x.price?.id||x.pricing?.price_details?.price)===offer.stripePriceId)||p.currency!==offer.currency)throw Error('offer_payment_mismatch');
 const id=p.billing_reason==='subscription_create'?`sub_initial:${subscriptionId}`:`invoice:${p.id}`;
 let row=s.payments.find(x=>x.id===id);
 if(!row){row={id,subscriptionId,offerId:offer.id,customerId:p.customer,amountMinor:p.amount_paid,currency:p.currency,at:now,delivered:false,refunded:false};s.payments.push(row);}
 row.invoiceId=p.id;row.paymentIntentId=p.payment_intent||p.payments?.data?.find((x:any)=>x.payment?.payment_intent)?.payment.payment_intent;
 recordPurchase(s,row,{customer:p.customer,customer_email:p.customer_email});
 // Recurring invoices extend an existing product entitlement rather than sending another copy every month.
 const access=commerce(s).entitlements.find(x=>x.offerId===offer.id&&x.customerId===row.managerCustomerId&&x.status==='active');
 if(access){row.delivered=true;row.deliveryEvidence=access.id;}
 const pending=s.observations.filter(x=>x.kind==='stripe_refund'&&(x.paymentId===row.paymentIntentId||x.invoiceId===row.invoiceId)).reduce((n,x)=>Math.max(n,x.refundMinor),0);
 if(pending){row.refundMinor=pending;row.refunded=pending>=row.amountMinor;if(row.refunded)revokeAccess(s,row.id);}
 return true;
}
