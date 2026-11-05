import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Store} from './store.js';
import type {Billing} from './billing.js';
export const sourceSchema=z.object({kind:z.enum(['marketing','website','github']),url:z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search;}),token:z.string().optional(),repository:z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional()});
export type Source=z.infer<typeof sourceSchema>;
export async function inspectSource(s:Source,http:typeof fetch=fetch){
 if(s.kind==='github'&&(!s.repository||new URL(s.url).origin!=='https://api.github.com'))throw new Error('GITHUB_SOURCE_INVALID');
 const path=s.kind==='marketing'?'/api/products/portfolio':s.kind==='github'?'/repos/'+s.repository+'/commits?per_page=1':'';
 const r=await http(s.url.replace(/\/$/,'')+path,{headers:{...(s.token?{authorization:'Bearer '+s.token}:{})},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!r.ok)throw new Error('SOURCE_UNAVAILABLE');const text=await r.text();if(text.length>1048576)throw new Error('SOURCE_TOO_LARGE');
 if(s.kind==='website')return {items:[{id:s.url,name:(text.match(/<title>([^<]*)<\/title>/i)?.[1]??'Website').slice(0,200),sellable:false}],status:'observed'};
 const body=JSON.parse(text);if(!Array.isArray(body))throw new Error('SOURCE_CONTRACT_INVALID');
 return {items:body.slice(0,100).map(item=>({id:String(item.id??item.sha),name:String(item.productName??item.commit?.message??'Unknown').slice(0,200),sellable:false})),status:'observed'};
}
export async function discover(store:Store,billing:Billing,sources:Source[]){
 for(const source of sources){
 try{const result=await inspectSource(source);await store.db.query('insert into manager_operator.observations(id,kind,data) values($1,$2,$3)',[randomUUID(),'inventory',JSON.stringify({source:source.kind,url:source.url,...result})]);}
 catch{await store.audit('inventory','source_blocked',source.kind,{code:'SOURCE_UNAVAILABLE'});}
 }
 for(const [account,{stripe}] of billing.clients){
 try{
 // Auto-pagination stays bounded; catalog data never qualifies delivery by itself.
 let count=0;
 for await(const price of stripe.prices.list({active:true,limit:100,expand:['data.product']})){
 if(++count>1000)break;
 const product=price.product;if(typeof product==='string'||product.deleted||!product.active||price.unit_amount===null||price.unit_amount<=0)continue;
 const system=product.metadata.manager_system,cost=Number(product.metadata.manager_cost_minor_units);
 if(!system||!/^\d+$/.test(product.metadata.manager_cost_minor_units??'')||!Number.isSafeInteger(cost))continue;
 const id=account+'-'+price.id;
 await store.db.query(`insert into manager_operator.offers(id,name,description,system,stripe_account,price_id,unit_amount,currency,cost_amount) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(stripe_account,price_id) do update set active=true`,[id,product.name,product.description??'',system,account,price.id,price.unit_amount,price.currency,cost]);
 }
 }catch{await store.audit('inventory','stripe_catalog_blocked',account,{code:'CATALOG_UNAVAILABLE'});}
 }
}
