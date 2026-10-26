import Stripe from 'stripe';
import {randomUUID,createHash} from 'node:crypto';
import type {BillingAccount} from './config.js';
import type {Store} from './store.js';
export class Billing {
 clients=new Map<string,{config:BillingAccount;stripe:Stripe}>();
 constructor(public store:Store,accounts:BillingAccount[]){for(const config of accounts)this.clients.set(config.id,{config,stripe:new Stripe(config.key,{maxNetworkRetries:2,timeout:15000})});}
 async validateOffer(offer:any){const a=this.clients.get(offer.stripe_account);if(!a)return false;const p=await a.stripe.prices.retrieve(offer.price_id,{expand:['product']});return p.active&&!p.recurring&&p.billing_scheme==='per_unit'&&p.unit_amount===offer.unit_amount&&p.currency===offer.currency&&typeof p.product!=='string'&&!p.product.deleted&&p.product.active;}
 async checkout(leadId:string,offerId:string,origin:string){
 const o=(await this.store.db.query("select * from manager_operator.offers where id=$1 and active and ready and verified_at>now()-interval '24 hours'",[offerId])).rows[0];
 const lead=(await this.store.db.query('select * from manager_operator.leads where id=$1',[leadId])).rows[0];
 if(!o||!lead||!await this.validateOffer(o))return {available:false};
 const a=this.clients.get(o.stripe_account)!;
 const quote=(await this.store.db.query(`insert into manager_operator.quotes(id,lead_id,offer_id,period) values($1,$2,$3,$4) on conflict(lead_id,offer_id,period) do update set lead_id=excluded.lead_id returning *`,[randomUUID(),leadId,offerId,Math.floor(Date.now()/86400000)])).rows[0];
 if(quote.url&&Date.parse(quote.expires_at)>Date.now())return {available:true,url:quote.url,quote_id:quote.id};
 const tag=createHash('sha256').update(quote.id).digest('hex').slice(0,8).split('').map(x=>String.fromCharCode(97+parseInt(x,16))).join('');
 const session=await a.stripe.checkout.sessions.create({mode:'payment',line_items:[{price:o.price_id,quantity:1}],customer_email:lead.email,client_reference_id:lead.id,success_url:origin+'/purchase-complete',cancel_url:origin+'/purchase-cancelled',metadata:{manager_offer_id:o.id},integration_identifier:'trillionai_manager_'+tag},{idempotencyKey:'manager-quote:'+quote.id});
 await this.store.db.query('update manager_operator.quotes set url=$2,expires_at=to_timestamp($3) where id=$1',[quote.id,session.url,session.expires_at]);
 return {available:true,url:session.url,quote_id:quote.id};
 }
 async handle(account:string,body:Buffer,signature:string,stored=false){
 const a=this.clients.get(account);if(!a)throw new Error('BILLING_ACCOUNT_UNKNOWN');
 const event=a.stripe.webhooks.constructEvent(body,signature,a.config.webhookSecret,stored?0:300);
 const obj=event.data.object as any;
 if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
 const session=await a.stripe.checkout.sessions.retrieve(obj.id);
 if(session.payment_status!=='paid'||!session.amount_total)return;
 const lines=await a.stripe.checkout.sessions.listLineItems(session.id,{limit:2});
 if(lines.has_more||lines.data.length!==1||lines.data[0]?.quantity!==1)throw new Error('CHECKOUT_LINE_ITEMS_UNSUPPORTED');
 const line=lines.data[0]!;
 const offer=(await this.store.db.query('select * from manager_operator.offers where price_id=$1 and stripe_account=$2',[line.price?.id,account])).rows[0];
 if(!offer)return; // Unrelated product in the same Stripe account. Do not capture or deliver it.
 const email=session.customer_details?.email?.toLowerCase();if(!email)throw new Error('CUSTOMER_EMAIL_REQUIRED');
 const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
 // Recurring run-rate is tracked below. Subscription fulfillment requires invoice adapter qualification.
 if(!intent)throw new Error('SUBSCRIPTION_FULFILLMENT_REQUIRES_INVOICE_ADAPTER');
 await this.store.recordPayment({id:account+':'+event.id,livemode:session.livemode,session_id:session.id,payment_intent:intent,customer_id:typeof session.customer==='string'?session.customer:email,email,offer_id:offer.id,amount:session.amount_total,currency:session.currency!,external_customer:!a.config.ownerEmails.map(x=>x.toLowerCase()).includes(email)});
 }
 if(event.type==='charge.refunded'){
 const charge=await a.stripe.charges.retrieve(obj.id);const pi=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
 if(pi)await this.store.refund(account+':'+event.id,pi,charge.amount_refunded);
 }
 if(event.type.startsWith('customer.subscription.')){
 const sub=await a.stripe.subscriptions.retrieve(obj.id);let monthly=0;let currency:string|undefined;
 for(const item of sub.items.data){
 const offer=(await this.store.db.query('select * from manager_operator.offers where price_id=$1 and stripe_account=$2',[item.price.id,account])).rows[0];
 if(!offer)continue;const p=item.price;const rec=p.recurring;if(!rec||p.unit_amount===null)continue;
 if(currency&&currency!==p.currency)throw new Error('MIXED_SUBSCRIPTION_CURRENCY');currency=p.currency;
 const months=rec.interval==='year'?12*rec.interval_count:rec.interval==='month'?rec.interval_count:rec.interval==='week'?rec.interval_count*12/52:rec.interval_count*12/365;
 monthly+=p.unit_amount*(item.quantity??1)/months;
 }
 if(currency)await this.store.db.query(`insert into manager_operator.subscriptions(id,customer_id,currency,monthly_amount,status,livemode,event_created) values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do update set monthly_amount=excluded.monthly_amount,status=excluded.status,event_created=excluded.event_created where manager_operator.subscriptions.event_created<=excluded.event_created`,[sub.id,typeof sub.customer==='string'?sub.customer:sub.customer.id,currency,monthly,sub.status,sub.livemode,event.created]);
 }
 }
}
