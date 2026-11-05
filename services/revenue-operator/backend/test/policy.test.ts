import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvalRequired, rankOffers, qualifiesAsFirstCustomer} from '../src/policy.js';
test('strategic actions always require owner approval even at zero cost',()=>{
 for(const action of ['borrow','hire','fire','legal','pricing','new_division','enterprise','security_high_risk','strategy']) assert.equal(approvalRequired(action,0,100),true);
 assert.equal(approvalRequired('acquire',0,0),false);
 assert.equal(approvalRequired('acquire',1,0),true);
 assert.equal(approvalRequired('unknown',0,0),true);
});
test('only fresh evidenced sellable offers are ranked by margin and verified demand',()=>{
 const now=Date.now();
 const good={id:'a',ready:true,verified_at:new Date(now).toISOString(),unit_amount:1000,cost_amount:200,demand:2};
 assert.deepEqual(rankOffers([good,{...good,id:'stale',verified_at:'2020-01-01'},{...good,id:'notready',ready:false}],now).map(x=>x.id),['a']);
});
test('only live paid positive external customer counts, never test or refunded',()=>{
 const o={livemode:true,paid:true,amount:100,refunded:0,external_customer:true};
 assert.equal(qualifiesAsFirstCustomer(o),true);
 for(const patch of [{livemode:false},{amount:0},{refunded:100},{external_customer:false},{paid:false}]) assert.equal(qualifiesAsFirstCustomer({...o,...patch}),false);
});
