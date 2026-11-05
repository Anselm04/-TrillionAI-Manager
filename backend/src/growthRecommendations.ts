import {createHash,randomUUID} from 'node:crypto';
import type {State} from './domain.ts';
import {audit} from './domain.ts';
import {commerce} from './commerce.ts';

// Advisory output only: never schedules advertising, spends, publishes or asserts incremental revenue.
export function growthAssessment(s:State,customerId:string,now=Date.now()){
 const c=commerce(s);
 const prefs=(c.measurementPreferences||[]).find((p:any)=>p.customerId===customerId);
 if(!prefs || prefs.level==='none' || prefs.cadence==='off'){
  return {status:'private',confidence:'insufficient',reportCount:0,recommendations:[],message:'You have chosen not to share growth results. Marketing activity can still be reviewed without financial disclosure.',revenueVerified:false};
 }
 const reports=(c.growthReports||[]).filter((r:any)=>r.customerId===customerId).sort((a:any,b:any)=>a.period.localeCompare(b.period));
 const briefs=(c.briefs||[]).filter((r:any)=>r.customerId===customerId && r.status==='confirmed').sort((a:any,b:any)=>b.confirmedAt-a.confirmedAt);
 const latest=reports.slice(-3);
 const direction=(r:any)=>r.method==='direction'?(r.value==='up'?1:r.value==='down'?-1:0):r.method==='scale'?Math.sign(r.value-3):Math.sign(r.value);
 const positive=latest.filter((r:any)=>direction(r)>0).length;
 const negative=latest.filter((r:any)=>direction(r)<0).length;
 const recommendations:{code:string,title:string,reason:string,requiresCustomerApproval:boolean,automaticExecution:boolean}[]=[];
 if(!briefs.length)recommendations.push({code:'confirm_brief',title:'Confirm your business goals',reason:'Your Manager needs your approved business brief before tailoring suggestions.',requiresCustomerApproval:true,automaticExecution:false});
 if(reports.length<2)recommendations.push({code:'collect_baseline',title:'Gather another comparable check-in',reason:'One self-reported period cannot establish a reliable trend.',requiresCustomerApproval:false,automaticExecution:false});
 else if(negative>=2)recommendations.push({code:'review_conversion_path',title:'Review your customer enquiry and booking journey',reason:'At least two of the latest three self-reported periods indicate lower customer activity. Check lead handling, seasonal factors and the customer experience before changing campaigns.',requiresCustomerApproval:true,automaticExecution:false});
 else if(positive>=2)recommendations.push({code:'review_successful_creatives',title:'Review which campaigns deserve further testing',reason:'At least two recent periods show higher reported customer activity. Compare this with verified campaign analytics before expanding spending.',requiresCustomerApproval:true,automaticExecution:false});
 else recommendations.push({code:'controlled_test',title:'Consider one controlled marketing test',reason:'Customer activity is mixed or unchanged. Compare recent campaign analytics and test one change at a time.',requiresCustomerApproval:true,automaticExecution:false});
 recommendations.push({code:'check_attribution',title:'Compare with campaign and enquiry evidence',reason:'Customer feedback is self-reported and cannot by itself establish marketing attribution or an increase in revenue.',requiresCustomerApproval:false,automaticExecution:false});
 const fingerprint=createHash('sha256').update(JSON.stringify({customerId,prefs:{level:prefs.level,cadence:prefs.cadence},reports:latest.map((r:any)=>({id:r.id,period:r.period,value:r.value,method:r.method})),brief:briefs[0]?.id||null})).digest('hex');
 return {status:reports.length?'advisory':'awaiting_feedback',confidence:reports.length>=3?'limited':'insufficient',reportCount:reports.length,latestPeriod:reports.at(-1)?.period||null,confirmedBrief:!!briefs.length,recommendations,assessmentId:fingerprint,revenueVerified:false,causalAttribution:false,generatedAt:now,message:'Recommendations are guidance only. No campaign changes, purchases or publishing occur automatically.'};
}
export function reviewGrowthRecommendation(s:State,customerId:string,p:any,now=Date.now()){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('invalid_recommendation_review');
 const assessment=growthAssessment(s,customerId,now);
 if(assessment.status==='private'||assessment.assessmentId!==p.assessmentId)throw Error('stale_recommendation');
 const item=assessment.recommendations.find(r=>r.code===p.code);
 if(!item || !['approve','decline'].includes(p.decision))throw Error('invalid_recommendation_review');
 const c=commerce(s);c.growthRecommendationReviews??=[];
 const key=customerId+':'+p.assessmentId+':'+p.code;
 const prior=c.growthRecommendationReviews.find((r:any)=>r.key===key);
 if(prior){if(prior.decision!==p.decision)throw Error('recommendation_already_reviewed');return prior;}
 const row={id:randomUUID(),key,customerId,assessmentId:p.assessmentId,code:p.code,decision:p.decision,at:now,status:p.decision==='approve'?'approved_for_planning':'declined',executionTriggered:false};
 c.growthRecommendationReviews.push(row);
 audit(s,'customer.growth_recommendation_review',{customerId,code:p.code,decision:p.decision,executionTriggered:false},now);
 return row;
}

export function eraseGrowthFeedback(s:State,customerId:string,now=Date.now()){
 const c=commerce(s);
 const before=(c.growthReports||[]).length;
 c.growthReports=(c.growthReports||[]).filter((r:any)=>r.customerId!==customerId);
 c.growthRecommendationReviews=(c.growthRecommendationReviews||[]).filter((r:any)=>r.customerId!==customerId);
 c.measurementPreferences=(c.measurementPreferences||[]).filter((r:any)=>r.customerId!==customerId);
 const deleted=before-c.growthReports.length;
 audit(s,'customer.growth_feedback_erased',{customerId,deletedCount:deleted},now);
 return {deletedCount:deleted,sharingEnabled:false,erased:true};
}
