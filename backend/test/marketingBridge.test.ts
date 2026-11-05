import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {initial} from '../src/domain.ts';
import {validateMarketingSignature,marketingCommand} from '../src/marketingBridge.ts';
import {commerce} from '../src/commerce.ts';

const secret='separate-strong-secret-with-at-least-32-characters';
const brief={business:'Custom furniture workshop',offer:'Hand-carved wooden furniture',audience:'Homeowners in Manawatu',goal:'More qualified enquiries for custom furniture',channels:['facebook']};
const cmd=(sourceUserId:string,operation:string,requestId:string,payload:any={})=>({sourceUserId,operation,requestId,payload});

test('Marketing bridge rejects forged, stale and insufficient credentials',()=>{
 const data=Buffer.from('{"hello":"manager"}');
 const time=String(Date.now());
 const signature=createHmac('sha256',secret).update(time+'.').update(data).digest('hex');
 validateMarketingSignature(data,time,signature,secret);
 assert.throws(()=>validateMarketingSignature(data,time,signature,'too-short'),/marketing_bridge_not_configured/);
 assert.throws(()=>validateMarketingSignature(data,time,'0'.repeat(64),secret),/unauthorized/);
 assert.throws(()=>validateMarketingSignature(data,String(Date.now()-3600000),signature,secret),/unauthorized/);
});

test('Customer scoped bridge enforces clarification and confirmation',()=>{
 const state=initial();
 const first=marketingCommand(state,cmd('marketing-user-1','brief.save','req-save-a-123456789',brief));
 assert.equal(first.status,'ready_for_confirmation');
 const same=marketingCommand(state,cmd('marketing-user-1','brief.save','req-save-a-123456789',brief));
 assert.equal(first.id,same.id);
 assert.equal((commerce(state).briefs||[]).length,1);
 assert.throws(()=>marketingCommand(state,cmd('marketing-user-2','brief.confirm','req-confirm-b-12345',{id:first.id,revision:first.revision,confirmed:true,acknowledgementVersion:'customer-brief-v1'})),/brief_not_found/);
 const confirmed=marketingCommand(state,cmd('marketing-user-1','brief.confirm','req-confirm-a-12345',{id:first.id,revision:first.revision,confirmed:true,acknowledgementVersion:'customer-brief-v1'}));
 assert.equal(confirmed.status,'confirmed');
 assert.equal(marketingCommand(state,cmd('marketing-user-2','brief.list','req-list-b-123456')).length,0);
 assert.equal(marketingCommand(state,cmd('marketing-user-1','brief.list','req-list-a-123456')).length,1);
});

test('Marketing bridge cannot command spending, publishing or Manager execution',()=>{
 const state=initial();
 for(const operation of ['campaign.publish','paid-ads.authorize','tasks.create','owner.mission']){
  assert.throws(()=>marketingCommand(state,cmd('client',''+operation,'req-unsupported-12345')),/invalid_marketing_bridge_command/);
 }
 assert.equal(state.tasks.length,0);
});

test('Customer growth reports preserve privacy and idempotency',()=>{
 const state=initial();
 marketingCommand(state,cmd('client-a','growth.preferences','prefs-123456789012',{level:'summary',cadence:'monthly',understoodLimitations:true}));
 const data={period:'2026-11',method:'direction',value:'up'};
 const original=marketingCommand(state,cmd('client-a','growth.submit','report-123456789012',data));
 const duplicate=marketingCommand(state,cmd('client-a','growth.submit','report-123456789012',data));
 assert.equal(original.id,duplicate.id);
 assert.equal(original.revenueVerified,false);
 assert.equal(marketingCommand(state,cmd('client-b','growth.state','state-b-1234567890')).reports.length,0);
 assert.equal(marketingCommand(state,cmd('client-a','growth.state','state-a-1234567890')).reports.length,1);
});
