import {createHash, createPublicKey, verify} from 'node:crypto';
export type Proposal = {id:string; revision:number; budgetMinor:number; currency:string; actions:string[]; suppliers:string[]; expiresAt:number; transactionLimitMinor:number; forecastRevenueMinor:number; forecastCostMinor:number; evidenceIds:string[]; kind:'venture'|'upgrade'|'maintenance'; description:string};
export type Approval = {digest:string; signature:string};
export type Request = {id:string; action:string; supplier:string; amountMinor:number; currency:string};
export type Ledger = {projectDigest:string; revoked:boolean; reservations:Request[]};
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
// Simulation only. Production must bind the trusted owner key and ledger to independently controlled storage and enforce this atomically at every external adapter.
export function reserveSimulation(p:Proposal,a:Approval,ledger:Ledger,r:Request,ownerPublicKey:string,now:number,availableCapitalMinor:number):Ledger {
 const digest=proposalDigest(p);
 const key=createPublicKey(ownerPublicKey);
 if(key.asymmetricKeyType!=='ed25519'||a.digest!==digest||ledger.projectDigest!==digest||!verify(null,Buffer.from('trillionai.project.v1:'+digest),key,Buffer.from(a.signature,'base64')))throw Error('owner_approval_required');
 if(ledger.revoked||!money(now)||now>=p.expiresAt)throw Error('authority_inactive');
 if(!assessOpportunity(p).eligibleForOwnerReview)throw Error('commercial_gate');
 if(!ident(r.id)||!p.actions.includes(r.action)||!p.suppliers.includes(r.supplier)||r.currency!==p.currency||!money(r.amountMinor)||r.amountMinor>p.transactionLimitMinor||!money(availableCapitalMinor))throw Error('outside_scope');
 const prior=ledger.reservations.find(x=>x.id===r.id);
 if(prior){if(prior.action!==r.action||prior.supplier!==r.supplier||prior.amountMinor!==r.amountMinor||prior.currency!==r.currency)throw Error('idempotency_conflict');return structuredClone(ledger);}
 const used=ledger.reservations.reduce((n,x)=>{if(!money(x.amountMinor)||x.currency!==p.currency||!Number.isSafeInteger(n+x.amountMinor))throw Error('invalid_ledger');return n+x.amountMinor;},0);
 if(!Number.isSafeInteger(used+r.amountMinor)||used+r.amountMinor>p.budgetMinor||r.amountMinor>availableCapitalMinor)throw Error('budget_exceeded');
 return {...structuredClone(ledger),reservations:[...structuredClone(ledger.reservations),{id:r.id,action:r.action,supplier:r.supplier,amountMinor:r.amountMinor,currency:r.currency}]};
}
