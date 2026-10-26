import {z} from 'zod';
import {sourceSchema,type Source} from './inventory.js';
import {bridgeConfig} from './adapters.js';
export const accountSchema=z.object({id:z.string().regex(/^[a-z0-9_-]+$/),key:z.string().min(1),webhookSecret:z.string().min(1),ownerEmails:z.array(z.email()).min(1)});
export type BillingAccount=z.infer<typeof accountSchema>;
export interface Config {databaseUrl:string;port:number;supabaseUrl:string;supabaseKey:string;ownerIds:string[];allowedOrigins:string[];ingressToken:string;stripeAccounts:BillingAccount[];sources:Source[];bridges:Record<string,z.infer<typeof bridgeConfig>>}
export function loadConfig(env=process.env):Config{
 const raw=z.object({DATABASE_URL:z.string().min(1),SUPABASE_URL:z.url(),SUPABASE_PUBLISHABLE_KEY:z.string().min(1),OWNER_USER_IDS:z.string().min(1),INGRESS_TOKEN:z.string().min(32),ALLOWED_ORIGINS:z.string().min(1),STRIPE_ACCOUNTS:z.string().default('[]'),SOURCES:z.string().default('[]'),BRIDGES:z.string().default('{}'),PORT:z.coerce.number().int().min(1).max(65535).default(8080)}).parse(env);
 if(new URL(raw.SUPABASE_URL).protocol!=='https:')throw new Error('SUPABASE_HTTPS_REQUIRED');
 return {databaseUrl:raw.DATABASE_URL,port:raw.PORT,supabaseUrl:raw.SUPABASE_URL.replace(/\/$/,''),supabaseKey:raw.SUPABASE_PUBLISHABLE_KEY,ownerIds:raw.OWNER_USER_IDS.split(',').map(s=>s.trim()).filter(Boolean),allowedOrigins:raw.ALLOWED_ORIGINS.split(',').map(s=>s.trim()),ingressToken:raw.INGRESS_TOKEN,stripeAccounts:z.array(accountSchema).parse(JSON.parse(raw.STRIPE_ACCOUNTS)),sources:z.array(sourceSchema).parse(JSON.parse(raw.SOURCES)),bridges:z.record(z.string(),bridgeConfig).parse(JSON.parse(raw.BRIDGES))};
}
