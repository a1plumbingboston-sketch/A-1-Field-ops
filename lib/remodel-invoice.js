import {db,uuid} from './db.js';
export const remodelInvoiceRules=`For remodels, distinguish the approved contract scope from the stage currently being billed. A quote is evidence of planned work, not proof of completion. Review the linked approved quote, approved change orders, manager billing notes and owner-approved technician reports together. Deposit requests describe a payment toward proposed work and must not imply work is complete. Progress invoices name only the documented completed stage and identify remaining work when needed. Final invoices must not claim all work is complete if testing, inspections or punch-list work remain unresolved. If the billing stage or completed work is unknown, keep wording neutral and add review_notes. Never invent deposit percentages, payment milestones, amounts due, prior payments, balances, permit approvals, warranty coverage or passed tests. Never add change orders to the current invoice, repeat already billed work, or imply an unapproved change is authorized. Existing line quantities and prices remain unchanged. Flag potential duplication or mismatches for the owner. Keep the customer description to 1–2 concise sentences, normally 15–35 words; detailed internal reports stay internal.`;
export async function remodelInvoiceContext(invoiceId){
 if(!uuid(invoiceId))return {approved_quote:'',approved_changes:[]};
 const rows=await db(`invoices?id=eq.${invoiceId}&select=estimate_id&limit=1`),estimateId=rows[0]?.estimate_id;
 let quote='';
 if(uuid(estimateId)){
  const estimates=await db(`estimates?id=eq.${estimateId}&status=in.(approved,converted)&select=title,description&limit=1`);
  if(estimates[0])quote=JSON.stringify(estimates[0]).slice(0,5000);
 }
 const parents=[invoiceId,...(uuid(estimateId)?[estimateId]:[])].join(',');
 const changes=await db(`fieldops_change_orders?parent_id=in.(${parents})&status=eq.approved&select=title,description,status,billing_invoice_id&order=created_at.asc&limit=30`);
 return {approved_quote:quote,approved_changes:changes.map(c=>({title:String(c.title||'').slice(0,300),description:String(c.description||'').slice(0,1200),separately_invoiced:!!c.billing_invoice_id}))};
}
