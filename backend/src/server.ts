import {createServer, type IncomingMessage} from 'node:http';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {postgresStore,LocalStore,type Store} from './store.ts';
import {audit,decide,enqueue,metrics,payment,sellable,verifySignature} from './domain.ts';
import {configurations} from './adapters.ts';
import {startRuntime} from './runtime.ts';
import {checkout} from './stripe.ts';
const env=process.env;
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
async function body(req:IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>262144)throw Error('body_too_large');chunks.push(chunk);}return Buffer.concat(chunks);}
async function owner(req:IncomingMessage){
 const auth=req.headers.authorization;
 if(!auth?.startsWith('Bearer ') || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.OWNER_USER_ID)throw Error('unauthorized');
 const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{authorization:auth,apikey:env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok)throw Error('unauthorized');const user=await r.json();if(user.id!==env.OWNER_USER_ID)throw Error('forbidden');
 return user;
}
function integration(req:IncomingMessage){const provided=req.headers.authorization||'';if(!env.INGRESS_TOKEN || !equal(provided,`Bearer ${env.INGRESS_TOKEN}`))throw Error('unauthorized');}
const validSystems=['appforge','marketing','secure','education','website','support'];
export function createApp(store:Store){return createServer(async(req,res)=>{
 const origin=req.headers.origin;
 res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
 if(origin && origin===env.OWNER_APP_ORIGIN){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-headers','authorization,content-type,idempotency-key');res.setHeader('access-control-allow-methods','GET,POST,OPTIONS');}
 const reply=(status:number,data:any)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 try{
 if(req.method==='OPTIONS')return reply(origin===env.OWNER_APP_ORIGIN?204:403,{});
 const url=new URL(req.url||'/', 'http://localhost');const path=url.pathname;
 if(path==='/health' && req.method==='GET'){await store.transact(()=>true);return reply(200,{status:'ok'});}
 if(path==='/webhooks/stripe' && req.method==='POST'){
  if(!env.STRIPE_WEBHOOK_SECRET) return reply(503,{error:'stripe_not_configured'});
  const raw=await body(req);verifySignature(raw,String(req.headers['stripe-signature']||''),env.STRIPE_WEBHOOK_SECRET);
  const event=JSON.parse(raw.toString());await store.transact(s=>payment(s,event));return reply(200,{received:true});
 }
 if(path==='/ingress/leads' && req.method==='POST'){
  integration(req);const p=JSON.parse((await body(req)).toString());
  if(typeof p.sourceId!=='string'||p.sourceId.length>160||typeof p.email!=='string'||!/^\S+@\S+\.\S+$/.test(p.email)||p.consent!==true||typeof p.need!=='string'||p.need.length>4000) return reply(400,{error:'invalid_consented_enquiry'});
  const value=await store.transact(s=>{const prior=s.leads.find(l=>l.sourceId===p.sourceId);if(prior)return {id:prior.id};const lead={id:randomUUID(),sourceId:p.sourceId,email:p.email,need:p.need,consent:true,status:'new',at:Date.now()};s.leads.push(lead);enqueue(s,`qualify:${lead.id}`,'support',{leadId:lead.id,system:'support',maxCostMinor:0,need:lead.need},80);audit(s,'lead.received',{id:lead.id});return {id:lead.id};});return reply(201,value);
 }
 if(path==='/ingress/satisfaction' && req.method==='POST'){
  integration(req);const p=JSON.parse((await body(req)).toString());if(!['satisfied','needs_help'].includes(p.response)||!p.evidenceId)return reply(400,{error:'customer_evidence_required'});
  await store.transact(s=>{const paid=s.payments.find(x=>x.id===p.paymentId && x.customerId===p.customerId);if(!paid)throw Error('unknown_payment');paid.satisfaction={response:p.response,evidenceId:p.evidenceId,at:Date.now()};if(p.response==='needs_help')enqueue(s,`support:${paid.id}:${p.evidenceId}`,'support',{paymentId:paid.id,system:'support',maxCostMinor:0},110);audit(s,'customer.feedback',{paymentId:paid.id,response:p.response});});return reply(200,{recorded:true});
 }
 await owner(req);
 if(path==='/state' && req.method==='GET')return reply(200,await store.transact(s=>({running:s.running,metrics:metrics(s),tasks:s.tasks.slice(-100).reverse(),offers:s.offers,leads:s.leads.slice(-100),audit:s.audit.slice(-100).reverse(),integrations:Object.keys(configurations())})));
 if(req.method!=='POST')return reply(404,{error:'not_found'});
 const p=JSON.parse((await body(req)).toString()||'{}');
 if(path==='/mission') {if(typeof p.running!=='boolean')return reply(400,{error:'running_required'});await store.transact(s=>{s.running=p.running;audit(s,'owner.mission',{running:p.running});});return reply(200,{running:p.running});}
 if(path==='/approvals'){await store.transact(s=>decide(s,p.taskId,p.decision));return reply(200,{recorded:true});}
 if(path==='/tasks'){
  if(!['campaign','deliver','support','improve','protect','educate','strategic'].includes(p.action)||!validSystems.includes(p.payload?.system)||!Number.isSafeInteger(p.payload?.maxCostMinor)||p.payload.maxCostMinor<0)return reply(400,{error:'invalid_task'});
  return reply(201,await store.transact(s=>enqueue(s,randomUUID(),p.action,p.payload)));
 }
 if(path==='/offers'){
  if(typeof p.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(p.id)||!validSystems.includes(p.system)||typeof p.name!=='string'||!Number.isSafeInteger(p.priceMinor)||p.priceMinor<=0||!Number.isSafeInteger(p.marginMinor)||p.marginMinor<0||p.marginMinor>p.priceMinor||typeof p.conversionEstimate!=='number'||p.conversionEstimate<0||p.conversionEstimate>1||!Array.isArray(p.approvedClaims)||!p.evidence?.evidenceUrl?.startsWith('https://')||!sellable(p))return reply(400,{error:'fresh_offer_evidence_required'});
  const result=await store.transact(s=>{if(s.offers.some(o=>o.id===p.id))throw Error('offer_immutable_create_new_version');s.offers.push(p);audit(s,'owner.offer_added',{id:p.id});return p;});return reply(201,result);
 }
 if(path==='/checkout'){
  const offer=await store.transact(s=>s.offers.find(o=>o.id===p.offerId && sellable(o)));if(!offer)return reply(409,{error:'offer_not_ready'});
  const key=String(req.headers['idempotency-key']||'');if(!/^[\w-]{16,128}$/.test(key))return reply(400,{error:'idempotency_key_required'});
  return reply(201,await checkout(offer,env.STRIPE_SECRET_KEY||'',env.CHECKOUT_SUCCESS_URL||'',env.CHECKOUT_CANCEL_URL||'',key));
 }
 return reply(404,{error:'not_found'});
 }catch(e){const code=e instanceof Error?e.message:'';const bad=['invalid_signature','live_event_required','paid_customer_required','offer_payment_mismatch','invalid_approval','offer_immutable_create_new_version','unknown_payment'];
 const status=code==='unauthorized'?401:code==='forbidden'?403:code==='body_too_large'?413:bad.includes(code)||e instanceof SyntaxError?400:503;
 reply(status,{error:status===503?'operation_unavailable':code||'invalid_request'});
 }
});}
async function main(){
 if(env.NODE_ENV==='production' && !env.DATABASE_URL)throw Error('production_database_required');
 if(!env.SUPABASE_URL?.startsWith('https://')||!env.SUPABASE_PUBLISHABLE_KEY||!env.OWNER_USER_ID)throw Error('owner_auth_required');
 const store=env.DATABASE_URL?await postgresStore(env.DATABASE_URL):new LocalStore(env.LOCAL_DB_PATH||'manager.db');
 const stop=startRuntime(store,configurations(),()=>console.error('runtime_cycle_failed'));
 const server=createApp(store);server.requestTimeout=15000;server.headersTimeout=10000;server.listen(Number(env.PORT||8080),'0.0.0.0');
 let stopping=false;async function shutdown(){if(stopping)return;stopping=true;server.close();await stop();await store.close();}
 process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
}
if(import.meta.url===new URL(process.argv[1]||'', 'file://').href)await main();
