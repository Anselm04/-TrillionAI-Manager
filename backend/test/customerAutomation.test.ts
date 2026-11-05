import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {automationStatus,setAutomationPolicy,hasVerifiedManagerAutomation} from '../src/customerAutomation.ts';
import {commerce} from '../src/commerce.ts';
const version='customer-automation-policy-v1';
const input=(mode:'manual'|'semi'|'full')=>({mode,actions:mode==='manual'?[]:['draft_campaigns','schedule_approved_organic'],platforms:mode==='manual'?[]:['facebook'],maxSpendMinor:0,acknowledged:true,version});
test('self-service customers default to manual-only and cannot enable autonomous execution',()=>{
 const s=initial();
 assert.deepEqual(automationStatus(s,'customer-1').availableModes,['manual']);
 assert.equal(automationStatus(s,'customer-1').executionEnabled,false);
 assert.throws(()=>setAutomationPolicy(s,'customer-1',input('full')),/manager_subscription_required/);
 assert.throws(()=>setAutomationPolicy(s,'customer-1',{...input('manual'),maxSpendMinor:100}),/paid_spend_requires_separate_authorisation/);
 assert.equal(setAutomationPolicy(s,'customer-1',input('manual')).effectiveMode,'manual');
});
test('a Marketing subscription never impersonates paid Manager automation',()=>{
 const s=initial();
 s.offers.push({id:'marketing',system:'marketing',managerAutomationAccess:true,billingMode:'subscription'});
 s.payments.push({id:'p1',managerCustomerId:'customer-1',offerId:'marketing',amountMinor:1000,subscriptionId:'sub1',refunded:false});
 s.subscriptions.push({id:'sub1',status:'active'});
 commerce(s).entitlements.push({customerId:'customer-1',offerId:'marketing',status:'active'});
 assert.equal(hasVerifiedManagerAutomation(s,'customer-1'),false);
 assert.throws(()=>setAutomationPolicy(s,'customer-1',input('semi')),/manager_subscription_required/);
});
test('verified Manager subscription can store scoped controls without executing tasks',()=>{
 const s=initial();
 s.offers.push({id:'manager-plan',system:'manager',managerAutomationAccess:true,billingMode:'subscription'});
 s.payments.push({id:'p2',managerCustomerId:'customer-1',offerId:'manager-plan',amountMinor:5000,subscriptionId:'sub2',refunded:false});
 s.subscriptions.push({id:'sub2',status:'active'});
 commerce(s).entitlements.push({customerId:'customer-1',offerId:'manager-plan',status:'active'});
 const result=setAutomationPolicy(s,'customer-1',input('full'));
 assert.equal(result.effectiveMode,'full');
 assert.equal(result.executionEnabled,false);
 assert.equal(result.automaticAdvertisingSpendAuthorized,false);
 assert.equal(s.tasks.length,0);
 assert.equal(automationStatus(s,'customer-2').effectiveMode,'manual');
 // Payment failure or cancellation immediately removes effective automation.
 s.subscriptions[0].status='canceled';
 assert.equal(automationStatus(s,'customer-1').effectiveMode,'manual');
});
