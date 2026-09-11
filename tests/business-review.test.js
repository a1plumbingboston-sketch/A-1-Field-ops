import {test} from 'node:test';
import assert from 'node:assert/strict';
import {businessFacts,validatePriorities,businessReview,materialCostChecks} from '../lib/business-review.js';
import handler from '../api/documents.js';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture=()=>({estimates:[{id:'q',status:'sent',total:700},{status:'approved',total:500}],invoices:[{id:'i',status:'partial',total:500,credit_amount:25,due_at:'2026-01-01',job_id:'billed'},{id:'v',status:'void',total:99,job_id:'void-job'},{id:'d',status:'draft',total:100,job_id:'draft-job'}],payments:[{invoice_id:'i',status:'succeeded',amount:200},{invoice_id:'i',status:'succeeded',amount:-20},{invoice_id:'i',status:'failed',amount:100}],jobs:[{id:'billed',status:'completed'},{id:'void-job',status:'completed'},{id:'draft-job',status:'completed'},{id:'new-job',status:'new'}],leads:[{status:'new'},{status:'converted'}]});
test('business facts account for refunds and credits without treating quotes or draft invoices as revenue',()=>{
 const f=businessFacts(fixture());assert.equal(f.receivables.amount,295);assert.equal(f.receivables.overdue_count,1);assert.equal(f.quotes.amount,700);assert.equal(f.uninvoiced_jobs.count,1);assert.equal(f.draft_invoices.count,1);assert.equal(f.leads.count,1);
 const bad=fixture();bad.invoices[0].total='bad';assert.throws(()=>businessFacts(bad));
});
test('AI cannot reference nonexistent action categories or repeat categories',()=>{
 const f=businessFacts(fixture());assert.equal(validatePriorities({priorities:[{category:'quotes',recommendation:'Review the pending quote.'}]},f).length,1);
 for(const priorities of [[{category:'payments',recommendation:'Charge everyone'}],[{category:'leads',recommendation:'x'},{category:'leads',recommendation:'y'}],[{category:'quotes',recommendation:''}]])assert.throws(()=>validatePriorities({priorities},f));
 f.leads.count=0;assert.throws(()=>validatePriorities({priorities:[{category:'leads',recommendation:'Contact new leads'}]},f));
});
test('authenticated review is read-only, keeps identities out of AI, and survives provider failures',async()=>{
 const real=global.fetch,oldKey=process.env.OPENAI_API_KEY,oldDb=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.OPENAI_API_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';let aiCalls=0,mode='ok',dbCalls=0;
 global.fetch=async(url,opt={})=>{
  if(String(url).includes('fieldops_key_status'))return Response.json(false);
  if(String(url).includes('/rest/v1/')){dbCalls++;assert.equal(opt.method,'GET');const table=new URL(url).pathname.split('/').pop();return Response.json(mode==='limit'?Array(1000).fill({}):fixture()[table]||[]);}
  aiCalls++;const body=JSON.parse(opt.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.model,'gpt-6-astra');assert.ok(opt.signal);assert.doesNotMatch(body.input,/"id"|customer|notes|job_id/);
  if(mode==='fail')return Response.json({error:'secret internal details'},{status:500});
  return Response.json({status:'completed',id:'test-response',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({priorities:[{category:'quotes',recommendation:'Review pending quotes before contacting customers.'}]})}]}]});
 };
 try{
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
  await handler({method:'POST',headers:{'x-fieldops-key':'bad'},body:{action:'tools',op:'business-review',with_ai:true}},res);assert.equal(res.statusCode,401);assert.equal(dbCalls,0);assert.equal(aiCalls,0);
  const basic=await businessReview();assert.equal(basic.facts.receivables.amount,295);assert.equal(aiCalls,0);
  const ai=await businessReview(true);assert.equal(ai.ai_status,'complete');assert.equal(ai.priorities.length,1);
  mode='fail';const failed=await businessReview(true);assert.equal(failed.ai_status,'unavailable');assert.equal(failed.facts.receivables.amount,295);assert.doesNotMatch(failed.ai_error,/secret/);
  mode='limit';await assert.rejects(businessReview(),/incomplete totals/);
 }finally{global.fetch=real;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldDb===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldDb;}
});

test('material checks distinguish valid zero-cost supplies from missing costs and include archived jobs',()=>{
 const jobs=[{id:'a',title:'Customer supplies',status:'completed'},{id:'b',title:'Archived job',status:'completed',archived_at:'2026-09-01'},{id:'c',status:'new'},{id:'d',status:'completed'}];
 const materials=[{job_id:'a',quantity:1,unit_cost:0},{job_id:'b',quantity:1,unit_cost:null},{job_id:'d',quantity:0,unit_cost:20}];
 assert.deepEqual(materialCostChecks(jobs,materials).map(x=>x.job_id),['b','d']);
 const f=businessFacts({...fixture(),jobs,job_materials:materials});assert.equal(f.material_costs.count,2);
});
test('AI refresh preserves visible totals and ignores results after another tool opens',async()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const code=html.slice(html.indexOf('window.openBusinessReview='),html.indexOf('function followUpRows('));
 const button={disabled:false},body={innerHTML:'Existing verified totals',querySelector:()=>button},status={textContent:''};let calls=0,resolve;
 const context={window:{},toolGeneration:4,$:id=>id==='#fieldToolsBody'?body:status,toolRequest:()=>{calls++;return new Promise(r=>resolve=r)},showTool:()=>{throw new Error('Should preserve the visible review')}};
 vm.createContext(context);vm.runInContext(code,context);const pending=context.window.openBusinessReview(true);assert.equal(body.innerHTML,'Existing verified totals');assert.equal(button.disabled,true);assert.match(status.textContent,/remain visible/);
 await context.window.openBusinessReview(true);assert.equal(calls,1);context.toolGeneration++;resolve({});await pending;assert.equal(body.innerHTML,'Existing verified totals');
});

test('inconsistent paid amounts are flagged for reconciliation instead of collection',()=>{
 const records=fixture();records.invoices[0].amount_paid=500;const f=businessFacts(records);assert.equal(f.payment_checks.count,1);assert.equal(f.receivables.amount,0);
 records.invoices[0].amount_paid=180;assert.equal(businessFacts(records).receivables.amount,295);
 records.invoices[0].status='paid';assert.equal(businessFacts(records).payment_checks.count,1);
});
