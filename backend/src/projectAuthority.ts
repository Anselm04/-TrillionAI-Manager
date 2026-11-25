import {createHash} from 'node:crypto';
import {proposalDigest,assessOpportunity,type Proposal,type Request} from './venturePolicy.ts';
import {audit,type State} from './domain.ts';
export type Project = {proposal:Proposal; digest:string; status:'pending'|'approved'|'rejected'|'revoked'; ownerId?:string; decidedAt?:number; reservations:Request[]};
export type ProjectState = {projects:Project[]};
const registry=(s:State):ProjectState=>s.projectAuthority??={projects:[]};
function project(s:State,id:string){const p=registry(s).projects.find(x=>x.proposal.id===id);if(!p)throw Error('project_not_found');return p;}
export function submitProject(s:State,input:Proposal,now=Date.now()){
 const p:Proposal={id:input.id,revision:input.revision,budgetMinor:input.budgetMinor,currency:input.currency,actions:input.actions,suppliers:input.suppliers,expiresAt:input.expiresAt,transactionLimitMinor:input.transactionLimitMinor,forecastRevenueMinor:input.forecastRevenueMinor,forecastCostMinor:input.forecastCostMinor,evidenceIds:input.evidenceIds,kind:input.kind,description:input.description};
 const digest=proposalDigest(p);
 if(p.expiresAt<=now||!assessOpportunity(p).eligibleForOwnerReview)throw Error('project_ineligible');
 const existing=registry(s).projects.find(x=>x.proposal.id===p.id);
 if(existing){if(existing.digest===digest)return structuredClone(existing);throw Error('project_id_conflict');}
 if(registry(s).projects.length>=10000)throw Error('project_capacity');
 const row:Project={proposal:structuredClone(p),digest,status:'pending',reservations:[]};
 registry(s).projects.push(row);audit(s,'project.submitted',{id:p.id,digest},now);return structuredClone(row);
}
// Only invoke from an authenticated owner endpoint. Owner identity and verified signature
// are obtained server-side, not accepted from request JSON.
export function decideProject(s:State,id:string,digest:string,decision:string,ownerId:string,now=Date.now()){
 const p=project(s,id);
 if(!ownerId||p.digest!==digest||proposalDigest(p.proposal)!==digest)throw Error('project_approval_mismatch');
 if(decision==='revoke'){if(p.status!=='approved')throw Error('project_invalid_transition');p.status='revoked';}
 else {if(p.status!=='pending'||!['approve','reject'].includes(decision)||p.proposal.expiresAt<=now)throw Error('project_invalid_transition');p.status=decision==='approve'?'approved':'rejected';}
 // No positive financial authority exists during current owner-imposed zero-spend policy.
 if(p.status==='approved'&&p.proposal.budgetMinor!==0){p.status='pending';throw Error('project_spending_disabled');}
 p.ownerId=ownerId;p.decidedAt=now;audit(s,'project.owner_decision',{id,digest,decision,ownerId},now);return structuredClone(p);
}
export function reserveProjectAction(s:State,id:string,digest:string,r:Request,now=Date.now()){
 const p=project(s,id);
 if(p.status!=='approved'||p.digest!==digest||proposalDigest(p.proposal)!==digest||p.proposal.expiresAt<=now)throw Error('project_authority_inactive');
 if(!r||typeof r.id!=='string'||!/^[-a-zA-Z0-9_.:]{1,100}$/.test(r.id)||!p.proposal.actions.includes(r.action)||!p.proposal.suppliers.includes(r.supplier)||r.currency!==p.proposal.currency||r.amountMinor!==0)throw Error('project_outside_scope');
 const entry:Request={id:r.id,action:r.action,supplier:r.supplier,currency:r.currency,amountMinor:r.amountMinor};
 const prior=p.reservations.find(x=>x.id===r.id);
 if(prior){if(JSON.stringify(prior)!==JSON.stringify(entry))throw Error('project_idempotency_conflict');return {reservation:structuredClone(prior),externalExecutionAuthorized:false};}
 if(p.reservations.length>=10000)throw Error('project_capacity');
 p.reservations.push(entry);audit(s,'project.action_reserved',{id,digest,requestId:r.id,requestHash:createHash('sha256').update(JSON.stringify(entry)).digest('hex')},now);
 return {reservation:structuredClone(entry),externalExecutionAuthorized:false};
}
export function listProjects(s:State){return structuredClone(registry(s).projects);}
