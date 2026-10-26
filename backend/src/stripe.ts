export async function checkout(offer:any,secret:string,successUrl:string,cancelUrl:string,key:string,request:typeof fetch=fetch) {
 if(!secret.startsWith('sk_live_'))throw Error('live_stripe_key_required');
 for(const url of [successUrl,cancelUrl])if(new URL(url).protocol!=='https:')throw Error('https_return_url_required');
 const body=new URLSearchParams({mode:'payment','line_items[0][price]':offer.stripePriceId,'line_items[0][quantity]':'1',customer_creation:'always',success_url:successUrl,cancel_url:cancelUrl,'metadata[manager_offer_id]':offer.id,'metadata[manager_price_id]':offer.stripePriceId});
 const r=await request('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/x-www-form-urlencoded','idempotency-key':key},body,signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!r.ok)throw Error('checkout_unavailable');const session=await r.json();if(session.livemode!==true || !session.url?.startsWith('https://checkout.stripe.com/'))throw Error('invalid_checkout');return {id:session.id,url:session.url};
}
