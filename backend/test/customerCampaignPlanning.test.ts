import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {commerce} from '../src/commerce.ts';
import {saveBrief,confirmBrief} from '../src/customerIntake.ts';
import {setAutomationPolicy} from '../src/customerAutomation.ts';
import {listCampaignProposals,proposeCampaign,reviewCampaignProposal} from '../src/customerCampaignPlanning.ts';
import {marketingCommand} from '../src/marketingBridge.ts';

function givePaidPermission(s:ReturnType<typeof initial>,id:string){
 s.offers.push({id:'manager-plan',system:'manager',managerAutomationAccess:true,billingMode:'subscription'});
 s.payments.push({id:'p-'+id,managerCustomerId:id,offerId:'manager-plan',amountMinor:6000,subscriptionId:'sub-'+id,refunded:false});
 s.subscriptions.push({id:'sub-'+id,status:'active'});
 commerce(s).entitlements.push({customerId:id,offerId:'manager-plan',status:'active'});
 setAutomationPolicy(s,id,{mode:'semi',actions:['draft_campaigns'],platforms:['facebook'],maxSpendMinor:0,version:'customer-automation-policy-v1',acknowledged:true});
}
function confirm(s:ReturnType<typeof initial>,id:string){
 const b=saveBrief(s,id,{business:'Wood carving workshop',offer:'Bespoke carved furniture',audience:'Homeowners in Manawatu',goal:'More qualified custom furniture enquiries',channels:['facebook']});
 return confirmBrief(s,id,b.id,{revision:b.revision,confirmed:true,acknowledgementVersion:'customer-brief-v1'});
}
test('self service cannot create Manager proposals or bypass confirmed briefs',()=>{
 const s=initial();const brief=confirm(s,'customer-a');
 assert.throws(()=>proposeCampaign(s,'customer-a',{briefId:brief.id}),/manager_subscription_required/);
 givePaidPermission(s,'customer-a');
 assert.throws(()=>proposeCampaign(s,'customer-a',{briefId:'not-owned'}),/confirmed_brief_required/);
});
test('customer proposal approval does not publish, spend or create tasks',()=>{
 const s=initial();givePaidPermission(s,'customer-a');const brief=confirm(s,'customer-a');
 const plan=proposeCampaign(s,'customer-a',{briefId:brief.id});
 assert.equal(plan.status,'proposed');
 assert.deepEqual(plan.platforms,['facebook']);
 assert.equal(plan.executionAuthorized,false);
 assert.equal(plan.budgetMinor,0);
 assert.equal(plan.published,false);
 assert.equal(listCampaignProposals(s,'customer-b').length,0);
 assert.throws(()=>reviewCampaignProposal(s,'customer-b',{id:plan.id,decision:'approve'}),/campaign_proposal_not_found/);
 const reviewed=reviewCampaignProposal(s,'customer-a',{id:plan.id,decision:'approve'});
 assert.equal(reviewed.status,'approved_for_production');
 assert.equal(reviewed.executionAuthorized,false);
 assert.equal(s.tasks.length,0);
 s.subscriptions[0].status='canceled';
 assert.throws(()=>proposeCampaign(s,'customer-a',{briefId:brief.id}),/manager_subscription_required/);
});
test('Marketing bridge list and proposal requests cannot access another tenant',()=>{
 const s=initial();givePaidPermission(s,'marketing:user-a');const brief=confirm(s,'marketing:user-a');
 const call=(sourceUserId:string,operation:string,requestId:string,payload:any={})=>marketingCommand(s,{sourceUserId,operation,requestId,payload});
 const a=call('user-a','campaign.propose','proposal-new-12345678',{briefId:brief.id});
 assert.equal(a.status,'proposed');
 assert.equal(call('user-b','campaign.list','list-user-b-123456').length,0);
 assert.throws(()=>call('user-b','campaign.review','review-user-b-12345',{id:a.id,decision:'approve'}),/campaign_proposal_not_found/);
 const b=call('user-a','campaign.list','list-user-a-123456');
 assert.equal(b.length,1);
});
