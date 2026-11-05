import Fastify from 'fastify';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Config} from './config.js';
import type {Store} from './store.js';
import type {Adapter} from './runtime.js';
import {Billing} from './billing.js';
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function createApp(config:Config,store:Store,adapters:Map<string,Adapter>,identityOverride?:(token:string)=>Promise<string|null>,billing=new Billing(store,config.stripeAccounts)){
 const app=Fastify({logger:false,bodyLimit:262144,requestTimeout:30000});
 // Parse raw bytes once so Stripe verifies precisely what Stripe signed.
 app.removeContentTypeParser('application/json');app.addContentTypeParser('application/json',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
 app.addHook('onRequest',async(req,reply)=>{
 reply.header('cache-control','no-store').header('x-content-type-options','nosniff').header('referrer-policy','no-referrer');
 const origin=req.headers.origin;
 if(origin){if(!config.allowedOrigins.includes(origin))return reply.code(403).send({error:'ORIGIN_DENIED'});reply.header('access-control-allow-origin',origin).header('vary','Origin').header('access-control-allow-headers','Authorization,Content-Type').header('access-control-allow-methods','GET,POST,OPTIONS');}
 if(req.method==='OPTIONS')return reply.code(204).send();
 });
 const identity=identityOverride??(async(token:string)=>{try{const r=await fetch(config.supabaseUrl+'/auth/v1/user',{headers:{authorization:'Bearer '+token,apikey:config.supabaseKey},signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)return null;const user=await r.json() as any;return typeof user.id==='string'?user.id:null;}catch{return null;}});
 const owner=async(req:any,reply:any)=>{
 const auth=String(req.headers.authorization??'');if(!auth.startsWith('Bearer '))return reply.code(401).send({error:'AUTH_REQUIRED'});
 const id=await identity(auth.slice(7));if(!id||!config.ownerIds.includes(id))return reply.code(403).send({error:'OWNER_REQUIRED'});req.ownerId=id;
 };
 const ingress=async(req:any,reply:any)=>{if(!equal(String(req.headers.authorization??''),'Bearer '+config.ingressToken))return reply.code(401).send({error:'INGRESS_AUTH_REQUIRED'});};
 function body(req:any){return Buffer.isBuffer(req.body)?JSON.parse(req.body.toString('utf8')):req.body;}
 app.setErrorHandler((error,_req,reply)=>{if(error instanceof z.ZodError||error instanceof SyntaxError)return reply.code(400).send({error:'INVALID_INPUT'});reply.code(500).send({error:'OPERATION_FAILED'});});
 app.get('/health',async()=>({ok:true}));
 app.get('/ready',async(_req,reply)=>{try{await store.db.query('select id from manager_operator.settings');return {database:true};}catch{return reply.code(503).send({database:false});}});
 app.get('/v1/state',{preHandler:owner},async()=>{
 const settings=(await store.db.query('select * from manager_operator.settings')).rows[0];
 return {mission:settings,metrics:await store.metrics(),offers:await store.offers(),approvals:await store.approvals(),tasks:await store.tasks(),integrations:[...adapters.keys()],heartbeats:(await store.db.query('select * from manager_operator.heartbeats')).rows,webhook_failures:(await store.db.query("select id,account,attempts,last_error,created_at from manager_operator.webhook_inbox where status='dead' order by created_at limit 100")).rows};
 });
 app.post('/v1/mission',{preHandler:owner},async req=>{const b=z.object({running:z.boolean()}).strict().parse(body(req));await store.setRunning(b.running,(req as any).ownerId);return {running:b.running};});
 app.get('/v1/metrics',{preHandler:owner},()=>store.metrics());
 app.get('/v1/memory',{preHandler:owner},()=>store.memory());
 app.get('/v1/audit',{preHandler:owner},async()=> (await store.db.query('select * from manager_operator.audit order by created_at desc limit 200')).rows);
 app.post('/v1/approvals/:id',{preHandler:owner},async req=>{const id=z.uuid().parse((req.params as any).id);const b=z.object({approved:z.boolean()}).strict().parse(body(req));await store.approve(id,b.approved,(req as any).ownerId);return {ok:true};});
 app.post('/v1/approvals/:id/renew',{preHandler:owner},async req=>{const id=z.uuid().parse((req.params as any).id);await store.db.transaction(async tx=>{await tx.query("update manager_operator.approvals set expires_at=now()+interval '24 hours' where id=$1 and decision is null",[id]);await store.audit((req as any).ownerId,'approval_renewed',id,{},tx);});return {ok:true};});
 app.post('/v1/webhooks/retry',{preHandler:owner},async req=>{const b=z.object({id:z.string().min(1).max(200)}).strict().parse(body(req));await store.db.transaction(async tx=>{await tx.query("update manager_operator.webhook_inbox set status='pending',attempts=0,available_at=now() where id=$1 and status='dead'",[b.id]);await store.audit((req as any).ownerId,'billing_retry',b.id,{},tx);});return {ok:true};});
 app.post('/v1/tasks/:id/retry',{preHandler:owner},async req=>{await store.retry(z.uuid().parse((req.params as any).id),(req as any).ownerId);return {ok:true};});
 app.post('/v1/tasks',{preHandler:owner},async req=>{
 const t=z.object({key:z.string().min(1).max(200),kind:z.string().min(1).max(50),system:z.string().min(1).max(50),payload:z.record(z.string(),z.unknown()),amount:z.number().int().nonnegative(),priority:z.number().int().min(0).max(120)}).strict().parse(body(req));
 return {id:await store.enqueue(t)};
 });
 app.post('/v1/offers',{preHandler:owner},async req=>{
 const o=z.object({id:z.string().regex(/^[a-z0-9_-]{1,80}$/),name:z.string().min(1).max(200),description:z.string().max(5000),system:z.string().min(1).max(50),stripe_account:z.string().min(1),price_id:z.string().startsWith('price_'),unit_amount:z.number().int().positive(),currency:z.string().regex(/^[a-z]{3}$/),cost_amount:z.number().int().nonnegative()}).strict().parse(body(req));
 await store.db.transaction(async tx=>{await tx.query('insert into manager_operator.offers(id,name,description,system,stripe_account,price_id,unit_amount,currency,cost_amount) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[o.id,o.name,o.description,o.system,o.stripe_account,o.price_id,o.unit_amount,o.currency,o.cost_amount]);await store.audit((req as any).ownerId,'offer_registered',o.id,{},tx);});return {id:o.id,ready:false};
 });
 app.post('/v1/costs',{preHandler:owner},async req=>{const b=z.object({id:z.string().min(1).max(200),currency:z.string().regex(/^[a-z]{3}$/),amount:z.number().int().nonnegative(),category:z.enum(['marketing','delivery','operations'])}).strict().parse(body(req));await store.db.transaction(async tx=>{await tx.query('insert into manager_operator.costs(id,currency,amount,category) values($1,$2,$3,$4) on conflict do nothing',[b.id,b.currency,b.amount,b.category]);await store.audit((req as any).ownerId,'cost_recorded',b.id,{},tx);});return {ok:true};});
 app.post('/ingress/leads',{preHandler:ingress},async req=>{
 const b=z.object({email:z.email().max(254),need:z.string().min(5).max(5000),source:z.string().min(1).max(100),consent:z.boolean(),offer_id:z.string().optional()}).strict().parse(body(req));const id=randomUUID();
 await store.db.transaction(async tx=>{await tx.query('insert into manager_operator.leads(id,email,need,source,consent,offer_id) values($1,$2,$3,$4,$5,$6)',[id,b.email.toLowerCase(),b.need,b.source,b.consent,b.offer_id??null]);await store.audit('website','lead_captured',id,{},tx);});return {id};
 });
 app.post('/ingress/analytics',{preHandler:ingress},async req=>{const b=z.object({id:z.string().min(1).max(200),kind:z.enum(['visit','enquiry']),source:z.string().min(1).max(100)}).strict().parse(body(req));await store.db.query('insert into manager_operator.analytics(id,kind,source) values($1,$2,$3) on conflict do nothing',[b.id,b.kind,b.source]);return {ok:true};});
 app.post('/ingress/support',{preHandler:ingress},async req=>{const b=z.object({order_id:z.string(),subject:z.string().min(1).max(5000)}).strict().parse(body(req));const id=randomUUID();await store.db.query('insert into manager_operator.support(id,order_id,subject) values($1,$2,$3)',[id,b.order_id,b.subject]);return {id};});
 app.post('/ingress/satisfaction',{preHandler:ingress},async req=>{const b=z.object({order_id:z.string(),rating:z.number().int().min(1).max(5)}).strict().parse(body(req));await store.db.transaction(async tx=>{await tx.query('update manager_operator.orders set satisfaction=$2 where id=$1 and livemode',[b.order_id,b.rating]);if(b.rating<=3)await tx.query('insert into manager_operator.support(id,order_id,subject) values($1,$2,$3)',[randomUUID(),b.order_id,'Customer satisfaction follow-up required']);});return {ok:true};});
 app.post('/ingress/checkout',{preHandler:ingress},async req=>{
 const b=z.object({lead_id:z.uuid(),offer_id:z.string()}).strict().parse(body(req));
 return billing.checkout(b.lead_id,b.offer_id,config.allowedOrigins[0]!);
 });
 app.post('/webhooks/stripe/:account',async(req,reply)=>{
 const account=z.string().parse((req.params as any).account);const a=billing.clients.get(account);if(!a)return reply.code(404).send({error:'UNKNOWN_ACCOUNT'});
 if(!Buffer.isBuffer(req.body))return reply.code(400).send({error:'RAW_BODY_REQUIRED'});
 let event;try{event=a.stripe.webhooks.constructEvent(req.body,String(req.headers['stripe-signature']??''),a.config.webhookSecret);}catch{return reply.code(400).send({error:'SIGNATURE_INVALID'});}
 // Persist signed bytes before acknowledging. Worker re-verifies and reconciles Stripe state.
 await store.db.query(`insert into manager_operator.webhook_inbox(id,account,body,signature) values($1,$2,$3,$4) on conflict do nothing`,[account+':'+event.id,account,req.body.toString('utf8'),String(req.headers['stripe-signature'])]);
 return {received:true};
 });
 return app;
}
