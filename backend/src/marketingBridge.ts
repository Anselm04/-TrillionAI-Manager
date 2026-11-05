import {createHmac, timingSafeEqual} from 'node:crypto';
import type {State} from './domain.ts';
import {audit} from './domain.ts';
import {commerce} from './commerce.ts';
import {saveBrief,confirmBrief,listBriefs,chooseMeasurement,submitGrowth,growthState} from './customerIntake.ts';
import {growthAssessment,reviewGrowthRecommendation,eraseGrowthFeedback} from './growthRecommendations.ts';
import {automationStatus,setAutomationPolicy} from './customerAutomation.ts';

export function validateMarketingSignature(raw:Buffer,timestamp:string,signature:string,secret:string,now=Date.now()) {
 if(typeof secret!=='string'||secret.length<32)throw Error('marketing_bridge_not_configured');
 if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>120000)throw Error('unauthorized');
 if(!/^[a-f0-9]{64}$/i.test(signature))throw Error('unauthorized');
 const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
 const provided=Buffer.from(signature,'hex');
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected))throw Error('unauthorized');
}
function safeMarketingSignals(raw:any){
 if(!raw || typeof raw!=='object'||raw.source!=='marketing_server_aggregate')return null;
 const names=['campaignCount','providerVerifiedPairedCampaigns','providerVerifiedRevenueCampaigns','providerVerifiedSpendCampaigns','unattributedLeadCount'] as const;
 if(names.some(name=>!Number.isSafeInteger(raw[name])||raw[name]<0||raw[name]>10000000))return null;
 if(raw.providerVerifiedPairedCampaigns>raw.campaignCount
 ||raw.providerVerifiedRevenueCampaigns>raw.campaignCount
 ||raw.providerVerifiedSpendCampaigns>raw.campaignCount)return null;
 return {
  campaignCount:raw.campaignCount,
  providerVerifiedPairedCampaigns:raw.providerVerifiedPairedCampaigns,
  providerVerifiedRevenueCampaigns:raw.providerVerifiedRevenueCampaigns,
  providerVerifiedSpendCampaigns:raw.providerVerifiedSpendCampaigns,
  unattributedLeadCount:raw.unattributedLeadCount,
  providerCoverage:raw.campaignCount===0?'none':raw.providerVerifiedPairedCampaigns===raw.campaignCount?'full':'partial_or_none',
  revenueAmountsShared:false,
  attributionProven:false,
  note:'Marketing platform counts are separate from customer-reported growth. Provider verification of campaign metrics does not establish incremental customer revenue.',
 };
}
export function marketingCommand(s:State,p:any,now=Date.now()) {
 if(!p || typeof p!=='object'||Array.isArray(p)||typeof p.sourceUserId!=='string'
    || !/^[a-zA-Z0-9._:-]{1,120}$/.test(p.sourceUserId)
    || typeof p.requestId!=='string'|| !/^[a-zA-Z0-9:_-]{16,120}$/.test(p.requestId)) throw Error('invalid_marketing_bridge_command');
 const allowed=new Set(['brief.save','brief.confirm','brief.list','growth.preferences','growth.submit','growth.state','growth.assess','growth.review','growth.erase','automation.status','automation.set']);
 if(!allowed.has(p.operation))throw Error('invalid_marketing_bridge_command');
 const c=commerce(s);c.bridgeRequests??=[];
 const customerId='marketing:'+p.sourceUserId;
 const key=customerId+':'+p.requestId;
 const isReadOnly=['growth.state','growth.assess','brief.list','automation.status'].includes(p.operation);
 const prior=isReadOnly?undefined:c.bridgeRequests.find((r:any)=>r.key===key);
 if(prior){
  if(prior.operation!==p.operation)throw Error('marketing_request_conflict');
  return prior.result;
 }
 let result:any;
 switch(p.operation){
  case 'brief.save':result=saveBrief(s,customerId,p.payload,now);break;
  case 'brief.confirm':
   if(typeof p.payload?.id!=='string')throw Error('invalid_marketing_bridge_command');
   result=confirmBrief(s,customerId,p.payload.id,p.payload,now);break;
  case 'brief.list':result=listBriefs(s,customerId);break;
  case 'growth.preferences':result=chooseMeasurement(s,customerId,p.payload,now);break;
  case 'growth.submit':result=submitGrowth(s,customerId,p.payload,now);break;
  case 'growth.state':result=growthState(s,customerId);break;
  case 'growth.assess':result={...growthAssessment(s,customerId,now),marketingSignals:safeMarketingSignals(p.payload?.analytics)};break;
  case 'growth.review':result=reviewGrowthRecommendation(s,customerId,p.payload,now);break;
  case 'growth.erase':result=eraseGrowthFeedback(s,customerId,now);break;
  case 'automation.status':result=automationStatus(s,customerId);break;
  case 'automation.set':result=setAutomationPolicy(s,customerId,p.payload,now);break;
 }
 // A stable client-generated request ID prevents duplicated side effects after network failures.
 // This bounded journal is temporary; high-volume operations require normalized storage.
 if(!isReadOnly)c.bridgeRequests.push({key,operation:p.operation,result,at:now});
 if(c.bridgeRequests.length>5000)c.bridgeRequests.splice(0,c.bridgeRequests.length-5000);
 audit(s,'marketing.bridge_command',{operation:p.operation,sourceCustomer:customerId},now);
 return result;
}
