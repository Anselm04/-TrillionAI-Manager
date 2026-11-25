export type LeadSignal={id:string;customerId:string;consent:boolean;intent:number;fit:number;observedAt:number};
export function prioritizeSales(customerId:string,signals:LeadSignal[],now=Date.now()){
 if(!customerId||!Array.isArray(signals)||signals.length>10000||!Number.isSafeInteger(now))throw Error('invalid input');
 return signals.filter(s=>s&&s.customerId===customerId&&s.consent===true&&typeof s.id==='string'&&Number.isFinite(s.intent)&&s.intent>=0&&s.intent<=1&&Number.isFinite(s.fit)&&s.fit>=0&&s.fit<=1&&Number.isSafeInteger(s.observedAt)&&s.observedAt<=now&&s.observedAt>=now-30*86400000)
 .map(s=>({id:s.id,score:Math.round(100*(.6*s.intent+.4*s.fit)),action:'review_for_followup' as const,automaticExecution:false,spendAuthorized:false})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
