import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import type {Store} from './store.ts';
import {commerce,customerForUser,entitled,openTicket,feedback,queueEmail,answerQuestion} from './commerce.ts';
import {sellable,enqueue,audit} from './domain.ts';
import {type Env,origin,jsonRequest,signedAsset,portalUrl} from './services.ts';
import {checkout} from './stripe.ts';
export async function authUser(req:IncomingMessage,env:Env,request:typeof fetch=fetch){
 const authorization=req.headers.authorization;
 if(!authorization?.startsWith('Bearer ')||!env.SUPABASE_PUBLISHABLE_KEY)throw Error('unauthorized');
 const r=await request(origin(env.SUPABASE_URL)+'/auth/v1/user',{headers:{authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok)throw Error('unauthorized');const user=await r.json();if(!user.id||!user.email||!user.email_confirmed_at)throw Error('verified_email_required');return user;
}
export async function routeCustomer(req:IncomingMessage,res:ServerResponse,ctx:{store:Store,env:Env,request:typeof fetch,body:()=>Promise<Buffer>,reply:(status:number,data:any)=>void}){
 const {store,env,request,reply}=ctx;const path=new URL(req.url||'/','http://localhost').pathname;
 if(path==='/catalog'&&req.method==='GET'){
  reply(200,await store.transact(s=>s.offers.filter(o=>sellable(o)).map(o=>({id:o.id,name:o.name,priceMinor:o.priceMinor,currency:o.currency,billingMode:o.billingMode||'payment',billingInterval:o.billingInterval,claims:o.approvedClaims,faq:o.faq||[],purchaseUrl:o.purchaseUrl}))));return true;
 }
 if(!path.startsWith('/customer/'))return false;
 const user=await authUser(req,env,request);const person=await store.transact(s=>customerForUser(s,user));
 if(path==='/customer/state'&&req.method==='GET'){
  reply(200,await store.transact(s=>{const c=commerce(s);const stripeIds=person.stripeCustomerIds||[];return {customer:{id:person.id,email:person.email,marketingConsent:person.marketingConsent},orders:s.payments.filter(p=>p.managerCustomerId===person.id).map(p=>({id:p.id,offerId:p.offerId,amountMinor:p.amountMinor,currency:p.currency,at:p.at,delivered:p.delivered,refunded:p.refunded,satisfaction:p.satisfaction})),entitlements:c.entitlements.filter(e=>e.customerId===person.id&&e.status==='active').map(e=>({id:e.id,offerId:e.offerId,assets:e.assets.map((a:any,index:number)=>({index,name:a.name||'Download'}))})),quotes:c.quotes.filter(q=>q.customerId===person.id),tickets:c.tickets.filter(t=>t.customerId===person.id),subscriptions:s.subscriptions.filter(x=>stripeIds.includes(x.customerId)).map(x=>({id:x.id,status:x.status,offerId:x.offerId,cancelAtPeriodEnd:x.cancelAtPeriodEnd,currentPeriodEnd:x.currentPeriodEnd}))};}));return true;
 }
 const order=path.match(/^\/customer\/orders\/([^/]+)$/);if(order&&req.method==='GET'){reply(200,await store.transact(s=>{const e=entitled(s,person.id,order[1]);return {id:e.id,offerId:e.offerId,status:e.status,assets:e.assets.map((a:any)=>({name:a.name||'Download'}))};}));return true;}
 const download=path.match(/^\/customer\/entitlements\/([^/]+)\/download\/([0-9]+)$/);
 if(download&&req.method==='POST'){
  const asset=await store.transact(s=>{const e=entitled(s,person.id,download[1]);const a=e.assets[Number(download[2])];if(!a)throw Error('asset_not_found');audit(s,'customer.download',{customerId:person.id,entitlementId:e.id,index:Number(download[2])});return a;});
  const url=await signedAsset(asset,env,request);reply(200,{url,expiresIn:60});return true;
 }
 if(req.method!=='POST'){reply(404,{error:'not_found'});return true;}
 const p=JSON.parse((await ctx.body()).toString()||'{}');
 if(path==='/customer/checkout'){
  const offer=await store.transact(s=>s.offers.find(o=>o.id===p.offerId&&sellable(o)));if(!offer)throw Error('offer_not_ready');
  const id=String(req.headers['idempotency-key']||'');if(!/^[\w-]{16,128}$/.test(id))throw Error('idempotency_key_required');
  const key=`${person.id}:${id}`;const session=await checkout(offer,env.STRIPE_SECRET_KEY||'',env.CHECKOUT_SUCCESS_URL||'',env.CHECKOUT_CANCEL_URL||'',key,request,{customerEmail:person.email,userId:user.id});
  await store.transact(s=>{const c=commerce(s);if(!c.checkouts.some(x=>x.id===session.id))c.checkouts.push({id:session.id,customerId:person.id,offerId:offer.id,at:Date.now()});});reply(201,session);return true;
 }
 if(path==='/customer/tickets'){
  const ticket=await store.transact(s=>{const t=openTicket(s,person,p);enqueue(s,`ticket:${t.id}`,'support',{ticketId:t.id,system:'support',maxCostMinor:0},95);return t;});reply(201,ticket);return true;
 }
 if(path==='/customer/question'){
  if(typeof p.question!=='string'||p.question.length>4000)throw Error('invalid_question');
  const answer=await store.transact(s=>answerQuestion(s,p.offerId,p.question));
  if(answer.source==='support_required')await store.transact(s=>{const t=openTicket(s,person,{subject:'Product question',message:p.question,requestId:String(p.requestId||randomUUID())});enqueue(s,`ticket:${t.id}`,'support',{ticketId:t.id,system:'support',maxCostMinor:0},80);});
  reply(200,answer);return true;
 }
 if(path==='/customer/feedback'){await store.transact(s=>{feedback(s,person,p.paymentId,p.response);audit(s,'customer.feedback',{customerId:person.id,paymentId:p.paymentId,response:p.response});});reply(200,{recorded:true});return true;}
 if(path==='/customer/preferences'){
  if(typeof p.marketingConsent!=='boolean')throw Error('invalid_preferences');await store.transact(s=>{const c=customerForUser(s,user);c.marketingConsent=p.marketingConsent;audit(s,'customer.consent',{customerId:c.id,marketingConsent:p.marketingConsent});if(!p.marketingConsent)for(const m of commerce(s).outbox)if(m.customerId===c.id&&m.kind==='marketing'&&m.status==='queued')m.status='cancelled';});reply(200,{updated:true});return true;
 }
 const cancel=path.match(/^\/customer\/subscriptions\/([^/]+)\/cancel$/);
 if(cancel){
  const sub=await store.transact(s=>s.subscriptions.find(x=>x.id===cancel[1]&&(person.stripeCustomerIds||[]).includes(x.customerId)&&s.offers.some(o=>o.id===x.offerId)));if(!sub)throw Error('subscription_not_found');
  if(!env.STRIPE_SECRET_KEY?.startsWith('sk_live_'))throw Error('stripe_not_configured');
  const body=new URLSearchParams({cancel_at_period_end:'true'});
  const response=await jsonRequest('https://api.stripe.com/v1/subscriptions/'+encodeURIComponent(sub.id),env.STRIPE_SECRET_KEY,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','idempotency-key':`cancel/${person.id}/${sub.id}`},body},request);
  if(response.id!==sub.id||response.cancel_at_period_end!==true)throw Error('cancellation_not_confirmed');
  await store.transact(s=>{const existing=s.subscriptions.find(x=>x.id===sub.id);existing.cancelAtPeriodEnd=true;audit(s,'customer.subscription_cancelled',{customerId:person.id,subscriptionId:sub.id});});reply(200,{cancelAtPeriodEnd:true});return true;
 }
 if(path==='/customer/billing-portal'){
  const ids=person.stripeCustomerIds||[];if(!ids.length)throw Error('billing_customer_not_found');
  if(!env.STRIPE_SECRET_KEY?.startsWith('sk_live_'))throw Error('stripe_not_configured');
  const body=new URLSearchParams({customer:ids[0],return_url:portalUrl(env)});const result=await jsonRequest('https://api.stripe.com/v1/billing_portal/sessions',env.STRIPE_SECRET_KEY,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body},request);
  if(!result.url?.startsWith('https://billing.stripe.com/'))throw Error('billing_portal_unavailable');reply(200,{url:result.url});return true;
 }
 reply(404,{error:'not_found'});return true;
}
export function replyTicket(s:any,id:string,input:any){
 const ticket=commerce(s).tickets.find(t=>t.id===id);if(!ticket)throw Error('ticket_not_found');
 if(typeof input.message!=='string'||!input.message.trim()||input.message.length>6000)throw Error('invalid_reply');
 ticket.messages.push({role:'support',text:input.message.trim(),at:Date.now()});ticket.status=input.resolve===true?'resolved':'waiting_customer';
 queueEmail(s,`ticket-reply:${ticket.id}:${ticket.messages.length}`,ticket.customerId,`Re: ${ticket.subject}`,input.message.trim());audit(s,'support.replied',{ticketId:id,status:ticket.status});return ticket;
}
