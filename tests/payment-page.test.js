import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('Apple Pay cancellation makes no charge; successful wallet payment sends verified token once and disables payment buttons',async()=>{
 const html=await fs.readFile(new URL('../pay.html',import.meta.url),'utf8');const els=Object.fromEntries(['pay','apple','message','title','amount'].map(k=>[k,{style:{},disabled:false}]));let canceled=true;const charges=[];
 const context=vm.createContext({URLSearchParams,location:{search:'?token='+'x'.repeat(64)},document:{querySelector:s=>els[s.slice(1)],createElement:()=>({}),head:{append:s=>s.onload()}},Square:{payments:()=>({card:async()=>({attach:async()=>{},tokenize:async()=>({status:'OK',token:'card-token'})}),paymentRequest:v=>v,applePay:async()=>({tokenize:async()=>canceled?{status:'Cancel'}:{status:'OK',token:'wallet-token',details:{billing:{countryCode:'US'}}}}),verifyBuyer:async()=>({token:'verified-token'})})},fetch:async(url,options)=>{if(options.body){charges.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'COMPLETED'})};}return {ok:true,json:async()=>({amount:75,title:'Test',status:'open',application_id:'test',location_id:'test'})};}});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);for(let i=0;i<30;i++)await Promise.resolve();
 assert.equal(els.apple.style.display,'block');await els.apple.onclick();assert.equal(charges.length,0);assert.equal(els.apple.disabled,false);
 canceled=false;await els.apple.onclick();assert.equal(charges.length,1);assert.equal(charges[0].source_id,'wallet-token');assert.equal(charges[0].verification_token,'verified-token');assert.equal(els.pay.disabled,true);assert.equal(els.apple.style.display,'none');assert.match(els.message.textContent,/recorded/);
});
