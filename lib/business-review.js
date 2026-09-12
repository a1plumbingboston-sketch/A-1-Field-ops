import {db} from './db.js';

const cents=value=>{
 const n=Number(value??0);
 if(!Number.isFinite(n)||Math.abs(n)>1e10)throw new Error('A financial record needs review before totals can be shown.');
 return Math.round(n*100);
};
const paymentTotals=payments=>{const paid=new Map();for(const p of payments)if(['paid','succeeded','completed'].includes(String(p.status).toLowerCase()))paid.set(p.invoice_id,(paid.get(p.invoice_id)||0)+cents(p.amount));return paid;};
const needsPaymentReview=(i,paid)=>(i.amount_paid!=null&&cents(i.amount_paid)!==(paid.get(i.id)||0))||(i.status==='paid'&&cents(i.total)-cents(i.credit_amount)-(paid.get(i.id)||0)>0);
export function reconciliationChecks(invoices,payments){const paid=paymentTotals(payments);return invoices.filter(i=>!['draft','void','cancelled'].includes(i.status)&&needsPaymentReview(i,paid)).slice(0,20).map(i=>({invoice_id:i.id,number:String(i.invoice_number||i.id).slice(0,100)}));}
export function businessFacts({estimates,invoices,payments,jobs,leads,job_materials=[]},now=Date.now()){
 const paid=paymentTotals(payments);
 const issued=invoices.filter(i=>!['draft','void','cancelled'].includes(i.status));
 const paymentChecks=issued.filter(i=>needsPaymentReview(i,paid));
 const open=issued.filter(i=>!needsPaymentReview(i,paid)).map(i=>({id:i.id,balance:Math.max(0,cents(i.total)-cents(i.credit_amount)-(paid.get(i.id)||0)),overdue:Date.parse(i.due_at)<now})).filter(i=>i.balance>0);
 const awaiting=estimates.filter(q=>['sent','viewed'].includes(q.status));
 const billed=new Set(invoices.filter(i=>!['void','cancelled'].includes(i.status)).map(i=>i.job_id).filter(Boolean));
 return {
  receivables:{count:open.length,amount:open.reduce((n,i)=>n+i.balance,0)/100,overdue_count:open.filter(i=>i.overdue).length,overdue_amount:open.filter(i=>i.overdue).reduce((n,i)=>n+i.balance,0)/100},
  quotes:{count:awaiting.length,amount:awaiting.reduce((n,q)=>n+cents(q.total),0)/100},
  leads:{count:leads.filter(l=>l.status==='new').length},
  uninvoiced_jobs:{count:jobs.filter(j=>j.status==='completed'&&!billed.has(j.id)).length},
  draft_invoices:{count:invoices.filter(i=>i.status==='draft').length},
  material_costs:{count:jobs.filter(j=>j.status==='completed'&&needsMaterialCosts(j.id,job_materials)).length},
  payment_checks:{count:paymentChecks.length}
 };
}

function needsMaterialCosts(id,materials){const rows=materials.filter(m=>m.job_id===id);return !rows.length||rows.some(m=>m.unit_cost===null||m.unit_cost===undefined||!Number.isFinite(Number(m.unit_cost))||Number(m.unit_cost)<0||!Number.isFinite(Number(m.quantity))||Number(m.quantity)<=0);}
export function materialCostChecks(jobs,materials){return jobs.filter(j=>j.status==='completed'&&needsMaterialCosts(j.id,materials)).slice(0,20).map(j=>({job_id:j.id,title:String(j.title||'Completed job').slice(0,200)}));}
const categories=['receivables','quotes','leads','uninvoiced_jobs','draft_invoices','material_costs','payment_checks'];
export function validatePriorities(value,facts){
 if(!value||!Array.isArray(value.priorities)||value.priorities.length>5)throw new Error('AI returned an incomplete review. Your business totals are still available.');
 const seen=new Set();
 return value.priorities.map(p=>{
  if(!p||!categories.includes(p.category)||!facts[p.category]?.count||seen.has(p.category)||typeof p.recommendation!=='string'||!p.recommendation.trim()||p.recommendation.length>600)throw new Error('AI returned an unsupported recommendation. Your business totals are still available.');
  seen.add(p.category);return {category:p.category,recommendation:p.recommendation.trim()};
 });
}

