import {db,uuid} from './db.js';
// Read current totals separately from the preserved agreement. Never mutate its snapshot.
export function summarizePayment(invoice,rows){
 const cents=v=>{if(v===null||v===undefined||!Number.isFinite(Number(v)))throw new Error('Incomplete payment records');return Math.round(Number(v)*100);};
 if(['void','cancelled','draft'].includes(invoice.status))return {status:'unavailable'};
 const total=cents(invoice.total),credits=cents(invoice.credit_amount??0),paid=rows.filter(p=>['paid','succeeded','completed'].includes(String(p.status).toLowerCase())).reduce((n,p)=>n+cents(p.amount),0);
 if(invoice.amount_paid===null||invoice.amount_paid===undefined||cents(invoice.amount_paid)!==paid||credits<0||total<0||paid<0)return {status:'review'};
 const balance=total-credits-paid;
 if(invoice.status==='paid'&&balance>0)return {status:'review'};
 return {status:balance<0?'credit':balance===0?'settled':rows.some(p=>['pending','processing'].includes(p.status))?'pending':'due',total:total/100,credits:credits/100,paid:paid/100,balance:balance/100};
}
export async function customerPaymentStatus(session){
 if(session.kind!=='invoice'||!uuid(session.source_id))return null;
 try{const invoices=await db(`invoices?id=eq.${session.source_id}&select=id,status,total,credit_amount,amount_paid`);if(!invoices[0])return {status:'unavailable'};
 const rows=[];for(let offset=0;offset<10000;offset+=500){const batch=await db(`payments?invoice_id=eq.${session.source_id}&select=amount,status&order=id.asc&limit=500&offset=${offset}`);rows.push(...batch);if(batch.length<500)return {...summarizePayment(invoices[0],rows),checked_at:new Date().toISOString()};}return {status:'unavailable'};
 }catch{return {status:'unavailable'};}
}
