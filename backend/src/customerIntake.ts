import {randomUUID} from 'node:crypto';
import type {State} from './domain.ts';
import {audit} from './domain.ts';
import {commerce} from './commerce.ts';

type Intake = {id:string,customerId:string,createdAt:number,updatedAt:number,revision:number,status:'needs_clarification'|'ready_for_confirmation'|'confirmed',business:string,offer:string,audience:string,goal:string,channels:string[],questions:string[],confirmedAt?:number,acknowledgementVersion?:string};
const AGREEMENT_VERSION = 'customer-brief-v1';
function field(value:unknown,max=600):string {
 if(typeof value!=='string')throw Error('invalid_brief');
 return value.trim().slice(0,max);
}
function needsDetail(text:string,which:'business'|'offer'|'audience'|'goal'){
 const value=text.trim().toLowerCase().replace(/[.!?]+$/,'').replace(/\\s+/g,' ');
 if(value.length<(which==='goal'?12:8))return true;
 if(/^(i (do not|don't) know|not sure|anything|whatever|help me|unsure)$/i.test(value))return true;
 if(which==='business')return /^(my|a|the|i run a|i own a|i have a)?\\s*(shop|store|business|company|online shop|online business|small business|services?)$/i.test(value);
 if(which==='offer')return /^(my|our|some|all)?\\s*(products?|services?|stuff|things|everything|anything|marketing)$/i.test(value);
 if(which==='audience')return /^(everyone|anyone|all people|the public|general public|people|customers|everybody|any person)$/i.test(value);
 return /^(i (want|need|would like|hope to) (to )?)?(get |have )?(more|better|increase|grow|improve|boost) (my )?(customers|sales|business|revenue|bookings|traffic|leads|marketing)( please)?$/i.test(value);
}
function questions(brief:Pick<Intake,'business'|'offer'|'audience'|'goal'>):string[]{
 const ask:string[]=[];
 if(needsDetail(brief.business,'business'))ask.push('What does your business mainly provide? For example: home repairs, handmade furniture, a café or an online shop selling clothing.');
 if(needsDetail(brief.offer,'offer'))ask.push('Which specific product or service should we promote first? You can name one popular item or the service you most want more bookings for.');
 if(needsDetail(brief.audience,'audience'))ask.push('Who would benefit most, and where do you serve them? If unsure, tell us your typical customer or local area.');
 if(needsDetail(brief.goal,'goal'))ask.push('When you say you want to grow, would more enquiries, confirmed bookings or paying customers be most useful? An approximate target is welcome but not required.');
 return ask;
}
export function saveBrief(s:State,customerId:string,p:any,now=Date.now()):Intake {
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('invalid_brief');
 const fields={business:field(p.business,200),offer:field(p.offer),audience:field(p.audience),goal:field(p.goal)};
 if(!Array.isArray(p.channels)||p.channels.length>10||p.channels.some((x:unknown)=>typeof x!=='string'||x.length>40))throw Error('invalid_brief');
 const channels=[...new Set((p.channels as string[]).map(x=>x.trim().toLowerCase()).filter(Boolean))];
 const records=commerce(s).briefs??=[];
 let row:Intake|undefined=p.id?records.find((r:any)=>r.id===p.id&&r.customerId===customerId):undefined;
 if(p.id&&!row)throw Error('brief_not_found');
 if(row?.status==='confirmed')throw Error('confirmed_brief_immutable');
 const followUps=questions(fields);
 if(row){Object.assign(row,fields,{channels,questions:followUps,status:followUps.length?'needs_clarification':'ready_for_confirmation',updatedAt:now,revision:row.revision+1});}
 else {row={id:randomUUID(),customerId,createdAt:now,updatedAt:now,revision:1,status:followUps.length?'needs_clarification':'ready_for_confirmation',...fields,channels,questions:followUps};records.push(row);}
 commerce(s).briefs=records;
 audit(s,'customer.brief_saved',{customerId,briefId:row.id,revision:row.revision,requiresClarification:followUps.length>0},now);
 return row;
}
export function confirmBrief(s:State,customerId:string,id:string,p:any,now=Date.now()){
 const row=(commerce(s).briefs||[]).find((x:any)=>x.id===id&&x.customerId===customerId);
 if(!row)throw Error('brief_not_found');
 if(row.status==='confirmed')return row;
 if(row.status!=='ready_for_confirmation'||row.questions.length)throw Error('brief_clarification_required');
 if(p?.confirmed!==true||p?.acknowledgementVersion!==AGREEMENT_VERSION||p?.revision!==row.revision)throw Error('brief_confirmation_required');
 row.status='confirmed';row.confirmedAt=now;row.acknowledgementVersion=AGREEMENT_VERSION;
 audit(s,'customer.brief_confirmed',{customerId,briefId:id,revision:row.revision,acknowledgementVersion:AGREEMENT_VERSION},now);
 return row;
}
export function listBriefs(s:State,customerId:string){return (commerce(s).briefs||[]).filter((x:any)=>x.customerId===customerId);}
type Preference='none'|'summary'|'counts'|'connected';
export function chooseMeasurement(s:State,customerId:string,p:any,now=Date.now()){
 const level:Preference=p?.level;
 if(!['none','summary','counts','connected'].includes(level))throw Error('invalid_measurement_preferences');
 const cadence=p?.cadence;
 if(!['weekly','monthly','off'].includes(cadence))throw Error('invalid_measurement_preferences');
 if(typeof p?.understoodLimitations!=='boolean'||p.understoodLimitations!==true)throw Error('measurement_acknowledgement_required');
 const c=commerce(s);c.measurementPreferences??=[];
 const updated={customerId,level,cadence,acknowledgedAt:now,version:'measurement-v1',updatedAt:now};
 const index=c.measurementPreferences.findIndex((x:any)=>x.customerId===customerId);
 if(index<0)c.measurementPreferences.push(updated);else c.measurementPreferences[index]=updated;
 audit(s,'customer.measurement_preference',{customerId,level,cadence,version:updated.version},now);
 return updated;
}
export function submitGrowth(s:State,customerId:string,p:any,now=Date.now()){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('invalid_growth_report');
 const c=commerce(s);const preference=(c.measurementPreferences||[]).find((x:any)=>x.customerId===customerId);
 if(!preference||preference.level==='none'||preference.cadence==='off')throw Error('growth_reporting_not_enabled');
 if(typeof p?.period!=='string'||!/^(\d{4})-(\d{2})(-\d{2})?$/.test(p.period))throw Error('invalid_growth_report');
 if(preference.cadence==='weekly'&&!/^\d{4}-\d{2}-\d{2}$/.test(p.period))throw Error('invalid_growth_report');
 if(preference.cadence==='monthly'&&!/^\d{4}-\d{2}$/.test(p.period))throw Error('invalid_growth_report');
 const method=p.method;
 if(!['direction','scale','count'].includes(method))throw Error('invalid_growth_report');
 if(method==='direction'&&!['up','same','down'].includes(p.value))throw Error('invalid_growth_report');
 if(method==='scale'&&(!Number.isInteger(p.value)||p.value<1||p.value>5))throw Error('invalid_growth_report');
 if(method==='count'&&(preference.level==='summary'||!Number.isSafeInteger(p.value)||Math.abs(p.value)>1000000))throw Error('invalid_growth_report');
 const note=typeof p.note==='string'?p.note.trim().slice(0,300):'';
 c.growthReports??=[];
 if(c.growthReports.some((x:any)=>x.customerId===customerId&&x.period===p.period))throw Error('growth_period_already_reported');
 const report={id:randomUUID(),customerId,period:p.period,method,value:p.value,note,source:'customer_self_report',revenueVerified:false,at:now};
 c.growthReports.push(report);
 audit(s,'customer.growth_reported',{customerId,reportId:report.id,period:report.period,method,source:'self_report'},now);
 return report;
}
export function growthState(s:State,customerId:string){const c=commerce(s);return {preference:(c.measurementPreferences||[]).find((x:any)=>x.customerId===customerId)||null,reports:(c.growthReports||[]).filter((x:any)=>x.customerId===customerId)};}
