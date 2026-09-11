import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from './dev-server.js';
const owner='0e034a68-56ff-41af-a323-80415f6570b5';
const items=[{description:'Install faucet',quantity:1,unit_price:275}];
test('quote save is atomic and retry-safe; signed quote schedules once and completes at its approved price',async()=>{
 const app=await startServer();try{
 await app.q('update customers set owner_id=$1 where id=$2',[owner,app.customer]);
 const request=crypto.randomUUID();const args=[request,app.customer,null,'Faucet','Replace faucet',JSON.stringify(items)];
 const create=(values=args)=>app.q('select fieldops_create_quote($1,$2,$3,$4,$5,$6::jsonb) as result',values).then(rows=>rows[0].result);
 const before=(await app.q('select count(*)::int as n from estimates'))[0].n;
 await app.db.exec("create function fail_test_items() returns trigger language plpgsql as $$begin raise exception 'simulated storage failure';end$$;create trigger fail_test_items before insert on estimate_items for each row execute function fail_test_items();");
 await assert.rejects(create(),/simulated storage failure/);assert.equal((await app.q('select count(*)::int as n from estimates'))[0].n,before);
 await app.db.exec('drop trigger fail_test_items on estimate_items;drop function fail_test_items();');
 const saved=await create();assert.equal(saved.existing,false);assert.equal((await create()).id,saved.id);assert.equal((await create()).existing,true);assert.equal((await app.q('select count(*)::int as n from estimate_items where estimate_id=$1',[saved.id]))[0].n,1);
 await assert.rejects(create([...args.slice(0,3),'Different title',...args.slice(4)]),/different quote/);
 await assert.rejects(app.q('select fieldops_schedule_quote($1,null)',[saved.id]),/Approve the quote/);
 // Sign the quote with a synthetic immutable snapshot using the real database signing transaction.
 const data=(await app.q("select fieldops_document_data('estimate',$1) as d",[saved.id]))[0].d;
 const token='q'.repeat(43);await app.q("select fieldops_start_document('estimate',$1,$2,$3::jsonb)",[saved.id,token,JSON.stringify(data)]);
 await app.q('select fieldops_sign_document($1,$2,$3,$4,now(),$5,$6)',[token,'Test customer','test-signature'.repeat(100),'','test-pdf'.repeat(100),'a'.repeat(64)]);
 const original=(await app.q('select snapshot,signed_pdf,signed_pdf_sha256 from fieldops_documents where token=$1',[token]))[0];
 const schedule=()=>app.q('select fieldops_schedule_quote($1,$2) as result',[saved.id,'2026-10-02T14:30:00Z']).then(rows=>rows[0].result);
 const job=await schedule();assert.equal(job.existing,false);assert.equal((await schedule()).job_id,job.job_id);assert.equal((await schedule()).existing,true);
 assert.equal((await app.q('select job_id from estimates where id=$1',[saved.id]))[0].job_id,null);
 const linked=(await app.q('select * from jobs where id=$1',[job.job_id]))[0];assert.equal(linked.source_estimate_id,saved.id);assert.equal(linked.status,'scheduled');
 assert.deepEqual((await app.q('select snapshot,signed_pdf,signed_pdf_sha256 from fieldops_documents where token=$1',[token]))[0],original);
 const completed=(await app.q('select fieldops_complete_job($1,null) as result',[job.job_id]))[0].result;
 const invoice=(await app.q('select total,estimate_id,job_id from invoices where id=$1',[completed.invoice_id]))[0];assert.equal(Number(invoice.total),275);assert.equal(invoice.estimate_id,saved.id);assert.equal(invoice.job_id,job.job_id);
 assert.equal((await app.q('select fieldops_complete_job($1,null) as result',[job.job_id]))[0].result.invoice_id,completed.invoice_id);
 // Invoker RPCs cannot read or create records without table access.
 await app.db.exec('set role anon');await assert.rejects(create(),/permission denied/);await assert.rejects(schedule(),/permission denied/);await app.db.exec('reset role');
 }finally{await app.close();}
});

test('quote discounts persist, reject excess and survive invoice conversion',async()=>{
 const app=await startServer();try{
 await app.q('update customers set owner_id=$1 where id=$2',[owner,app.customer]);
 const rows=[...items,{description:'Truck fee',quantity:1,unit_price:75},{description:'Discount',quantity:1,unit_price:-50}];
 const create=r=>app.q('select fieldops_create_quote($1,$2,null,$3,$4,$5::jsonb) as result',[crypto.randomUUID(),app.customer,'Discount test','Scope',JSON.stringify(r)]).then(x=>x[0].result);
 const saved=await create(rows);assert.equal(Number((await app.q('select total from estimates where id=$1',[saved.id]))[0].total),300);
 await assert.rejects(create([...items,{description:'Discount',quantity:1,unit_price:-500}]),/Discount exceeds/);
 await assert.rejects(create([...items,{description:'Other',quantity:1,unit_price:-1}]),/Invalid line/);
 const edit=await app.q("select fieldops_edit_document('estimate',$1,'Discount test','Scope',$2::jsonb) as result",[saved.id,JSON.stringify([...items,{description:'Discount',quantity:1,unit_price:-25}])]);assert.equal(Number(edit[0].result.total),250);
 await app.q("update estimates set status='approved' where id=$1",[saved.id]);
 const response=await fetch(app.origin+'/api/complete-job',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify({estimate_id:saved.id})});assert.equal(response.status,200);const invoice=await response.json();assert.equal(Number((await app.q('select total from invoices where id=$1',[invoice.invoice_id]))[0].total),250);
 assert.equal(Number((await app.q("select unit_price from invoice_items where invoice_id=$1 and description='Discount'",[invoice.invoice_id]))[0].unit_price),-25);
 }finally{await app.close();}
});
