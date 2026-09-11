import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {startServer} from './dev-server.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const queryCode=html.slice(html.indexOf('(function(){\nclass Query'),html.indexOf('})();')+5);
const clientCode=html.slice(html.indexOf('function syncEstimateCustomers('),html.indexOf('function customerById('));
const saveCode=html.slice(html.indexOf("$('#estimateForm').onsubmit="),html.indexOf('window.openEstimate='));

test('new client → quote without a job → PDF email; wrong-client job is rejected',async()=>{
 const app=await startServer();try{
 const elements={};const el=id=>elements[id]??={value:'',style:{},innerHTML:'',focus(){}};
 const button={disabled:false};const form={querySelector:()=>button,reset(){}};
 const notices=[];let opened,chosen;
 const row={querySelector:s=>({value:{'.item-desc':'Install faucet','.item-qty':'1','.item-unit':'350'}[s]})};
 const context=vm.createContext({window:{},URLSearchParams,fetch,JSON,document:{querySelectorAll:()=>[row]},$:el,esc:s=>String(s??''),currentSession:{user:{id:'0e034a68-56ff-41af-a323-80415f6570b5'}},customerCache:[],showBanner:(message,type)=>notices.push({message,type}),setSection(){},renderCustomers(){},prefillEstimate:async id=>chosen=id,calcEstimateTotal:()=>350,addEstimateItem(){},loadEstimates:async()=>{},openEstimate:async id=>opened=id});
 vm.runInContext(queryCode,context);context.sb=context.window.supabase.createClient(app.origin,'test');context.sb.setAccessKey('test-key');vm.runInContext(clientCode,context);
 el('#clientName').value='New Quote Client';el('#clientEmail').value='new-client@example.test';el('#clientState').value='MA';
 await el('#customerForm').onsubmit({preventDefault(){},target:form});
 assert.equal(notices.at(-1).type,'success');assert.ok(chosen);assert.equal(button.disabled,false);
 const customer=(await app.q('select * from customers where id=$1',[chosen]))[0];assert.equal(customer.owner_id,'0e034a68-56ff-41af-a323-80415f6570b5');assert.equal(customer.email,'new-client@example.test');
 context.customerById=id=>context.customerCache.find(x=>x.id===id);vm.runInContext(saveCode,context);
 el('#estCustomerId').value=chosen;el('#estJobId').value=app.job;el('#estTitle').value='New client faucet';
 await el('#estimateForm').onsubmit({preventDefault(){},target:form});assert.match(notices.at(-1).message,/job belonging to this client/);assert.equal((await app.q('select * from estimates where customer_id=$1',[chosen])).length,0);
 el('#estJobId').value='';await el('#estimateForm').onsubmit({preventDefault(){},target:form});assert.ok(opened);assert.equal(notices.at(-1).type,'success');
 const quote=(await app.q('select * from estimates where id=$1',[opened]))[0];assert.equal(quote.customer_id,chosen);assert.equal(quote.job_id,null);assert.equal(Number(quote.total),350);assert.equal((await app.q('select * from estimate_items where estimate_id=$1',[opened])).length,1);
 const response=await fetch(app.origin+'/api/send-document',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify({kind:'estimate',id:opened})});assert.equal(response.status,200);assert.equal((await response.json()).sent,true);assert.deepEqual(app.mails.at(-1).to,['new-client@example.test']);assert.equal((await app.q('select status from estimates where id=$1',[opened]))[0].status,'sent');
 }finally{await app.close();}
});
