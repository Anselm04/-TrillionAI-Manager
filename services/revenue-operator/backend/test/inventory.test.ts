import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectSource} from '../src/inventory.js';
test('native Marketing inventory reads authenticated portfolio without inventing readiness',async()=>{
 let url='',auth='';
 const result=await inspectSource({kind:'marketing',url:'https://marketing.example',token:'machine-token'},async(u:any,o:any)=>{url=String(u);auth=o.headers.authorization;return new Response(JSON.stringify([{id:'p1',productName:'Course',marketingStatus:'draft_created'}]));});
 assert.equal(url,'https://marketing.example/api/products/portfolio');assert.equal(auth,'Bearer machine-token');
 assert.equal(result.items[0].name,'Course');assert.equal(result.items[0].sellable,false);
});
test('source failure produces a blocker and never an empty successful inventory',async()=>{
 await assert.rejects(()=>inspectSource({kind:'marketing',url:'https://marketing.example',token:'expired'},async()=>new Response('{}',{status:401})));
});
