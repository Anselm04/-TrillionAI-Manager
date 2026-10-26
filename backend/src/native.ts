import type {Store} from './store.ts';
import type {Task} from './domain.ts';
import {sellable,audit} from './domain.ts';
import {commerce,qualify,queueEmail,grantAccess,incident} from './commerce.ts';
import {type Env,origin,jsonRequest,effect,Waiting,signedAsset,portalUrl,emailProof,emailReceipt} from './services.ts';
import {execute as remoteExecute,type Config} from './adapters.ts';
export function nativeExecutor(store:Store,config:Config,env:Env=process.env,request:typeof fetch=fetch){
 async function marketing(task:Task){
  const base=origin(env.MARKETING_API_URL);const token=env.MARKETING_API_TOKEN;if(!token)throw Error('marketing_auth_required');
  const api=(path:string,options:any={})=>jsonRequest(base+path,token,options,request);
  const offer=await store.transact(s=>s.offers.find(o=>o.id===task.payload.offerId&&sellable(o)));if(!offer)throw Error('offer_not_ready');
  const status=await api('/api/social/oauth/status');const permitted=(env.MARKETING_PLATFORMS||'').split(',').filter(Boolean);
  const platform=status.platforms?.find((x:any)=>x.connected===true&&permitted.includes(x.platform));if(!platform)throw Error('publishing_connection_required');
  const campaign=await effect(store,task,`campaign:${task.id}`,async()=>{const list=await api('/api/campaigns');return list.find((x:any)=>x.sourceRequestId===task.id);},()=>api('/api/campaigns',{method:'POST',body:JSON.stringify({name:`TrillionAI: ${offer.name}`,sourceRequestId:task.id,source:'trillionai_manager',platforms:[platform.platform],budget:0,description:offer.approvedClaims.join('\n')})}));
  const link=new URL(offer.purchaseUrl);link.searchParams.set('campaign',task.id);
  // Use only owner-approved product facts. A social provider's quota/spend checks remain authoritative.
  const approved=offer.platformCopy?.[platform.platform]||[offer.name,...offer.approvedClaims].join('\n');
  const body=approved+'\n'+link.href;
  const post=await effect(store,task,`publish:${task.id}`,async()=>{const list=await api('/api/social/posts');return list.find((x:any)=>x.body===body&&x.platform===platform.platform);},async()=>{
   const sent=await api('/api/social/publish',{method:'POST',body:JSON.stringify({[platform.platform]:true,caption:body,link:link.href})});
   const id=sent.results?.[0]?.localPostId;if(!id)throw Error('publication_identity_required');return {id};
  });
  const all=await api('/api/social/posts');const proof=all.find((x:any)=>x.id===post.id);
  if(!proof?.published||!proof.externalPostId)throw new Waiting('publication_pending',60000);
  return {status:'verified',evidenceUrl:base+'/api/social/posts',remoteId:post.id,campaignId:campaign.id,platform:platform.platform,externalPostId:proof.externalPostId};
 }
 async function appforge(task:Task){
  const base=origin(env.APPFORGE_API_URL),token=env.APPFORGE_API_TOKEN;if(!token)throw Error('appforge_auth_required');
  const api=(path:string,opts:any={})=>jsonRequest(base+path,token,opts,request);
  const title=`Manager ${task.id}`;
  const projects=async()=>{const r=await api('/api/trpc/projects.list');return r.result?.data?.json??r.result?.data;};
  const project=await effect(store,task,`build:${task.id}`,async()=>{const list=await projects();if(!Array.isArray(list))throw Error('project_list_contract_mismatch');return list.find((p:any)=>p.title===title);},async()=>{
   if(typeof task.payload.description!=='string'||!task.payload.description.trim())throw Error('build_description_required');
   return api('/api/generate',{method:'POST',body:JSON.stringify({title,description:task.payload.description,techStack:task.payload.techStack||'flutter-node',productType:task.payload.productType||'mobile_app'})});
  });
  const fresh=(await projects()).find((p:any)=>p.id===project.id);if(!fresh)throw Error('build_not_found');
  if(['failed','error'].includes(fresh.status))throw Error('appforge_build_failed');
  if(!['validated','production-certified'].includes(fresh.status))throw new Waiting('appforge_build_pending',60000);
  if(task.action==='deliver'&&!fresh.liveUrl&&!fresh.deployedUrl&&!fresh.deployUrl)throw new Waiting('appforge_deployment_pending',60000);
  return {status:'verified',evidenceUrl:fresh.liveUrl||fresh.deployedUrl||fresh.deployUrl||base+`/project/${project.id}`,projectId:project.id};
 }
 async function delivery(task:Task){
  const result=await store.transact(s=>{const p=s.payments.find(p=>p.id===task.payload.paymentId&&!p.refunded);if(!p)throw Error('paid_purchase_required');const o=s.offers.find(o=>o.id===p.offerId);return {p,o};});
  if(result.o?.delivery?.type!=='digital')return task.payload.system==='appforge'&&env.APPFORGE_API_URL?appforge(task):remoteExecute(task,config,request);
  // Verify every existing asset before granting access to the paid course/product.
  for(const asset of result.o.delivery.assets){const url=await signedAsset(asset,env,request);const r=await request(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('delivery_asset_unavailable');}
  const mail=await store.transact(s=>{const e=grantAccess(s,result.p.id);const key=`delivery:${result.p.id}`;queueEmail(s,key,e.customerId,`Your ${result.o.name} is ready`,[`Thank you for your purchase.`, `Your ${result.o.name} is available in your account.`, portalUrl(env), 'Sign in using the email address you used at checkout.','Contact support from your account if you need help.'].join('\n\n'));return {e,key};});
  if(!await emailReceipt(store,mail.key))throw new Waiting('delivery_notification_pending');
  return {status:'verified',evidenceUrl:origin(env.PUBLIC_MANAGER_URL)+`/customer/orders/${mail.e.id}`,entitlementId:mail.e.id};
 }
 async function support(task:Task){
  if(task.payload.leadId){
   const key=`enquiry:${task.payload.leadId}`;
   await store.transact(s=>{const lead=s.leads.find(l=>l.id===task.payload.leadId);if(!lead)throw Error('unknown_lead');const quote=qualify(s,lead,sellable);if(!quote){incident(s,`lead:${lead.id}`,'offer_fit_review',{leadId:lead.id});return;}
    const text=[`Thank you for your enquiry.`,`${quote.name} matches the needs you described.`,...quote.claims,`Price: ${(quote.priceMinor/100).toFixed(2)} ${quote.currency.toUpperCase()}${quote.mode==='subscription'?' per billing period':''}.`,quote.purchaseUrl,'There is no obligation to purchase. Reply through support if you have questions.'].join('\n\n');queueEmail(s,key,quote.customerId,'Your TrillionAI enquiry',text);
   });
   const mail=await store.transact(s=>commerce(s).outbox.find(m=>m.key===key));if(!mail)throw new Waiting('offer_fit_review_pending',3600000);
   if(mail.status!=='sent')throw new Waiting('enquiry_notification_pending');return {status:'verified',evidenceUrl:emailProof(env,mail.id)};
  }
  if(task.payload.ticketId){
   const ticket=await store.transact(s=>commerce(s).tickets.find(x=>x.id===task.payload.ticketId));if(!ticket)throw Error('unknown_ticket');
   if(ticket.status!=='resolved')throw new Waiting('support_resolution_pending',300000);
   return {status:'verified',evidenceUrl:portalUrl(env,`/customer/tickets/${ticket.id}`)};
  }
  const p=await store.transact(s=>s.payments.find(x=>x.id===task.payload.paymentId&&!x.refunded));if(!p?.managerCustomerId)return remoteExecute(task,config,request);
  const key=`satisfaction:${p.id}`;const mail=await store.transact(s=>queueEmail(s,key,p.managerCustomerId,'How is your TrillionAI purchase going?',`Your feedback helps us improve. Sign in to your account to tell us whether you are satisfied or need help.\n\n${portalUrl(env)}\n\nWe will not assume you are satisfied without your feedback.`));
  if(!await emailReceipt(store,key))throw new Waiting('feedback_request_pending');return {status:'verified',evidenceUrl:emailProof(env,mail.id)};
 }
 return async(task:Task,_config:Config)=>{
  // Keep the owner's pause authoritative immediately before dispatching any new side effect.
  await store.transact(s=>{const t=s.tasks.find(t=>t.id===task.id);if(!s.running||t?.claim!==task.claim)throw Error('mission_paused_or_stale');});
  if(task.action==='campaign'&&env.MARKETING_API_URL)return marketing(task);
  if(task.action==='deliver')return delivery(task);
  if(task.action==='support')return support(task);
  if(['improve','educate'].includes(task.action)&&task.payload.system==='appforge'&&env.APPFORGE_API_URL)return appforge(task);
  return remoteExecute(task,config,request);
 };
}
