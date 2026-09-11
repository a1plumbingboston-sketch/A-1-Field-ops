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
test('pending checkout retries without collecting another card; closed and paid links cannot charge',async()=>{
 const html=await fs.readFile(new URL('../pay.html',import.meta.url),'utf8');
 for(const status of ['processing','paid','failed']){
 const els=Object.fromEntries(['pay','apple','message','title','amount'].map(k=>[k,{style:{},disabled:k==='pay'}]));let requests=0,loaded=0;
 const context=vm.createContext({URLSearchParams,location:{search:'?token=test'},document:{querySelector:s=>els[s.slice(1)],createElement:()=>({}),head:{append:()=>loaded++}},fetch:async(url,options)=>{if(options.body){requests++;const body=JSON.parse(options.body);assert.equal(body.source_id,'');return {ok:true,json:async()=>({status:'COMPLETED'})};}return {ok:true,json:async()=>({amount:75,title:'Test',status,expired:status==='failed'})};}});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);for(let i=0;i<30;i++)await Promise.resolve();
 assert.equal(loaded,0);if(status==='processing'){await els.pay.onclick();assert.equal(requests,1);assert.match(els.message.textContent,/recorded/);}else{assert.equal(els.pay.disabled,true);assert.equal(requests,0);}
 }
});
test('card verification includes billing contact and empty errors produce visible guidance without charging',async()=>{
 const html=await fs.readFile(new URL('../pay.html',import.meta.url),'utf8');
 const els=Object.fromEntries(['pay','apple','message','title','amount'].map(k=>[k,{style:{},disabled:false}]));let charges=0,mode='empty',tokenizations=0;
 const context=vm.createContext({URLSearchParams,location:{search:'?token=test'},document:{querySelector:s=>els[s.slice(1)],createElement:()=>({}),head:{append:s=>s.onload()}},Square:{payments:()=>({card:async()=>({attach:async()=>{},tokenize:async details=>{tokenizations++;assert.equal(typeof details.billingContact,'object');assert.equal(details.amount,'180.00');if(mode==='empty')throw {};if(mode==='postal')return {status:'Invalid',errors:[{field:'postalCode'}]};return {status:'OK',token:'card-token'};}}),paymentRequest:v=>v,applePay:async()=>{throw Error('unavailable');}})},fetch:async(url,options)=>{if(options.body){charges++;return {ok:true,json:async()=>({status:'COMPLETED'})};}return {ok:true,json:async()=>({amount:180,title:'Test',status:'open',application_id:'test',location_id:'test'})};}});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);for(let i=0;i<30;i++)await Promise.resolve();
 await els.pay.onclick();assert.match(els.message.textContent,/could not verify/);assert.equal(charges,0);
 mode='postal';await els.pay.onclick();assert.match(els.message.textContent,/billing ZIP/);assert.equal(charges,0);
 mode='success';await Promise.all([els.pay.onclick(),els.pay.onclick()]);assert.equal(charges,1);await els.pay.onclick();assert.equal(charges,1);assert.equal(tokenizations,3);
});
