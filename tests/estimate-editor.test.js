import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import handler from '../api/update-invoice.js';
import {estimatorContext} from '../lib/estimate-editor.js';

const owner='0e034a68-56ff-41af-a323-80415f6570b5';
const items=[{description:'Replace fixtures',quantity:2,unit_price:225},{description:'Truck fee',quantity:1,unit_price:75},{description:'Discount',quantity:1,unit_price:-25}];
const context=()=>({version:1,fields:{estQuoteMode:'service',estPricingMode:'per_task',estZip:'01970',estLaborHours:'2',estLaborRate:'287.50',estMaterialCost:'120',estMarkup:'25',estContingency:'0',estDescriptionQuestion8:'Moderate — some access or condition challenges',estDescriptionQuestion0:'Private equipment room',estDescriptionQuestion5:'Customer supplied fixtures'},construction:{project:'Two bathrooms',location:'Second floor',scope:'Install supplied fixtures',conditions:'Occupied property',exclusions:'Painting',total:'8000.00'},remodel:{project:'Bathroom',phases:[{name:'Rough',hours:'12',materials:'250'}]}});
async function fixture(t){
 const db=new PGlite(),read=p=>readFile(new URL(p,import.meta.url),'utf8');
 await db.exec(await read('./schema.sql'));
 await db.exec(await read('../supabase/migrations/20260910151939_compact_documents.sql'));
 await db.exec('alter table jobs add column archived_at timestamptz;');
 for(const p of ['20260911022416_reliable_quotes_and_scheduling.sql','20260911165952_quote_discounts.sql','20260911171637_document_archive.sql','20260919173852_full_estimate_builder_edit.sql'])await db.exec(await read('../supabase/migrations/'+p));
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const customer=(await q("insert into customers(owner_id,name) values($1,'Synthetic client') returning id",[owner]))[0].id;
 const otherCustomer=(await q("insert into customers(owner_id,name) values($1,'Other synthetic client') returning id",[owner]))[0].id;
 const job=(await q("insert into jobs(owner_id,customer_id,title) values($1,$2,'Fixture work') returning id",[owner,customer]))[0].id;
 const otherJob=(await q("insert into jobs(owner_id,customer_id,title) values($1,$2,'Another customer job') returning id",[owner,otherCustomer]))[0].id;
 const previousFetch=global.fetch,previousKey=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';let rpcCalls=0;
 global.fetch=async(url,options={})=>{
  if(String(url).includes('fieldops_key_status'))return Response.json(options.headers['x-fieldops-key']==='test');
  if(String(url).includes('/rest/v1/rpc/')){
   rpcCalls++;const fn=String(url).split('/rpc/')[1],entries=Object.entries(JSON.parse(options.body));assert.match(fn,/^fieldops_[a-z_]+$/);
   try{return Response.json((await q(`select ${fn}(${entries.map(([key],i)=>key+' => $'+(i+1)).join(',')}) as result`,entries.map(([,value])=>value)))[0].result);}catch(e){return Response.json({message:e.message},{status:400});}
  }
  throw new Error('Unexpected external request in isolated test');
 };
 const api=async(body,key='test')=>{const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};await handler({method:'POST',headers:{'x-fieldops-key':key},body},res);return res;};
 const payload=(patch={})=>({action:'save_estimate',estimate_id:null,request_id:crypto.randomUUID(),customer_id:customer,job_id:job,title:'Two fixtures',description:'Install supplied fixtures',items:structuredClone(items),estimator_context:context(),...patch});
 const load=id=>api({action:'load_estimate',id});
 t.after(async()=>{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previousKey;await db.close();});
 return {db,q,customer,otherCustomer,job,otherJob,api,payload,load,rpcCalls:()=>rpcCalls};
}

