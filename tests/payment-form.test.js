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
