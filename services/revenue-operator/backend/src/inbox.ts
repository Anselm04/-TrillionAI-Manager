import type {Store} from './store.js';
import type {Billing} from './billing.js';
export async function processInbox(store:Store,billing:Billing){
 // Row lock is held through reconciliation. Crash rolls back; concurrent workers skip it.
 // Stripe and payment ledger writes are idempotent. Reconcile outside this transaction's DB
 // connection requires pool size >=2; no inbox ack precedes durable payment persistence.
 return store.db.transaction(async tx=>{
 const row=(await tx.query("select * from manager_operator.webhook_inbox where status='pending' and available_at<=now() order by created_at for update skip locked limit 1")).rows[0];
 if(!row)return false;
 try{await billing.handle(row.account,Buffer.from(row.body),row.signature,true);await tx.query("update manager_operator.webhook_inbox set status='done',body='',signature='' where id=$1",[row.id]);}
 catch{const attempts=row.attempts+1;await tx.query("update manager_operator.webhook_inbox set attempts=$2,status=$3,last_error='BILLING_RECONCILIATION_FAILED',available_at=now()+($4*interval '1 second') where id=$1",[row.id,attempts,attempts>=8?'dead':'pending',Math.min(3600,30*2**attempts)]);}
 return true;
 });
}