test('full quote saves and reopens exact private inputs atomically; retries return the same quote',async t=>{
 const f=await fixture(t),request=f.payload();
 assert.equal((await f.api(request,'')).statusCode,401);assert.equal(f.rpcCalls(),0);
 await f.db.exec('set role service_role');
 const saved=await f.api(request);assert.equal(saved.statusCode,200,JSON.stringify(saved.body));assert.equal(saved.body.created,true);
 const retry=await f.api(request);assert.equal(retry.body.id,saved.body.id);assert.equal(retry.body.existing,true);
 assert.equal((await f.q('select count(*)::int n from estimates'))[0].n,1);
 const loaded=await f.load(saved.body.id);assert.equal(loaded.statusCode,200);assert.equal(loaded.body.doc.total,500);assert.equal(loaded.body.estimator_context.fields.estLaborRate,'287.50');assert.equal(loaded.body.estimator_context.fields.estDescriptionQuestion0,'Private equipment room');assert.deepEqual(loaded.body.estimator_context.remodel,context().remodel);assert.deepEqual(loaded.body.estimator_context.construction,context().construction);assert.equal(loaded.body.locked,false);assert.equal(loaded.body.context_available,true);
 assert.equal((await f.api({...request,title:'Changed same request'})).statusCode,409);
 const customerData=(await f.q("select fieldops_document_data('estimate',$1) d",[saved.body.id]))[0].d;
 assert.equal(customerData.doc.estimator_context,undefined);assert.equal(customerData.doc.create_request_payload,undefined);assert.ok(!JSON.stringify(customerData).includes('Private equipment room'));
 await f.db.exec('reset role');
 await f.db.exec("create function fail_editor_save() returns trigger language plpgsql as $$begin raise exception 'simulated journal failure';end$$;create trigger fail_editor_save before insert on fieldops_estimate_saves for each row execute function fail_editor_save();");
 const failed=await f.api(f.payload({title:'Must roll back'}));assert.notEqual(failed.statusCode,200);assert.equal((await f.q('select count(*)::int n from estimates'))[0].n,1);
});

test('unsigned edits replace every field, keep tax and notes, reject stale writes and wrong customer jobs',async t=>{
 const f=await fixture(t),created=await f.api(f.payload()),id=created.body.id;
 await f.q("update estimates set tax=12,notes='Existing internal note' where id=$1",[id]);
 const unsignedData=(await f.q("select fieldops_document_data('estimate',$1) d",[id]))[0].d;
 await f.q("select fieldops_start_document('estimate',$1,$2,$3::jsonb)",[id,'u'.repeat(43),JSON.stringify(unsignedData)]);
 const before=(await f.load(id)).body;
 const invalid=await f.api(f.payload({estimate_id:id,expected_revision:before.revision,job_id:f.otherJob}));assert.equal(invalid.statusCode,400);
 const request=f.payload({estimate_id:id,expected_revision:before.revision,customer_id:f.otherCustomer,job_id:f.otherJob,title:'Changed project',description:'Updated complete scope',items:[{description:'New fixed task',quantity:3,unit_price:200}],estimator_context:{...context(),fields:{...context().fields,estLaborHours:'5',estMaterialCost:'400'}}});
 const saved=await f.api(request);assert.equal(saved.statusCode,200,JSON.stringify(saved.body));assert.equal(saved.body.updated,true);assert.equal(saved.body.total,612);
 assert.equal((await f.api(request)).body.existing,true);
 const after=(await f.load(id)).body;assert.equal(after.doc.customer_id,f.otherCustomer);assert.equal(after.doc.job_id,f.otherJob);assert.equal(after.doc.notes,'Existing internal note');assert.equal(after.doc.tax,12);assert.equal(after.estimator_context.fields.estLaborHours,'5');assert.equal(after.items.length,1);assert.equal(after.items[0].quantity,3);
 assert.ok((await f.q('select superseded_at from fieldops_documents where token=$1',['u'.repeat(43)]))[0].superseded_at,'the old customer link is superseded in the edit transaction');
 await assert.rejects(f.q('select fieldops_sign_document($1,$2,$3,$4,now(),$5,$6)',['u'.repeat(43),'Customer','s'.repeat(1000),'','p'.repeat(1000),'c'.repeat(64)]),/expired or replaced/);
 const stale=await f.api({...request,request_id:crypto.randomUUID(),title:'Stale second device'});assert.equal(stale.statusCode,409);assert.match(stale.body.error,/changed/);
 // Legacy item writes are included in the content fingerprint too.
 await f.q('update estimate_items set unit_price=210,line_total=630 where estimate_id=$1',[id]);
 assert.equal((await f.api({...request,request_id:crypto.randomUUID(),expected_revision:after.revision})).statusCode,409);
});

