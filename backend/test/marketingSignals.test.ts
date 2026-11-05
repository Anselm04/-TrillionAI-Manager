import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {marketingCommand} from '../src/marketingBridge.ts';
const cmd=(payload:any)=>({sourceUserId:'customer-a',operation:'growth.assess',requestId:'assess-1234567890123',payload});
test('signed marketing assessment only returns validated coverage counts',()=>{
 const s=initial();
 const out=marketingCommand(s,cmd({analytics:{source:'marketing_server_aggregate',campaignCount:10,providerVerifiedPairedCampaigns:4,providerVerifiedRevenueCampaigns:5,providerVerifiedSpendCampaigns:6,unattributedLeadCount:12,revenue:9000000}}));
 assert.equal(out.marketingSignals?.campaignCount,10);
 assert.equal(out.marketingSignals?.providerCoverage,'partial_or_none');
 assert.equal(out.marketingSignals?.revenueAmountsShared,false);
 assert.equal(JSON.stringify(out).includes('9000000'),false);
 assert.equal(out.marketingSignals?.attributionProven,false);
});
test('invalid or exaggerated platform evidence does not enter Manager recommendations',()=>{
 const s=initial();
 const out=marketingCommand(s,cmd({analytics:{source:'marketing_server_aggregate',campaignCount:1,providerVerifiedPairedCampaigns:99,providerVerifiedRevenueCampaigns:1,providerVerifiedSpendCampaigns:1,unattributedLeadCount:0}}));
 assert.equal(out.marketingSignals,null);
 const second=marketingCommand(s,cmd({analytics:{source:'customer_input',campaignCount:1,providerVerifiedPairedCampaigns:0,providerVerifiedRevenueCampaigns:0,providerVerifiedSpendCampaigns:0,unattributedLeadCount:0}}));
 assert.equal(second.marketingSignals,null);
});
