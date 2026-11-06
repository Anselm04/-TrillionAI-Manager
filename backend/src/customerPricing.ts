import {randomUUID} from 'node:crypto';
import type {State} from './domain.ts';
import {audit,sellable} from './domain.ts';
import {commerce} from './commerce.ts';

function words(raw:string):Set<string>{return new Set(raw.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]);}
function eligibleOffer(o:any,now:number):boolean {
 return o?.system==='marketing' && sellable(o,now) &&
  o.pricingApproved===true && o.fullCostReviewed===true &&
  typeof o.taxDisclosure==='string' && o.taxDisclosure.trim().length>=8 &&
  typeof o.scopeDisclosure==='string' && o.scopeDisclosure.trim().length>=12 &&
  Array.isArray(o.approvedClaims);
}
export function customerQuoteOptions(s:State,customerId:string,briefId:string,now=Date.now()){
 const brief=(commerce(s).briefs||[]).find((x:any)=>x.id===briefId&&x.customerId===customerId&&x.status==='confirmed');
 if(!brief)throw Error('confirmed_brief_required');
 const terms=words([brief.business,brief.offer,brief.audience,brief.goal].join(' '));
 const results=s.offers.filter(o=>eligibleOffer(o,now)).map(o=>{
  const keywords=words([o.name,...(o.keywords||[]),...(o.approvedClaims||[])].join(' '));
  const score=[...terms].filter(w=>keywords.has(w)).length;
  return {o,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.o.marginMinor-a.o.marginMinor).slice(0,3);
 return {briefId,verifiedOptionCount:results.length,options:results.map(({o})=>({
   offerId:o.id,name:o.name,priceMinor:o.priceMinor,currency:o.currency,
   billingMode:o.billingMode||'payment',billingInterval:o.billingInterval||null,
   taxDisclosure:o.taxDisclosure,scopeDisclosure:o.scopeDisclosure,
   includedClaims:o.approvedClaims,
 })),message:results.length?'These are owner-approved published offers, not guaranteed results. Final scope is shown before payment.':'No verified costed package currently matches your brief. Your request needs a personalised pricing review; we will not invent a quotation.'};
}
export function prepareCustomerQuote(s:State,customerId:string,p:any,now=Date.now()){
 if(!p||typeof p!=='object'||typeof p.briefId!=='string'||typeof p.offerId!=='string')throw Error('invalid_customer_quote');
 const options=customerQuoteOptions(s,customerId,p.briefId,now);
 if(!options.options.some(o=>o.offerId===p.offerId))throw Error('quote_option_not_available');
 const offer=s.offers.find(o=>o.id===p.offerId);
 const c=commerce(s);
 const existing=c.quotes.find(q=>q.customerId===customerId&&q.briefId===p.briefId&&q.offerId===p.offerId&&q.status==='offered'&&q.expiresAt>now);
 if(existing)return existing;
 // A Marketing-authenticated ID is not a verified Manager billing identity.
 // Suppress checkout until the customer explicitly links and verifies accounts.
 const checkoutReady=!customerId.startsWith('marketing:') && c.customers.some((person:any)=>person.id===customerId&&typeof person.userId==='string'&&person.userId.length>0);
 const quote={
  id:randomUUID(),customerId,briefId:p.briefId,offerId:offer.id,
  name:offer.name,priceMinor:offer.priceMinor,currency:offer.currency,
  mode:offer.billingMode||'payment',billingInterval:offer.billingInterval||null,
  taxDisclosure:offer.taxDisclosure,scopeDisclosure:offer.scopeDisclosure,
  includedClaims:[...offer.approvedClaims],status:'offered',createdAt:now,
  expiresAt:now+7*86400000,purchaseUrl:checkoutReady?offer.purchaseUrl:null,checkoutReady,checkoutMessage:checkoutReady?'Review the secure checkout before agreeing to payment.':'Checkout is unavailable until the Marketing customer identity is securely linked and verified with Manager.',source:'confirmed_customer_brief',
  paymentVerified:false,workAuthorized:false,
 };
 c.quotes.push(quote);
 audit(s,'customer.quote_prepared',{customerId,quoteId:quote.id,offerId:offer.id,amountMinor:quote.priceMinor,currency:quote.currency},now);
 return quote;
}
export function listCustomerQuotes(s:State,customerId:string){
 return commerce(s).quotes.filter(q=>q.customerId===customerId&&q.source==='confirmed_customer_brief');
}
