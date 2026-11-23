import {createHash} from 'node:crypto';

export type ExecutionStatus='proposed'|'authorized'|'running'|'awaiting_verification'|'verified'|'failed'|'cancelled'|'uncertain';
export type ExecutionEvidence={
  kind:'independent_verification';
  verifierId:string;
  checkedAt:string;
  artifactSha256:string;
  sourceReferences:string[];
  tests:{name:string;passed:boolean}[];
};
export type ExecutionRecord={
  version:1; runId:string; tenantId:string; taskId:string; actorId:string;
  status:ExecutionStatus; attempt:number; costMinor:number;
  approvalId:string|null; evidence:ExecutionEvidence|null;
  resultDigest:string|null; updatedAt:string;
};
export class EvidenceError extends Error {constructor(message:string){super(message);this.name='EvidenceError'}}
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(v);
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function newExecution(input:{runId:string;tenantId:string;taskId:string;actorId:string},now=new Date().toISOString()):ExecutionRecord{
  if(!Object.values(input).every(id)||!Number.isFinite(Date.parse(now)))throw new EvidenceError('invalid_execution_identity');
  return {...input,version:1,status:'proposed',attempt:0,costMinor:0,approvalId:null,evidence:null,resultDigest:null,updatedAt:now};
}
const transitions:Record<ExecutionStatus,ExecutionStatus[]>={
 proposed:['authorized','cancelled'],authorized:['running','cancelled'],
 running:['awaiting_verification','failed','uncertain','cancelled'],
 awaiting_verification:['verified','failed','uncertain','cancelled'],
 uncertain:['awaiting_verification','failed','cancelled'],
 verified:[],failed:[],cancelled:[]
};
export function transition(record:ExecutionRecord,to:ExecutionStatus,opts:{
  actorTenantId:string;approvalId?:string;attempt?:number;costMinor?:number;
  evidence?:ExecutionEvidence;resultDigest?:string;now?:string;
}):ExecutionRecord {
 if(opts.actorTenantId!==record.tenantId)throw new EvidenceError('tenant_mismatch');
 if(!transitions[record.status].includes(to))throw new EvidenceError('invalid_transition');
 const now=opts.now??new Date().toISOString();
 if(!Number.isFinite(Date.parse(now))||Date.parse(now)<Date.parse(record.updatedAt))throw new EvidenceError('invalid_event_time');
 const approvalId=opts.approvalId??record.approvalId;
 if(to==='authorized'&&!id(approvalId))throw new EvidenceError('authorization_required');
 if(to==='running'&&!id(approvalId))throw new EvidenceError('authorization_required');
 const attempt=opts.attempt??record.attempt;
 if(!Number.isSafeInteger(attempt)||attempt<record.attempt||attempt<0)throw new EvidenceError('invalid_attempt');
 const costMinor=opts.costMinor??record.costMinor;
 if(!Number.isSafeInteger(costMinor)||costMinor<record.costMinor||costMinor<0)throw new EvidenceError('invalid_cost');
 const evidence=opts.evidence??record.evidence;
 if(to==='verified'){
   if(!evidence||evidence.kind!=='independent_verification'||!id(evidence.verifierId)
     ||evidence.verifierId===record.actorId||!hex(evidence.artifactSha256)
     ||!Number.isFinite(Date.parse(evidence.checkedAt))
     ||!Array.isArray(evidence.sourceReferences)||evidence.sourceReferences.length===0
     ||evidence.sourceReferences.some(x=>typeof x!=='string'||!/^https:\/\//.test(x))
     ||!Array.isArray(evidence.tests)||evidence.tests.length===0
     ||evidence.tests.some(t=>!t||typeof t.name!=='string'||!t.name||t.passed!==true)
     ||!hex(opts.resultDigest??record.resultDigest))
     throw new EvidenceError('independent_evidence_required');
 }
 return {...record,status:to,approvalId:approvalId??null,attempt,costMinor,
   evidence:to==='verified'?evidence:null,
   resultDigest:opts.resultDigest??record.resultDigest,updatedAt:now};
}
export function digestArtifact(bytes:Uint8Array|string):string{
 return createHash('sha256').update(bytes).digest('hex');
}
