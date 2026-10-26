import {randomUUID, createHash} from 'node:crypto';
import type {State} from './domain.ts';
export interface Commerce {
 customers:any[];quotes:any[];tickets:any[];entitlements:any[];outbox:any[];effects:any[];incidents:any[];checkouts:any[];
}
export function commerce(s:State):Commerce {
 return s.commerce??=( {customers:[],quotes:[],tickets:[],entitlements:[],outbox:[],effects:[],incidents:[],checkouts:[]} );
}
export function customer(s:State,email:string,userId?:string){
 const address=String(email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw Error('customer_email_required');
 const c=commerce(s);let row=c.customers.find(x=>x.email===address);
 if(!row){row={id:randomUUID(),email:address,createdAt:Date.now(),marketingConsent:false};c.customers.push(row);}
 if(userId){if(row.userId&&row.userId!==userId)throw Error('customer_identity_conflict');row.userId=userId;}
 return row;
}
export function customerForUser(s:State,user:any){
 if(!user?.id||!user.email||!user.email_confirmed_at)throw Error('verified_email_required');
 return customer(s,user.email,user.id);
}
export function queueEmail(s:State,key:string,customerId:string,subject:string,text:string,kind='transactional'){
 const c=commerce(s);const person=c.customers.find(x=>x.id===customerId);if(!person)throw Error('unknown_customer');
 if(kind==='marketing'&&!person.marketingConsent)throw Error('marketing_consent_required');
 let item=c.outbox.find(x=>x.key===key);if(item)return item;
 item={id:randomUUID(),key,customerId,to:person.email,subject,text,kind,status:'queued',attempts:0,due:Date.now(),createdAt:Date.now()};c.outbox.push(item);return item;
}
function words(text:string){return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]);}
export function qualify(s:State,lead:any,ready:(o:any)=>boolean,now=Date.now()){
 const c=commerce(s);const prior=c.quotes.find(x=>x.leadId===lead.id&&x.expiresAt>now);if(prior)return prior;
 if(lead.consent!==true||lead.status==='declined')throw Error('enquiry_consent_required');
 const intent=words(lead.need||'');
 const ranked=s.offers.filter(ready).map(o=>{const terms=words([o.name,...(o.keywords||[]),...(o.approvedClaims||[])].join(' '));const matches=[...intent].filter(w=>terms.has(w)).length;return {o,matches};}).filter(x=>x.matches>0).sort((a,b)=>b.matches-a.matches||b.o.marginMinor-a.o.marginMinor);
 const person=customer(s,lead.email);lead.customerId=person.id;
 if(!ranked.length){lead.status='needs_review';return null;}
 const o=ranked[0].o;
 const quote={id:randomUUID(),leadId:lead.id,customerId:person.id,offerId:o.id,name:o.name,priceMinor:o.priceMinor,currency:o.currency,mode:o.billingMode||'payment',status:'offered',createdAt:now,expiresAt:now+7*86400000,purchaseUrl:o.purchaseUrl,claims:[...(o.approvedClaims||[])]};
 c.quotes.push(quote);lead.status='qualified';lead.offerId=o.id;return quote;
}
export function answerQuestion(s:State,offerId:string,question:string){
 const o=s.offers.find(x=>x.id===offerId);if(!o)throw Error('unknown_offer');
 const query=words(question);const matches=(o.faq||[]).map((f:any)=>({f,score:[...words(f.question)].filter(w=>query.has(w)).length})).sort((a:any,b:any)=>b.score-a.score);
 return matches[0]?.score>0?{answer:matches[0].f.answer,source:'approved_faq'}:{answer:'Please send this question to support so we can give you a confirmed answer.',source:'support_required'};
}
export function recordPurchase(s:State,p:any,session:any){
 const c=commerce(s);if(session.metadata?.manager_campaign_id)p.campaignId=session.metadata.manager_campaign_id;const email=session.customer_details?.email||session.customer_email;
 if(!email){p.onboardingStatus='email_required';return;}
 const person=customer(s,email);person.stripeCustomerIds??=[];if(session.customer&&!person.stripeCustomerIds.includes(session.customer))person.stripeCustomerIds.push(session.customer);p.managerCustomerId=person.id;p.onboardingStatus='ready';
 if(session.client_reference_id && /^[a-zA-Z0-9-]{1,80}$/.test(session.client_reference_id)){
  // A checkout-bound user ID is only an association hint. Portal access still verifies the email.
  p.checkoutUserId=session.client_reference_id;
 }
 for(const quote of c.quotes)if(quote.customerId===person.id&&quote.offerId===p.offerId&&quote.status==='offered'){quote.status='paid';quote.paymentId=p.id;}
}
export function grantAccess(s:State,paymentId:string,now=Date.now()){
 const p=s.payments.find(x=>x.id===paymentId&&!x.refunded);if(!p)throw Error('paid_purchase_required');
 if(!p.managerCustomerId)throw Error('customer_onboarding_required');
 const offer=s.offers.find(x=>x.id===p.offerId);if(!offer?.delivery?.assets?.length)throw Error('delivery_assets_required');
 const c=commerce(s);let row=c.entitlements.find(x=>x.paymentId===p.id);
 if(!row){row={id:randomUUID(),paymentId:p.id,customerId:p.managerCustomerId,offerId:p.offerId,assets:structuredClone(offer.delivery.assets),status:'active',createdAt:now};c.entitlements.push(row);}
 return row;
}
export function revokeAccess(s:State,paymentId:string){for(const e of commerce(s).entitlements)if(e.paymentId===paymentId)e.status='revoked';}
export function entitled(s:State,customerId:string,id:string){
 const e=commerce(s).entitlements.find(x=>x.id===id&&x.customerId===customerId&&x.status==='active');
 const p=e&&s.payments.find(x=>x.id===e.paymentId&&!x.refunded);
 if(!e||!p)throw Error('entitlement_not_found');if(p.subscriptionId){const sub=s.subscriptions.find(x=>x.id===p.subscriptionId);if(sub&&['canceled','unpaid','incomplete_expired'].includes(sub.status))throw Error('entitlement_not_found');}return e;
}
export function openTicket(s:State,person:any,input:any,now=Date.now()){
 if(typeof input.subject!=='string'||!input.subject.trim()||input.subject.length>200||typeof input.message!=='string'||!input.message.trim()||input.message.length>6000||typeof input.requestId!=='string'||input.requestId.length>100)throw Error('invalid_ticket');
 const c=commerce(s);const prior=c.tickets.find(x=>x.customerId===person.id&&x.requestId===input.requestId);if(prior)return prior;
 const ticket={id:randomUUID(),requestId:input.requestId,customerId:person.id,subject:input.subject.trim(),status:'open',createdAt:now,dueAt:now+86400000,messages:[{role:'customer',text:input.message.trim(),at:now}],priority:'normal'};c.tickets.push(ticket);return ticket;
}
export function feedback(s:State,person:any,paymentId:string,response:string,now=Date.now()){
 if(!['satisfied','needs_help'].includes(response))throw Error('invalid_feedback');
 const p=s.payments.find(x=>x.id===paymentId&&x.managerCustomerId===person.id);if(!p)throw Error('unknown_payment');
 p.satisfaction={response,at:now,source:'authenticated_customer'};
 if(response==='needs_help')openTicket(s,person,{subject:'Help with your purchase',message:'Customer requested assistance after delivery.',requestId:`feedback:${paymentId}`},now);
}
export function incident(s:State,key:string,code:string,details:any,now=Date.now()){
 const c=commerce(s);let row=c.incidents.find(x=>x.key===key&&x.status==='open');if(row)return row;
 row={id:randomUUID(),key,code,details,status:'open',createdAt:now};c.incidents.push(row);return row;
}
export function fingerprint(value:any){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
