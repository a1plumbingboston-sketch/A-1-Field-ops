import {authorized,uuid,db,error} from '../lib/db.js';
import {prepare,start,D} from '../lib/documents.js';
import {buildPdf} from '../lib/document-pdf.js';
import {sendMail,validateDelivery} from '../lib/mail.js';
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'POST only'});try{if(!await authorized(req))return res.status(401).json({error:'Authentication required'});const {kind,id}=req.body||{};if(!uuid(id)||!D.labels[kind])return res.status(400).json({error:'Invalid document'});if(req.body.action!=='link')validateDelivery((await prepare(kind,id)).customer.email);const record=kind==='receipt'?null:await start(kind,id),snapshot=record?.snapshot||await prepare(kind,id);const origin=process.env.FIELDOPS_PUBLIC_URL||`https://${req.headers.host}`;const signingUrl=record?`${origin.replace(/\/$/,'')}/customer-sign.html?token=${encodeURIComponent(record.token)}`:null;
 if(req.body.action==='link')return res.status(200).json({signing_url:signingUrl,signed:!!record?.signed_at});
 const pdf=record?.signed_pdf?Buffer.from(record.signed_pdf,'base64'):await buildPdf(snapshot);const label=D.labels[kind],number=D.model(snapshot).number;const sent=await sendMail({to:snapshot.customer.email,subject:`A-1 ${label} #${number}`,html:`<div style="font-family:Arial;color:#161616"><h2>A-1 Plumbing & Heating Co.</h2><p>Your ${D.esc(label.toLowerCase())} is attached.</p>${signingUrl?`<p><a href="${D.esc(signingUrl)}">${record.signed_at?'View signed copy':'Review & Sign'}</a></p>`:''}<p>339-224-4517 · Built on Trust.</p></div>`,pdf,filename:`A1-${kind}-${number}.pdf`});
 // Sending a copy must not turn a paid or approved document back into 'sent'.
 let warning;
 try{if(['estimate','invoice'].includes(kind))await db(`${kind==='estimate'?'estimates':'invoices'}?id=eq.${id}&status=eq.draft`,{method:'PATCH',body:{status:'sent',sent_at:new Date().toISOString()}});}catch{warning='Email accepted, but the document status could not update. Refresh before sending again.';}
 return res.status(200).json({sent:true,warning,email_id:sent.id,to:snapshot.customer.email});}catch(e){return error(res,e);}}
