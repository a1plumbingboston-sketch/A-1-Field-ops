import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('invoice payment form passes the entered amount and method to payment recording',async()=>{
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 const binding=html.match(/\$\('#paymentForm'\)\.onsubmit=async e=>\{[^\n]+?\};/)[0];
 const form={},calls=[];const controls={'#paymentForm':form,'#payAmount':{value:'123.45'},'#payMethod':{value:'check'}};
 vm.runInNewContext(binding,{$:selector=>controls[selector],id:'invoice-test-id',invoice:{total:2500},recordPayment:async(...args)=>calls.push(args)});
 await form.onsubmit({preventDefault(){}});assert.deepEqual(calls[0],['invoice-test-id',123.45,'check']);
});
test('Square link form prevents duplicate requests and restores controls after failure',async()=>{
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 const source=html.split('\n').find(l=>l.startsWith('async function createSquarePaymentLink('));
 const button={disabled:false},form={querySelector:()=>button,elements:{squareAmount:{value:'125.50'}},reportValidity:()=>true};
 let resolve,calls=0,body;const messages=[];
 const ctx={document:{querySelector:()=>({isConnected:true})},Number,JSON,fetch:async(u,o)=>{calls++;body=JSON.parse(o.body);return await new Promise(r=>resolve=r);},getAccessKey:()=>'',showBanner:m=>messages.push(m)};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const pending=ctx.createSquarePaymentLink('invoice',form);await ctx.createSquarePaymentLink('invoice',form);
 assert.equal(calls,1);assert.equal(body.amount,125.50);assert.equal(button.disabled,true);
 resolve({ok:false,json:async()=>({error:'Connection unavailable'})});await pending;
 assert.equal(button.disabled,false);assert.equal(messages[0],'Connection unavailable');
 form.elements.squareAmount.value='-1';await ctx.createSquarePaymentLink('invoice',form);assert.equal(calls,1);
});
