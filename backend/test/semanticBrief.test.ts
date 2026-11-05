import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {saveBrief,confirmBrief} from '../src/customerIntake.ts';
const full={business:'I build custom wood furniture',offer:'Custom carved furniture',audience:'Homeowners in Palmerston North',goal:'Increase requests for custom table quotes',channels:[]};
test('broad answers are offered practical clarification, not treated as a confirmed brief',()=>{
 const s=initial();
 const result=saveBrief(s,'customer',{business:'My small business',offer:'Services',audience:'Everyone',goal:'I want more customers',channels:[]});
 assert.equal(result.status,'needs_clarification');
 assert.ok(result.questions.some(q=>/specific product or service/i.test(q)));
 assert.ok(result.questions.some(q=>/typical customer or local area/i.test(q)));
 assert.ok(result.questions.some(q=>/enquiries, confirmed bookings or paying customers/i.test(q)));
 assert.throws(()=>confirmBrief(s,'customer',result.id,{confirmed:true,revision:result.revision,acknowledgementVersion:'customer-brief-v1'}),/brief_clarification_required/);
});
test('a specific brief remains confirmable without repeated or intrusive questioning',()=>{
 const s=initial();const row=saveBrief(s,'customer',full);
 assert.equal(row.status,'ready_for_confirmation');
 assert.equal(row.questions.length,0);
 const confirmed=confirmBrief(s,'customer',row.id,{confirmed:true,revision:row.revision,acknowledgementVersion:'customer-brief-v1'});
 assert.equal(confirmed.status,'confirmed');
});
