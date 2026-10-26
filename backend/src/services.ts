import {createHmac} from 'node:crypto';
import type {State,Task} from './domain.ts';
import type {Store} from './store.ts';
import {commerce,incident,queueEmail} from './commerce.ts';
export class Waiting extends Error { code:string;delayMs:number;constructor(code='work_pending',delayMs=15000){super(code);this.code=code;this.delayMs=delayMs;} }
export type Env=Record<string,string|undefined>;
export function origin(value:string|undefined){if(!value)throw Error('integration_not_configured');const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('invalid_integration_origin');return u.origin+u.pathname.replace(/\/$/,'');}
export async function jsonRequest(url:string,token:string,options:any={},request:typeof fetch=fetch){
 const r=await request(url,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!r.ok)throw Error(`service_http_${r.status}`);return r.json();
}
export async function signedAsset(asset:any,env:Env,request:typeof fetch=fetch){
 const base=origin(env.SUPABASE_URL);if(!env.SUPABASE_STORAGE_KEY)throw Error('storage_not_configured');
 if(!asset||typeof asset.bucket!=='string'||!/^[a-zA-Z0-9_-]+$/.test(asset.bucket)||typeof asset.path!=='string'||asset.path.split('/').some((v:string)=>!v||v==='.'||v==='..'))throw Error('invalid_asset');
 const path=[asset.bucket,...asset.path.split('/')].map(encodeURIComponent).join('/');
 const result=await jsonRequest(`${base}/storage/v1/object/sign/${path}`,env.SUPABASE_STORAGE_KEY,{method:'POST',headers:{apikey:env.SUPABASE_STORAGE_KEY},body:JSON.stringify({expiresIn:60})},request);
 const candidate=result.signedURL||result.signedUrl;if(typeof candidate!=='string')throw Error('invalid_signed_asset');const url=new URL(candidate.startsWith('/object/')?base+'/storage/v1'+candidate:candidate,base);
 // Storage uses /object/sign/... relative paths; never follow a token to another origin.
 if(url.origin!==new URL(base).origin||!url.pathname.startsWith('/storage/v1/object/sign/'))throw Error('invalid_signed_asset');
 return url.href;
}
export async function processOutbox(store:Store,env:Env,request:typeof fetch=fetch){
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return;
 const mail=await store.transact(s=>{
  if(!s.running)return null;const c=commerce(s);const now=Date.now();
  for(const m of c.outbox)if(m.status==='sending'&&m.lease<now)m.status='queued';
  if(c.outbox.filter(x=>x.sentAt>now-86400000).length>=Math.max(1,Number(env.EMAIL_DAILY_LIMIT||90)))return null;
  const m=c.outbox.find(x=>x.status==='queued'&&x.due<=now);if(!m)return null;
  const person=c.customers.find(x=>x.id===m.customerId);
  if(m.kind==='marketing'&&!person?.marketingConsent){m.status='cancelled';return null;}
  if(m.firstAttemptAt&&now-m.firstAttemptAt>=23*3600000){m.status='review';incident(s,`mail:${m.id}`,'email_delivery_uncertain',{mailId:m.id});return null;}
  m.status='sending';m.firstAttemptAt??=now;m.attempts++;m.lease=now+60000;return structuredClone(m);
 });if(!mail)return;
 try {
  const sent=await jsonRequest('https://api.resend.com/emails',env.RESEND_API_KEY,{method:'POST',headers:{'idempotency-key':`manager/${mail.id}`},body:JSON.stringify({from:env.EMAIL_FROM,to:[mail.to],subject:mail.subject,text:mail.text})},request);
  if(typeof sent.id!=='string')throw Error('email_receipt_required');
  await store.transact(s=>{const m=commerce(s).outbox.find(x=>x.id===mail.id);if(m?.status==='sending'){m.status='sent';m.providerId=sent.id;m.sentAt=Date.now();}});
 }catch{await store.transact(s=>{const m=commerce(s).outbox.find(x=>x.id===mail.id);if(m?.status==='sending'){m.status=m.attempts>=8?'review':'queued';m.due=Date.now()+Math.min(3600000,5000*2**m.attempts);if(m.status==='review')incident(s,`mail:${m.id}`,'email_delivery_failed',{mailId:m.id});}});}
}
export async function emailReceipt(store:Store,key:string){return store.transact(s=>commerce(s).outbox.find(x=>x.key===key)?.status==='sent');}
export async function effect(store:Store,task:Task,key:string,find:()=>Promise<any>,create:()=>Promise<any>){
 // Discover the remote record first: this recovers a lost response without duplicating an external action.
 const existing=await find();if(existing){await store.transact(s=>{const c=commerce(s);const row=c.effects.find(x=>x.key===key);if(row){row.status='verified';row.remoteId=String(existing.id);}});return existing;}
 const allowed=await store.transact(s=>{
  const c=commerce(s);const active=s.tasks.find(t=>t.id===task.id);
  if(!s.running||!active||active.claim!==task.claim||active.status!=='running'||(active.lease||0)<Date.now())throw Error('stale_task_claim');
  const prior=c.effects.find(x=>x.key===key);if(prior)return false;
  c.effects.push({id:key,key,taskId:task.id,status:'sending',at:Date.now()});return true;
 });if(!allowed)throw new Waiting('remote_effect_reconciliation_pending',60000);
 try{const result=await create();if(!result?.id)throw Error('remote_identity_required');await store.transact(s=>{const item=commerce(s).effects.find(x=>x.key===key);item.status='verified';item.remoteId=String(result.id);});return result;}
 catch(e){await store.transact(s=>{const item=commerce(s).effects.find(x=>x.key===key);if(item)item.status='uncertain';});throw e;}
}
export function portalUrl(env:Env,path=''){return origin(env.PUBLIC_CUSTOMER_URL||env.PUBLIC_MANAGER_URL)+path;}
export function emailProof(env:Env,id:string){return origin(env.PUBLIC_MANAGER_URL)+'/receipts/'+encodeURIComponent(id);}
