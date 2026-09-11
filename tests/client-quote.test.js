import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {startServer} from './dev-server.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const queryCode=html.slice(html.indexOf('(function(){\nclass Query'),html.indexOf('})();')+5);
const clientCode=html.slice(html.indexOf('function syncEstimateCustomers('),html.indexOf('function customerById('));
const saveCode=html.slice(html.indexOf("$('#estimateForm').onsubmit="),html.indexOf('window.openEstimate='));

test('client creation/editing, quote delivery, job ownership, scheduling, and stale-job protection',async()=>{
 const app=await startServer();try{
 const elements={};const el=id=>elements[id]??={value:'',style:{},innerHTML:'',focus(){},reset(){}};
 const button={disabled:false};const form={querySelector:()=>button,reset(){}};
 const notices=[];let opened,chosen;
 const row={querySelector:s=>({value:{'.item-desc':'Install faucet','.item-qty':'1','.item-unit':'350'}[s]})};
 const context=vm.createContext({window:{},quoteSaveRequestId:crypto.randomUUID(),crypto,persistQuoteDraft(){},clearQuoteDraft(){},URLSearchParams,fetch,JSON,document:{querySelectorAll:()=>[row]},$:el,esc:s=>String(s??''),currentSession:{user:{id:'0e034a68-56ff-41af-a323-80415f6570b5'}},customerCache:[],showBanner:(message,type)=>notices.push({message,type}),jobCache:[],jobMode:'all',loadCustomers:async()=>{},syncJobMode(){},loadJobs:async()=>{},setSection(){},renderCustomers(){},prefillEstimate:async id=>chosen=id,calcEstimateTotal:()=>350,addEstimateItem(){},loadEstimates:async()=>{},openEstimate:async id=>opened=id});
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
 // Editing a client updates the same record and preserves its owner and existing document snapshot.
 const before=(await app.q('select snapshot from fieldops_documents where source_id=$1',[opened]))[0].snapshot;
 context.window.editClient(chosen);el('#clientEmail').value='updated@example.test';
 await el('#customerForm').onsubmit({preventDefault(){},target:form});assert.equal(notices.at(-1).type,'success');
 assert.equal((await app.q('select count(*)::int as n from customers where id=$1',[chosen]))[0].n,1);
 const edited=(await app.q('select email,owner_id from customers where id=$1',[chosen]))[0];assert.equal(edited.email,'updated@example.test');assert.equal(edited.owner_id,customer.owner_id);
 assert.deepEqual((await app.q('select snapshot from fieldops_documents where source_id=$1',[opened]))[0].snapshot,before);
 // New job does not need an appointment; scheduling it later preserves its client and in-progress work.
 el('#jobClient').value=chosen;el('#jobTitle').value='New client repair';el('#jobSchedule').value='';
 await el('#jobForm').onsubmit({preventDefault(){},target:form});assert.equal(notices.at(-1).type,'success');
 const job=(await app.q('select * from jobs where customer_id=$1',[chosen]))[0];assert.equal(job.status,'new');assert.equal(job.scheduled_at,null);assert.equal(job.owner_id,customer.owner_id);assert.equal(job.assigned_to,customer.owner_id);
 context.jobCache=[job];await context.window.openJobForm(chosen,job.id);el('#jobSchedule').value='2026-10-02T10:30';
 await el('#jobForm').onsubmit({preventDefault(){},target:form});assert.equal(notices.at(-1).type,'success');assert.equal((await app.q('select status from jobs where id=$1',[job.id]))[0].status,'scheduled');
 await app.q("update jobs set status='in_progress' where id=$1",[job.id]);context.jobCache=await app.q('select * from jobs where id=$1',[job.id]);await context.window.openJobForm(chosen,job.id);el('#jobNotes').value='Keep current work status';
 await el('#jobForm').onsubmit({preventDefault(){},target:form});assert.equal(notices.at(-1).type,'success');assert.equal((await app.q('select status from jobs where id=$1',[job.id]))[0].status,'in_progress');
 // A stale editor must not reopen a job completed by another action.
 context.jobCache=await app.q('select * from jobs where id=$1',[job.id]);await context.window.openJobForm(chosen,job.id);
 await app.q("update jobs set status='completed' where id=$1",[job.id]);el('#jobTitle').value='Should not overwrite completed job';
 await el('#jobForm').onsubmit({preventDefault(){},target:form});assert.equal(notices.at(-1).type,'error');assert.equal((await app.q('select title from jobs where id=$1',[job.id]))[0].title,'New client repair');
 }finally{await app.close();}
});