test('signed editing creates one change order and preserves the original signature, scope and context',async t=>{
 const f=await fixture(t),created=await f.api(f.payload()),id=created.body.id;
 const snapshot=(await f.q("select fieldops_document_data('estimate',$1) d",[id]))[0].d;
 await f.q("select fieldops_start_document('estimate',$1,$2,$3::jsonb)",[id,'z'.repeat(43),JSON.stringify(snapshot)]);
 await f.q('select fieldops_sign_document($1,$2,$3,$4,now(),$5,$6)',['z'.repeat(43),'Synthetic customer','s'.repeat(1000),'','p'.repeat(1000),'a'.repeat(64)]);
 const original=(await f.q('select to_jsonb(e) data from estimates e where id=$1',[id]))[0].data;
 const signed=(await f.q('select snapshot,signed_pdf,signed_pdf_sha256 from fieldops_documents where source_id=$1',[id]))[0];
 const before=(await f.load(id)).body;assert.equal(before.locked,true);
 const reassign=await f.api(f.payload({estimate_id:id,expected_revision:before.revision,customer_id:f.otherCustomer,job_id:f.otherJob}));assert.equal(reassign.statusCode,409);assert.match(reassign.body.error,/Save as new/);
 const request=f.payload({estimate_id:id,expected_revision:before.revision,title:'Revised scope',items:[{description:'Revised fixed work',quantity:1,unit_price:800}],estimator_context:{...context(),fields:{...context().fields,estLaborHours:'4'}}});
 const saved=await f.api(request);assert.equal(saved.statusCode,200,JSON.stringify(saved.body));assert.ok(saved.body.change_order_id);assert.equal(saved.body.total,300);assert.equal(saved.body.revised_total,800);assert.equal((await f.api(request)).body.existing,true);
 assert.deepEqual((await f.q('select to_jsonb(e) data from estimates e where id=$1',[id]))[0].data,original);assert.deepEqual((await f.q('select snapshot,signed_pdf,signed_pdf_sha256 from fieldops_documents where source_id=$1',[id]))[0],signed);
 const pending=(await f.load(id)).body;assert.equal(pending.pending_change_order_id,saved.body.change_order_id);
 const blocked=await f.api({...request,request_id:crypto.randomUUID(),expected_revision:pending.revision});assert.equal(blocked.statusCode,409);assert.match(blocked.body.error,/pending/);
 const coData=(await f.q("select fieldops_document_data('change_order',$1) d",[saved.body.change_order_id]))[0].d;assert.equal(coData.doc.estimator_context,undefined);
 await f.q("select fieldops_start_document('change_order',$1,$2,$3::jsonb)",[saved.body.change_order_id,'y'.repeat(43),JSON.stringify(coData)]);
 await f.q('select fieldops_sign_document($1,$2,$3,$4,now(),$5,$6)',['y'.repeat(43),'Synthetic customer','s'.repeat(1000),'','p'.repeat(1000),'b'.repeat(64)]);
 const approved=(await f.load(id)).body;assert.equal(approved.doc.title,'Revised scope');assert.equal(approved.doc.total,800);assert.equal(approved.estimator_context.fields.estLaborHours,'4');assert.equal(approved.items[0].unit_price,800);
});

test('approved without signature is locked; unchanged completed jobs remain editable; private RPCs deny public access',async t=>{
 const f=await fixture(t),created=await f.api(f.payload()),id=created.body.id;
 await f.q("update jobs set status='completed',archived_at=now() where id=$1",[f.job]);
 const before=(await f.load(id)).body;
 const retained=await f.api(f.payload({estimate_id:id,expected_revision:before.revision,title:'Retain historic job'}));assert.equal(retained.statusCode,200,JSON.stringify(retained.body));
 assert.equal((await f.api(f.payload({title:'New quote cannot attach completed job'}))).statusCode,400);
 await f.q("update estimates set status='approved' where id=$1",[id]);const approved=(await f.load(id)).body;assert.equal(approved.locked,true);
 const changed=await f.api(f.payload({estimate_id:id,expected_revision:approved.revision,title:'Approval protected'}));assert.equal(changed.statusCode,200);assert.ok(changed.body.change_order_id);
 await f.db.exec('set role anon');await assert.rejects(f.q('select fieldops_load_estimate_editor($1)',[id]),/permission denied/);await assert.rejects(f.q('select * from fieldops_estimate_saves'),/permission denied/);await f.db.exec('reset role');
 const security=await f.q("select proname,prosecdef from pg_proc where proname in ('fieldops_load_estimate_editor','fieldops_save_estimate_editor')");assert.equal(security.length,2);assert.ok(security.every(row=>!row.prosecdef));
 assert.equal((await f.q("select relrowsecurity from pg_class where relname='fieldops_estimate_saves'"))[0].relrowsecurity,true);
});

