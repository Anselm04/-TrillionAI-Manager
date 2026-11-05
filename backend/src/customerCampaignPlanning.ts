import {randomUUID} from 'node:crypto';
import type {State} from './domain.ts';
import {audit} from './domain.ts';
import {commerce} from './commerce.ts';
import {automationStatus} from './customerAutomation.ts';

type CampaignProposal={
 id:string,customerId:string,briefId:string,briefRevision:number,status:'proposed'|'approved_for_production'|'declined',
 title:string,objective:string,targetAudience:string,offer:string,platforms:string[],deliverables:string[],
 budgetMinor:0,executionAuthorized:false,published:false,createdAt:number,reviewedAt?:number
};
export function listCampaignProposals(s:State,customerId:string):CampaignProposal[]{
 return (commerce(s).customerCampaignProposals||[]).filter((x:any)=>x.customerId===customerId);
}
export function proposeCampaign(s:State,customerId:string,p:any,now=Date.now()):CampaignProposal {
 const access=automationStatus(s,customerId);
 if(!access.paidManagerAutomationVerified||access.effectiveMode==='manual'||!access.policy.actions.includes('draft_campaigns'))
  throw Error('manager_subscription_required');
 if(!p||typeof p!=='object'||typeof p.briefId!=='string')throw Error('invalid_campaign_proposal');
 const brief=(commerce(s).briefs||[]).find((x:any)=>x.id===p.briefId&&x.customerId===customerId&&x.status==='confirmed');
 if(!brief)throw Error('confirmed_brief_required');
 const platforms=access.policy.platforms;
 if(!platforms.length)throw Error('automation_platforms_required');
 const proposals=listCampaignProposals(s,customerId);
 if(proposals.length>=100)throw Error('campaign_proposal_limit');
 const row:CampaignProposal={
  id:randomUUID(),customerId,briefId:brief.id,briefRevision:brief.revision,
  status:'proposed',
  title:'Campaign proposal for '+brief.business.slice(0,100),
  objective:brief.goal,targetAudience:brief.audience,offer:brief.offer,
  platforms:[...platforms],deliverables:['Campaign strategy outline','Draft messaging for customer review','Publishing schedule proposal'],
  budgetMinor:0,executionAuthorized:false,published:false,createdAt:now,
 };
 const holder=commerce(s);
 const plans=holder.customerCampaignProposals??(holder.customerCampaignProposals=[]);
 plans.push(row);
 audit(s,'customer.campaign_proposed',{customerId,proposalId:row.id,platformCount:row.platforms.length,executionAuthorized:false},now);
 return row;
}
export function reviewCampaignProposal(s:State,customerId:string,p:any,now=Date.now()):CampaignProposal{
 if(!p||typeof p.id!=='string'||!['approve','decline'].includes(p.decision))throw Error('invalid_campaign_review');
 const row=listCampaignProposals(s,customerId).find(x=>x.id===p.id);
 if(!row)throw Error('campaign_proposal_not_found');
 if(row.status!=='proposed'){
  if((row.status==='approved_for_production'&&p.decision==='approve')||(row.status==='declined'&&p.decision==='decline'))return row;
  throw Error('campaign_proposal_already_reviewed');
 }
 // Review approval is NOT publishing approval or authority to spend. Subscription
 // cannot be bypassed by retaining an old proposal after cancelling the plan.
 if(p.decision==='approve'&&!automationStatus(s,customerId).paidManagerAutomationVerified)throw Error('manager_subscription_required');
 row.status=p.decision==='approve'?'approved_for_production':'declined';
 row.reviewedAt=now;
 audit(s,'customer.campaign_reviewed',{customerId,proposalId:row.id,decision:p.decision,executionAuthorized:false},now);
 return row;
}
