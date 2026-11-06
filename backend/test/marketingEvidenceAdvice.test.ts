import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {marketingCommand} from '../src/marketingBridge.ts';
import {chooseMeasurement} from '../src/customerIntake.ts';

const request=(sourceUserId:string,analytics:any)=>({
 sourceUserId,operation:'growth.assess',requestId:'evidence-'+sourceUserId.padEnd(18,'0'),payload:{analytics}
});
test('Manager explains marketing evidence gaps without asserting incremental revenue',()=>{
 const s=initial();
 chooseMeasurement(s,'marketing:client-a',{level:'summary',cadence:'monthly',understoodLimitations:true});
 const none=marketingCommand(s,request('client-a',{source:'marketing_server_aggregate',campaignCount:2,providerVerifiedPairedCampaigns:0,providerVerifiedRevenueCampaigns:0,providerVerifiedSpendCampaigns:0,unattributedLeadCount:1}));
 assert.match(none.measurementAdvice,/No campaign has paired/);
 assert.equal(none.marketingIncreasedRevenueProven,false);
 assert.equal(none.automaticOptimisationExecuted,false);
 const covered=marketingCommand(s,request('client-a',{source:'marketing_server_aggregate',campaignCount:2,providerVerifiedPairedCampaigns:1,providerVerifiedRevenueCampaigns:1,providerVerifiedSpendCampaigns:1,unattributedLeadCount:1}));
 assert.match(covered.measurementAdvice,/incremental sales and profitability are still unproven/);
 assert.equal(covered.marketingIncreasedRevenueProven,false);
 assert.equal(s.tasks.length,0);
});
test('Invalid or fabricated evidence receives no numerical credibility',()=>{
 const s=initial();
 chooseMeasurement(s,'marketing:client-b',{level:'summary',cadence:'monthly',understoodLimitations:true});
 const r=marketingCommand(s,request('client-b',{source:'untrusted_client',campaignCount:99999999,providerVerifiedPairedCampaigns:99999999}));
 assert.equal(r.marketingSignals,null);
 assert.match(r.measurementAdvice,/No verified campaign coverage/);
});
