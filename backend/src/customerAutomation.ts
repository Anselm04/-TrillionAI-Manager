import type {State} from './domain.ts';
import {audit} from './domain.ts';
import {commerce} from './commerce.ts';

export type AutomationMode='manual'|'semi'|'full';
const policyVersion='customer-automation-policy-v1';
const allowedActions=['draft_campaigns','schedule_approved_organic','review_results','recommend_optimisations'] as const;
type AutomationAction=typeof allowedActions[number];
const allowedPlatforms=new Set(['facebook','instagram','youtube','tiktok','linkedin','pinterest','x']);

export function hasVerifiedManagerAutomation(s:State,customerId:string){
 const c=commerce(s);
 const activePaid=s.payments.filter(p=>p.managerCustomerId===customerId && !p.refunded && Number(p.amountMinor)>0);
 return activePaid.some(p=>{
  const offer=s.offers.find(o=>o.id===p.offerId && o.system==='manager' && o.managerAutomationAccess===true);
  if(!offer || offer.billingMode!=='subscription'||!p.subscriptionId)return false;
  const sub=s.subscriptions.find(x=>x.id===p.subscriptionId);
  if(!sub || !['active','trialing'].includes(sub.status) || sub.cancelled===true)return false;
  const entitlement=c.entitlements.find(e=>e.customerId===customerId&&e.offerId===offer.id&&e.status==='active');
  return !!entitlement;
 });
}
export function automationStatus(s:State,customerId:string){
 const c=commerce(s);
 const verified=hasVerifiedManagerAutomation(s,customerId);
 const saved=(c.customerAutomationPolicies||[]).find((p:any)=>p.customerId===customerId);
 const current=saved && (verified||saved.mode==='manual')?saved:{customerId,mode:'manual',actions:[],platforms:[],maxSpendMinor:0,version:policyVersion};
 return {paidManagerAutomationVerified:verified,availableModes:verified?['manual','semi','full']:['manual'],policy:current,effectiveMode:current.mode,automaticAdvertisingSpendAuthorized:false,executionEnabled:false};
}
export function setAutomationPolicy(s:State,customerId:string,p:any,now=Date.now()){
 if(!p || typeof p!=='object'||Array.isArray(p))throw Error('invalid_automation_policy');
 if(!['manual','semi','full'].includes(p.mode)||p.acknowledged!==true||p.version!==policyVersion)throw Error('invalid_automation_policy');
 if(!Array.isArray(p.actions)||p.actions.length>allowedActions.length||p.actions.some((x:unknown)=>!allowedActions.includes(x as AutomationAction)))throw Error('invalid_automation_policy');
 if(!Array.isArray(p.platforms)||p.platforms.length>allowedPlatforms.size||p.platforms.some((x:unknown)=>!allowedPlatforms.has(String(x))))throw Error('invalid_automation_policy');
 if(!Number.isSafeInteger(p.maxSpendMinor)||p.maxSpendMinor!==0)throw Error('paid_spend_requires_separate_authorisation');
 const verified=hasVerifiedManagerAutomation(s,customerId);
 if(p.mode!=='manual'&&!verified)throw Error('manager_subscription_required');
 if(p.mode==='manual'&&p.actions.length)throw Error('invalid_automation_policy');
 if(p.mode!=='manual'&&p.platforms.length===0)throw Error('automation_platforms_required');
 const policy={customerId,mode:p.mode,actions:[...new Set(p.actions)],platforms:[...new Set(p.platforms)],maxSpendMinor:0,version:policyVersion,acknowledgedAt:now,updatedAt:now};
 const c=commerce(s);c.customerAutomationPolicies??=[];
 const ix=c.customerAutomationPolicies.findIndex((x:any)=>x.customerId===customerId);
 if(ix<0)c.customerAutomationPolicies.push(policy);else c.customerAutomationPolicies[ix]=policy;
 audit(s,'customer.automation_policy',{customerId,mode:policy.mode,platformCount:policy.platforms.length,spendMinor:0},now);
 return automationStatus(s,customerId);
}
