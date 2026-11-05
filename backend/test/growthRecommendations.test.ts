import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../src/domain.ts';
import {saveBrief,confirmBrief,chooseMeasurement,submitGrowth} from '../src/customerIntake.ts';
import {growthAssessment,reviewGrowthRecommendation} from '../src/growthRecommendations.ts';
import {marketingCommand} from '../src/marketingBridge.ts';

function confirmed(s:ReturnType<typeof initial>,id:string) {
 const brief=saveBrief(s,id,{business:'Custom furniture studio',offer:'Carved wooden furniture',audience:'Customers in Manawatu',goal:'Increase qualified bookings and enquiries',channels:['instagram']});
 confirmBrief(s,id,brief.id,{revision:brief.revision,acknowledgementVersion:'customer-brief-v1',confirmed:true});
}
test('opted-out customers never reveal growth recommendations',()=>{
 const s=initial();
 const a=growthAssessment(s,'private-person');
 assert.equal(a.status,'private');assert.equal(a.recommendations.length,0);
 assert.equal(a.revenueVerified,false);
});
test('single customer report is insufficient evidence for attribution',()=>{
 const s=initial();confirmed(s,'customer-a');
 chooseMeasurement(s,'customer-a',{level:'summary',cadence:'monthly',understoodLimitations:true});
 submitGrowth(s,'customer-a',{period:'2026-08',method:'direction',value:'up'});
 const a=growthAssessment(s,'customer-a');
 assert.equal(a.confidence,'insufficient');
 assert.equal(a.causalAttribution,false);
 assert.ok(a.recommendations.some(x=>x.code==='collect_baseline'));
 assert.ok(a.recommendations.every(x=>x.automaticExecution===false));
 assert.equal(growthAssessment(s,'other').status,'private');
});
test('repeated declining reports result in conservative conversion review, not spending',()=>{
 const s=initial();confirmed(s,'customer-a');
 chooseMeasurement(s,'customer-a',{level:'counts',cadence:'monthly',understoodLimitations:true});
 for(const [period,value] of [['2026-07',-5],['2026-08',-2],['2026-09',0]] as const)submitGrowth(s,'customer-a',{period,method:'count',value});
 const a=growthAssessment(s,'customer-a');
 assert.equal(a.confidence,'limited');
 assert.ok(a.recommendations.some(x=>x.code==='review_conversion_path'));
 const review=reviewGrowthRecommendation(s,'customer-a',{assessmentId:a.assessmentId,code:'review_conversion_path',decision:'approve'});
 assert.equal(review.status,'approved_for_planning');
 assert.equal(review.executionTriggered,false);
 assert.equal(s.tasks.length,0);
 assert.equal(reviewGrowthRecommendation(s,'customer-a',{assessmentId:a.assessmentId,code:'review_conversion_path',decision:'approve'}).id,review.id);
 assert.throws(()=>reviewGrowthRecommendation(s,'customer-a',{assessmentId:a.assessmentId,code:'review_conversion_path',decision:'decline'}),/recommendation_already_reviewed/);
 assert.throws(()=>reviewGrowthRecommendation(s,'other',{assessmentId:a.assessmentId,code:'review_conversion_path',decision:'approve'}),/stale_recommendation/);
});
test('read-only bridge assessment stays fresh as feedback arrives',()=>{
 const s=initial();confirmed(s,'marketing:customer-1');
 const req=(operation:string,requestId:string,payload:any={})=>({sourceUserId:'customer-1',operation,requestId,payload});
 marketingCommand(s,req('growth.preferences','prefs-12345678901234',{level:'summary',cadence:'monthly',understoodLimitations:true}));
 const first=marketingCommand(s,req('growth.assess','same-assess-key-1234'));
 assert.equal(first.reportCount,0);
 marketingCommand(s,req('growth.submit','growth-2026-08-12345',{period:'2026-08',method:'direction',value:'up'}));
 const second=marketingCommand(s,req('growth.assess','same-assess-key-1234'));
 assert.equal(second.reportCount,1);
 assert.notEqual(first.assessmentId,second.assessmentId);
});
