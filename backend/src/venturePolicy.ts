import {createHash} from 'node:crypto';
export type Proposal = {id:string; revision:number; budgetMinor:number; currency:string; actions:string[]; suppliers:string[]; expiresAt:number; transactionLimitMinor:number; forecastRevenueMinor:number; forecastCostMinor:number; evidenceIds:string[]; kind:'venture'|'upgrade'|'maintenance'; description:string};
export type Request = {id:string; action:string; supplier:string; amountMinor:number; currency:string};
const money=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const ident=(s:string)=>typeof s==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(s);
const ids=(a:string[])=>Array.isArray(a)&&a.length>0&&a.length<=100&&a.every(ident)&&new Set(a).size===a.length;
export function proposalDigest(p:Proposal):string {
 if(!ident(p.id)||!Number.isSafeInteger(p.revision)||p.revision<1||!money(p.budgetMinor)||!money(p.transactionLimitMinor)||p.transactionLimitMinor>p.budgetMinor||!money(p.forecastRevenueMinor)||!money(p.forecastCostMinor)||!money(p.expiresAt)||!['venture','upgrade','maintenance'].includes(p.kind)||!/^[A-Z]{3}$/.test(p.currency)||!ids(p.actions)||!ids(p.suppliers)||!ids(p.evidenceIds)||typeof p.description!=='string'||!p.description.trim()||p.description.length>4000)throw Error('invalid_proposal');
 return createHash('sha256').update(JSON.stringify([p.id,p.revision,p.budgetMinor,p.currency,p.actions,p.suppliers,p.expiresAt,p.transactionLimitMinor,p.forecastRevenueMinor,p.forecastCostMinor,p.evidenceIds,p.kind,p.description])).digest('hex');
}
export function assessOpportunity(p:Proposal){
 proposalDigest(p);
 const contributionMinor=p.forecastRevenueMinor-p.forecastCostMinor;
 return {contributionMinor,eligibleForOwnerReview:p.kind==='maintenance'||contributionMinor>0,forecastOnly:true,executionAuthorized:false};
}
