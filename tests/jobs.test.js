import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {startServer} from './dev-server.js';
test('lead conversion resolves established owner despite two auth users, stays idempotent and fails safely for ambiguity',async()=>{
 const app=await startServer();try{
  const lead=(await app.q('select id from leads limit 1'))[0].id;
  const call=async id=>{const r=await fetch(app.origin+'/api/convert-lead',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify({lead_id:id})});return {status:r.status,body:await r.json()};};
  const first=await call(lead);assert.equal(first.status,200,JSON.stringify(first));
  const job=(await app.q('select * from jobs where id=$1',[first.body.job_id]))[0];assert.equal(job.owner_id,'0e034a68-56ff-41af-a323-80415f6570b5');
  const again=await call(lead);assert.equal(again.body.already_converted,true);assert.equal(again.body.job_id,job.id);
  await app.q("insert into customers(owner_id,name) values('969120b1-57fa-4c59-aeee-2673388f037b','Other business')");
  const unassigned=(await app.q("insert into leads(name,phone) values('Ambiguous','5550102') returning id"))[0].id;
  assert.equal((await call(unassigned)).status,409);
  assert.equal((await app.q('select customer_id from leads where id=$1',[unassigned]))[0].customer_id,null);
  await app.q("update leads set owner_id='0e034a68-56ff-41af-a323-80415f6570b5' where id=$1",[unassigned]);assert.equal((await call(unassigned)).status,200);
  await app.db.exec('set role anon');await assert.rejects(app.q('select fieldops_convert_lead($1,null)',[lead]),/permission denied/);await app.db.exec('reset role');
 }finally{await app.close();}
});
test('archive completed job and restore preserve invoice; active jobs cannot be archived',async()=>{
 const app=await startServer();try{
  await assert.rejects(app.q('update jobs set archived_at=now() where id=$1',[app.job]),/jobs_archive_completed_only/);
  const completion=(await app.q('select fieldops_complete_job($1,null) as result',[app.job]))[0].result;
  await app.q('update jobs set archived_at=now() where id=$1',[app.job]);
  assert.equal((await app.q('select id from jobs where archived_at is null and id=$1',[app.job])).length,0);
  assert.equal((await app.q('select id from invoices where id=$1',[completion.invoice_id])).length,1);
  await app.q('update jobs set archived_at=null where id=$1',[app.job]);assert.equal((await app.q('select id from jobs where archived_at is null and id=$1',[app.job])).length,1);
 }finally{await app.close();}
});
test('job page filters archives out of active views and offers restore',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const start=html.indexOf('function renderJobs()'),end=html.indexOf('window.archiveJob=',start);const el={};
 const context=vm.createContext({jobMode:'all',jobCache:[{id:'a',title:'Active job',status:'completed'},{id:'b',title:'Archived job',status:'completed',archived_at:'2026-09-10'}],$:()=>el,esc:s=>s||'',jobDate:()=>'',isToday:()=>true});
 vm.runInContext(html.slice(start,end)+';renderJobs()',context);assert.match(el.innerHTML,/Active job/);assert.doesNotMatch(el.innerHTML,/Archived job/);assert.match(el.innerHTML,/Remove from page/);
 vm.runInContext("jobMode='archived';renderJobs()",context);assert.match(el.innerHTML,/Archived job/);assert.match(el.innerHTML,/Restore job/);assert.doesNotMatch(el.innerHTML,/Active job/);
});
