const normal = new Set(['check_offer','acquire','qualify','onboard','deliver','satisfaction','support','optimize','secure']);
export function approvalRequired(action: string, amount: number, limit: number): boolean {
 return !normal.has(action) || !Number.isSafeInteger(amount) || amount < 0 || amount > limit;
}
export interface RankedOffer {id:string;ready:boolean;verified_at:string|null;unit_amount:number;cost_amount:number;demand:number}
export function rankOffers<T extends RankedOffer>(offers:T[],now=Date.now()):T[]{
 return offers.filter(o=>o.ready && o.unit_amount>o.cost_amount && o.verified_at && now-Date.parse(o.verified_at)>=0 && now-Date.parse(o.verified_at)<86400000)
 .sort((a,b)=>((b.unit_amount-b.cost_amount)*(1+b.demand))-((a.unit_amount-a.cost_amount)*(1+a.demand)));
}
export function qualifiesAsFirstCustomer(o:{livemode:boolean;paid:boolean;amount:number;refunded:number;external_customer:boolean}):boolean{
 return o.livemode && o.paid && o.amount>0 && o.refunded<o.amount && o.external_customer;
}