test('context validates bounds, preserves owner-entered rates, and never accepts prototype keys',()=>{
 const c=estimatorContext(context());assert.equal(c.fields.estLaborRate,'287.50');
 assert.throws(()=>estimatorContext({...context(),fields:{estLaborHours:'-1'}}),/Check/);
 assert.throws(()=>estimatorContext({...context(),remodel:JSON.parse('{"__proto__":{"danger":true}}')}),/Invalid/);
 assert.throws(()=>estimatorContext({...context(),remodel:{scope:'x'.repeat(9000)}}),/too long/);
 assert.throws(()=>estimatorContext({...context(),construction:{scope:'x'.repeat(16001)}}),/too long/);
 assert.throws(()=>estimatorContext({...context(),construction:{total:'10000001'}}),/total/);
 const zero=estimatorContext({...context(),construction:{project:'Zero-price walkthrough',total:0}});assert.equal(zero.construction.total,'0');
 const blank=estimatorContext({...context(),fields:{estLaborRate:''},construction:{total:''}});assert.equal(blank.fields.estLaborRate,'');assert.equal(blank.construction.total,'');
});

test('POST save/load round-trips long construction scope and custom rates without repricing the owner’s items',async t=>{
 const f=await fixture(t);
 const description='Detailed construction scope.\n'+'x'.repeat(19000);
 const construction={project:'Full house remodel',location:'Second floor',scope:'Observed scope\n'+'s'.repeat(15000),conditions:'Limited clearance',exclusions:'No painting',total:'18000.50'};
 const savedContext={version:1,fields:{estQuoteMode:'remodel',estPricingMode:'per_task',estZip:'01970',estLaborHours:'42.5',estLaborRate:'312.75',estMaterialCost:'5000.00',estMarkup:'17.5',estContingency:'0',estDescriptionQuestion8:'Moderate — site access'},construction};
 const fixedItems=[{description:'Approved owner-priced construction scope',quantity:1,unit_price:18000.50}];
 const request=f.payload({description,items:fixedItems,estimator_context:savedContext});
 const saved=await f.api(request);assert.equal(saved.statusCode,200,JSON.stringify(saved.body));
 const loaded=await f.load(saved.body.id);assert.equal(loaded.statusCode,200);assert.equal(loaded.body.doc.description,description);assert.equal(loaded.body.doc.total,18000.5);
 assert.deepEqual(loaded.body.estimator_context.fields,savedContext.fields);assert.deepEqual(loaded.body.estimator_context.construction,construction);assert.equal(loaded.body.items[0].unit_price,18000.5);
 const revisedContext={...savedContext,fields:{...savedContext.fields,estLaborRate:'349.25',estLaborHours:'48'},construction:{...construction,conditions:'Elevator unavailable'}};
 const changed=await f.api({...request,request_id:crypto.randomUUID(),estimate_id:saved.body.id,expected_revision:loaded.body.revision,estimator_context:revisedContext});assert.equal(changed.statusCode,200,JSON.stringify(changed.body));
 const reopened=(await f.load(saved.body.id)).body;assert.equal(reopened.estimator_context.fields.estLaborRate,'349.25');assert.equal(reopened.estimator_context.construction.conditions,'Elevator unavailable');assert.equal(reopened.doc.total,18000.5);assert.equal(reopened.items[0].unit_price,18000.5);
 const before=f.rpcCalls();const tooLong=await f.api({...request,request_id:crypto.randomUUID(),description:'x'.repeat(20001)});assert.equal(tooLong.statusCode,400);assert.equal(f.rpcCalls(),before);
});
