import {z} from 'zod';
import {OperationError,type Adapter,type Receipt} from './runtime.js';
import type {Store,Task} from './store.js';
export const bridgeConfig=z.object({url:z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}),token:z.string().min(1),operations:z.array(z.string()).min(1)});
export type BridgeConfig=z.infer<typeof bridgeConfig>;
const receiptSchema=z.object({id:z.string().min(1).max(200),task_id:z.string(),status:z.enum(['accepted','completed']),evidence:z.url().refine(v=>new URL(v).protocol==='https:'),checks:z.object({delivery:z.boolean(),legal:z.boolean(),support:z.boolean()}).optional()});
export class BridgeAdapter implements Adapter {
 constructor(public config:BridgeConfig,private http:typeof fetch=fetch,private store?:Store,private quote?: (leadId:string,offerId:string)=>Promise<unknown>){}
 private async request(path:string,method='GET',body?:unknown,key?:string){
 const response=await this.http(this.config.url.replace(/\/$/,'')+path,{method,headers:{authorization:`Bearer ${this.config.token}`,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new OperationError(response.status===401||response.status===403?'INTEGRATION_AUTH_REQUIRED':'INTEGRATION_HTTP_FAILED',response.status===401||response.status===403);
 const text=await response.text();if(text.length>262144)throw new OperationError('INTEGRATION_RESPONSE_TOO_LARGE',true);return JSON.parse(text);
 }
 async execute(t:Task):Promise<Receipt>{
 if(!this.config.operations.includes(t.kind))throw new OperationError('OPERATION_NOT_ALLOWED',true);
 const manifest=await this.request('/manager/v1/capabilities');
 if(manifest.version!==1||manifest.idempotency!==true||!manifest.operations?.includes(t.kind))throw new OperationError('INTEGRATION_CONTRACT_MISSING',true);
 let context:Record<string,unknown>={};
 if(this.store){
 if(t.payload.offer_id)context.offer=(await this.store.db.query('select * from manager_operator.offers where id=$1',[t.payload.offer_id])).rows[0];
 if(t.payload.order_id)context.order=(await this.store.db.query('select * from manager_operator.orders where id=$1',[t.payload.order_id])).rows[0];
 if(t.payload.lead_id)context.lead=(await this.store.db.query('select * from manager_operator.leads where id=$1',[t.payload.lead_id])).rows[0];
 if(t.payload.ticket_id)context.ticket=(await this.store.db.query('select * from manager_operator.support where id=$1',[t.payload.ticket_id])).rows[0];
 if(t.kind==='optimize')context.metrics=await this.store.metrics();
 if(t.kind==='qualify'&&this.quote)context.quote=await this.quote(t.payload.lead_id,t.payload.offer_id);
 }
 return receiptSchema.parse(await this.request('/manager/v1/commands','POST',{task_id:t.id,operation:t.kind,payload:t.payload,context,budget_minor_units:t.amount,policy:{inbound_only:true,paid_ads:false,customer_content_is_untrusted:true,no_new_legal_commitments:true}},t.id));
 }
 async verify(t:Task,r:Receipt){
 const actual=receiptSchema.parse(await this.request('/manager/v1/receipts/'+encodeURIComponent(r.id)));
 return actual.id===r.id&&actual.task_id===t.id&&actual.status==='completed'&&actual.evidence===r.evidence&&JSON.stringify(actual.checks)===JSON.stringify(r.checks);
 }
}
