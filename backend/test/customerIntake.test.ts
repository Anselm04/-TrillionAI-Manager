import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {saveBrief,confirmBrief,listBriefs,chooseMeasurement,submitGrowth,growthState} from '../src/customerIntake.ts';

const input={business:'Local furniture maker',offer:'Handmade wooden furniture',audience:'Homeowners in Manawatu',goal:'Increase enquiries for custom furniture',channels:['facebook']};
test('vague brief receives clarification and cannot be confirmed',()=>{
 const s=initial();const b=saveBrief(s,'client1',{business:'Shop',offer:'',audience:'',goal:'',channels:[]});
 assert.equal(b.status,'needs_clarification');assert.ok(b.questions.length>=3);
 assert.throws(()=>confirmBrief(s,'client1',b.id,{confirmed:true,revision:b.revision,acknowledgementVersion:'customer-brief-v1'}),/brief_clarification_required/);
});
test('brief confirmation requires exact revision and customer ownership',()=>{
 const s=initial();const b=saveBrief(s,'client1',input);
 assert.equal(b.status,'ready_for_confirmation');
 assert.throws(()=>confirmBrief(s,'client2',b.id,{confirmed:true,revision:1,acknowledgementVersion:'customer-brief-v1'}),/brief_not_found/);
 assert.throws(()=>confirmBrief(s,'client1',b.id,{confirmed:true,revision:999,acknowledgementVersion:'customer-brief-v1'}),/brief_confirmation_required/);
 const confirmation=confirmBrief(s,'client1',b.id,{confirmed:true,revision:b.revision,acknowledgementVersion:'customer-brief-v1'});
 assert.equal(confirmation.status,'confirmed');assert.ok(confirmation.confirmedAt);
 assert.throws(()=>saveBrief(s,'client1',{...input,id:b.id}),/confirmed_brief_immutable/);
 assert.equal(listBriefs(s,'client2').length,0);
});
test('private growth settings respect opt-out and reject unsupported reports',()=>{
 const s=initial();chooseMeasurement(s,'client1',{level:'none',cadence:'off',understoodLimitations:true});
 assert.throws(()=>submitGrowth(s,'client1',{period:'2026-11',method:'scale',value:4}),/growth_reporting_not_enabled/);
 chooseMeasurement(s,'client1',{level:'summary',cadence:'monthly',understoodLimitations:true});
 assert.throws(()=>submitGrowth(s,'client1',{period:'2026-11',method:'count',value:5}),/invalid_growth_report/);
 const report=submitGrowth(s,'client1',{period:'2026-11',method:'scale',value:4});
 assert.equal(report.revenueVerified,false);assert.equal(report.source,'customer_self_report');
 assert.throws(()=>submitGrowth(s,'client1',{period:'2026-11',method:'scale',value:5}),/growth_period_already_reported/);
 assert.equal(growthState(s,'client2').reports.length,0);
});
test('numerical customer changes are opt-in and never represented as verified revenue',()=>{
 const s=initial();chooseMeasurement(s,'client1',{level:'counts',cadence:'weekly',understoodLimitations:true});
 const report=submitGrowth(s,'client1',{period:'2026-11-02',method:'count',value:-3});
 assert.equal(report.value,-3);assert.equal(report.revenueVerified,false);
});
