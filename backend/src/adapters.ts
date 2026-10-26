import type {Task} from './domain.ts';
export type Config = Record<string,{url:string,token:string}>;
export class AdapterError extends Error { code:string; constructor(code:string){super(code);this.code=code;} }
export function configurations(env=process.env):Config {
 const result:Config={};for(const name of ['marketing','appforge','secure','education','support','website']) {
 const url=env[`${name.toUpperCase()}_ADAPTER_URL`],token=env[`${name.toUpperCase()}_ADAPTER_TOKEN`];
 if(url && token) {const u=new URL(url);if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash)throw Error('invalid_adapter_url');result[name]={url:u.href.replace(/\/$/,''),token};}}
 return result;
}
export async function execute(task:Task,config:Config,request:typeof fetch=fetch) {
 const c=config[task.payload.system];if(!c) throw new AdapterError('integration_not_configured');
 const headers={'authorization':`Bearer ${c.token}`,'content-type':'application/json','idempotency-key':task.id};
 const r=await request(c.url+'/jobs',{method:'POST',headers,body:JSON.stringify({taskId:task.id,action:task.action,payload:task.payload,approval:task.approval||null}),signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!r.ok)throw new AdapterError(`integration_http_${r.status}`);
 const submitted=await r.json();if(submitted.taskId!==task.id)throw new AdapterError('job_identity_mismatch');
 // Never trust an HTTP 200/queued receipt as completed delivery.
 const v=await request(c.url+'/jobs/'+encodeURIComponent(task.id),{headers,signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!v.ok)throw new AdapterError(`verification_http_${v.status}`);const proof=await v.json();
 if(proof.taskId!==task.id || proof.status!=='verified' || !/^https:\/\//.test(proof.evidenceUrl||'')) throw new AdapterError('job_not_verified');
 return {taskId:task.id,status:'verified',evidenceUrl:proof.evidenceUrl};
}