export async function businessReview(withAI=false){
 // Read only the fields needed for the review. Never send customer identities or notes to AI.
 const selections={estimates:'id,status,total',invoices:'id,invoice_number,job_id,status,total,credit_amount,amount_paid,due_at',payments:'id,invoice_id,status,amount',jobs:'id,status,title',leads:'id,status',job_materials:'id,job_id,quantity,unit_cost'};
 const entries=await Promise.all(Object.entries(selections).map(async([table,select])=>{
  const rows=await db(`${table}?select=${select}&order=id.asc&limit=1000`);
  if(!Array.isArray(rows)||rows.length>=1000)throw new Error('Business review needs a larger data export. Review individual records; incomplete totals will not be shown.');
  return [table,rows];
 }));
 const records=Object.fromEntries(entries),facts=businessFacts(records);
 const result={facts,payment_checks:reconciliationChecks(records.invoices,records.payments),material_checks:materialCostChecks(records.jobs,records.job_materials),checked_at:new Date().toISOString(),priorities:[],ai_status:'not_requested'};
 if(!withAI)return result;
 if(!categories.some(k=>facts[k].count))return {...result,ai_status:'no_actions'};
 if(!process.env.OPENAI_API_KEY)return {...result,ai_status:'unavailable',ai_error:'AI is not connected. The business review above is still available.'};
 const model=process.env.OPENAI_BUSINESS_MODEL||'gpt-6-astra';
 try{
  const r=await fetch('https://api.openai.com/v1/responses',{
   method:'POST',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
   body:JSON.stringify({model,store:false,reasoning:{effort:'high'},max_output_tokens:4000,
    instructions:'You are the business review assistant for A-1 Plumbing & Heating. Rank up to five practical next actions using ONLY the supplied verified aggregate facts. Include only categories with nonzero count. Each recommendation should explain a useful next step in two short sentences. Do not repeat money amounts or invent customers, last-contact dates, profit, revenue, conversion rates, forecasts, urgency or completed actions. payment_checks counts inconsistent payment records excluded from receivables; recommend reconciling before customer contact, not collecting again. Outstanding invoices are not cash received; pending quotes are not booked revenue. A completed job without a linked invoice needs review, not automatic billing: it may be warranty work or billed elsewhere. A draft invoice needs review before sending. material_costs counts completed jobs with no materials recorded or missing/invalid cost or quantity. This does not prove a cost was incurred: materials may be customer supplied. Suggest checking receipts, not charging customers or inventing costs. Preserve 25% material markup and one $75 truck fee per call; do not recommend price changes. FieldOps is the authoritative appointment schedule. Any Google Calendar view is secondary. Calendar availability is not supplied; never invent open slots. No messages, payments, records or appointments can be changed by this review. Actual costs, calendar availability and external accounts are not in these facts.',
    input:JSON.stringify(facts),text:{format:{type:'json_schema',name:'business_priorities',strict:true,schema:{type:'object',additionalProperties:false,properties:{priorities:{type:'array',items:{type:'object',additionalProperties:false,properties:{category:{type:'string',enum:categories},recommendation:{type:'string'}},required:['category','recommendation']}}},required:['priorities']}}}})
  });
  if(!r.ok)throw new Error('AI review is unavailable. Check model access and API limits; the business totals are still available.');
  const j=await r.json();
  if(j.status!=='completed')throw new Error('AI did not finish its review. Please try again.');
  const text=(j.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  const priorities=validatePriorities(JSON.parse(text),facts);
  return {...result,priorities,ai_status:'complete',model,request_id:j.id||null};
 }catch(e){return {...result,ai_status:'unavailable',ai_error:e.name==='TimeoutError'?'AI review took too long. Your business totals are still available.':'AI review could not be verified. Your business totals are still available; try again later.'};}
}
