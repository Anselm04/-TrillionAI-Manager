import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {saveBrief,confirmBrief} from '../src/customerIntake.ts';
import {customerQuoteOptions,prepareCustomerQuote,listCustomerQuotes} from '../src/customerPricing.ts';
import {marketingCommand} from '../src/marketingBridge.ts';

function brief(s:ReturnType<typeof initial>,id:string){
 const draft=saveBrief(s,id,{business:'Carved wooden furniture studio',offer:'Custom carved furniture',audience:'Homeowners around Manawatu',goal:'Increase qualified enquiries about wooden furniture',channels:['facebook']});
 return confirmBrief(s,id,draft.id,{confirmed:true,revision:draft.revision,acknowledgementVersion:'customer-brief-v1'});
}
function ready(now:number){
 return {id:'marketing-furniture',name:'Furniture marketing service',system:'marketing',active:true,
 priceMinor:100000,marginMinor:42000,currency:'nzd',stripePriceId:'price_marketing123',checkoutUrl:'https://buy.stripe.com/verified',
 purchaseUrl:'https://example.com/buy/marketing-furniture',keywords:['furniture'],approvedClaims:['Marketing for handmade furniture'],
 pricingApproved:true,fullCostReviewed:true,taxDisclosure:'Price includes NZ GST when applicable.',scopeDisclosure:'Four customer-approved organic social campaigns, with two revision rounds.',
 evidence:{checkout:true,delivery:true,legal:true,product:true,checkedAt:now,evidenceUrl:'https://example.com/evidence/marketing'},
 conversionEstimate:0.2};
}
test('unready or uncosted offers never become customer quotations',()=>{
 const s=initial();const now=Date.now();const b=brief(s,'person');
 const o=ready(now);delete (o as any).taxDisclosure;s.offers.push(o);
 let options=customerQuoteOptions(s,'person',b.id,now);
 assert.equal(options.verifiedOptionCount,0);
 assert.match(options.message,/will not invent/i);
 assert.throws(()=>prepareCustomerQuote(s,'person',{briefId:b.id,offerId:o.id},now),/quote_option_not_available/);
 (o as any).taxDisclosure='Price includes NZ GST when applicable.';
 (o as any).evidence.checkedAt=now-90000000;
 assert.equal(customerQuoteOptions(s,'person',b.id,now).verifiedOptionCount,0);
});
test('customer gets only owner-approved exact prices and scopes with no execution',()=>{
 const s=initial();const now=Date.now();const b=brief(s,'person');
 const o=ready(now);s.offers.push(o);
 const options=customerQuoteOptions(s,'person',b.id,now);
 assert.equal(options.verifiedOptionCount,1);
 assert.equal(options.options[0].priceMinor,100000);
 assert.equal(options.options[0].currency,'nzd');
 assert.equal(options.options[0].scopeDisclosure,o.scopeDisclosure);
 assert.throws(()=>customerQuoteOptions(s,'other',b.id,now),/confirmed_brief_required/);
});
test('prepared quote snapshots source price and prevents account leaks',()=>{
 const s=initial();const now=Date.now();const b=brief(s,'person');s.offers.push(ready(now));
 const q=prepareCustomerQuote(s,'person',{briefId:b.id,offerId:'marketing-furniture'},now);
 assert.equal(q.paymentVerified,false);assert.equal(q.workAuthorized,false);assert.equal(q.priceMinor,100000);
 assert.equal(q.checkoutReady,false);
 assert.equal(q.purchaseUrl,null);
 assert.equal(prepareCustomerQuote(s,'person',{briefId:b.id,offerId:'marketing-furniture'},now).id,q.id);
 assert.equal(listCustomerQuotes(s,'other').length,0);
 assert.equal(s.tasks.length,0);
 assert.throws(()=>prepareCustomerQuote(s,'other',{briefId:b.id,offerId:'marketing-furniture'},now),/confirmed_brief_required/);
});
test('signed bridge returns only customer-owned costed offers',()=>{
 const s=initial();const now=Date.now();const b=brief(s,'marketing:alice');s.offers.push(ready(now));
 const cmd=(sourceUserId:string,operation:string,requestId:string,payload:any)=>marketingCommand(s,{sourceUserId,operation,requestId,payload},now);
 const opts=cmd('alice','quote.options','quote-options-1234567',{briefId:b.id});
 assert.equal(opts.options.length,1);
 const q=cmd('alice','quote.prepare','quote-prepare-1234567',{briefId:b.id,offerId:opts.options[0].offerId});
 assert.equal(q.source,'confirmed_customer_brief');
 assert.equal(q.checkoutReady,false);
 assert.equal(q.purchaseUrl,null);
 assert.equal(cmd('bob','quote.list','quote-list-bob-123456',{}).length,0);
});
