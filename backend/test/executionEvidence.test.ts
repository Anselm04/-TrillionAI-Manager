import test from 'node:test';
import assert from 'node:assert/strict';
import {newExecution,transition,digestArtifact} from '../src/executionEvidence.ts';

const first=()=>newExecution({runId:'run-1',tenantId:'tenant-a',taskId:'task-1',actorId:'builder-1'},'2026-11-23T00:00:00.000Z');
const at='2026-11-23T00:00:01.000Z';
test('requires authorization and explicit tenant match',()=>{
 const r=first();
 assert.throws(()=>transition(r,'running',{actorTenantId:'tenant-a',now:at}),/invalid_transition/);
 assert.throws(()=>transition(r,'authorized',{actorTenantId:'tenant-b',approvalId:'approval-1',now:at}),/tenant_mismatch/);
 assert.throws(()=>transition(r,'authorized',{actorTenantId:'tenant-a',now:at}),/authorization_required/);
});
test('verification requires different verifier, proven tests and digest',()=>{
 let r=transition(first(),'authorized',{actorTenantId:'tenant-a',approvalId:'approval-1',now:at});
 r=transition(r,'running',{actorTenantId:'tenant-a',attempt:1,now:'2026-11-23T00:00:02.000Z'});
 r=transition(r,'awaiting_verification',{actorTenantId:'tenant-a',resultDigest:digestArtifact('output'),now:'2026-11-23T00:00:03.000Z'});
 const evidence={kind:'independent_verification' as const,verifierId:'verifier-2',
 checkedAt:'2026-11-23T00:00:03.000Z',artifactSha256:digestArtifact('artifact'),
 sourceReferences:['https://example.org/proof'],tests:[{name:'offline-proof',passed:true}]};
 assert.throws(()=>transition(r,'verified',{actorTenantId:'tenant-a',evidence:{...evidence,verifierId:'builder-1'},now:'2026-11-23T00:00:04.000Z'}),/independent_evidence_required/);
 const verified=transition(r,'verified',{actorTenantId:'tenant-a',evidence,now:'2026-11-23T00:00:04.000Z'});
 assert.equal(verified.status,'verified');
 assert.throws(()=>transition(verified,'running',{actorTenantId:'tenant-a'}),/invalid_transition/);
});
test('uncertain external side effects cannot be marked verified without reconciliation',()=>{
 let r=transition(first(),'authorized',{actorTenantId:'tenant-a',approvalId:'approval-1',now:at});
 r=transition(r,'running',{actorTenantId:'tenant-a',now:'2026-11-23T00:00:02.000Z'});
 r=transition(r,'uncertain',{actorTenantId:'tenant-a',now:'2026-11-23T00:00:03.000Z'});
 assert.throws(()=>transition(r,'verified',{actorTenantId:'tenant-a',now:'2026-11-23T00:00:04.000Z'}),/invalid_transition/);
 assert.throws(()=>transition(r,'running',{actorTenantId:'tenant-a',now:'2026-11-23T00:00:04.000Z'}),/invalid_transition/);
});
test('invalid cost/time and negative progression rejected',()=>{
 const r=first();
 assert.throws(()=>transition(r,'authorized',{actorTenantId:'tenant-a',approvalId:'ok',costMinor:-1,now:at}),/invalid_cost/);
 assert.throws(()=>transition(r,'authorized',{actorTenantId:'tenant-a',approvalId:'ok',now:'2026-11-22T00:00:00.000Z'}),/invalid_event_time/);
});
