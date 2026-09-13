import {createHash} from 'node:crypto';
import {db} from './db.js';
import {prepare,start,D} from './documents.js';
import {buildPdf} from './document-pdf.js';
import {sendMail,validateDelivery} from './mail.js';
export const receiptId=event=>{const h=createHash('sha256').update('a1-payment-receipt:'+event).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
export const phoneNumber=v=>{const n=String(v||'').replace(/\D/g,'');return n.length===10?'+1'+n:n.length===11&&n[0]==='1'?'+'+n:'';};
export const smsReady=()=>process.env.TWILIO_SMS_ENABLED==='true'&&!!(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&process.env.TWILIO_MESSAGING_SERVICE_SID);
export async function receiptPreference(customer){const rows=await db(`fieldops_deliveries?kind=eq.receipt_preference&source_id=eq.${customer.id}&order=created_at.desc&limit=1`);return rows[0];}
async function mayText(customer){
 const phone=phoneNumber(customer.phone);if(!phone||!smsReady())return false;
 const pref=await receiptPreference(customer);if(pref?.status!=='sms_allowed'||pref.recipient!==phone)return false;
 const messages=await db(`fieldops_text_messages?from_number=eq.${encodeURIComponent(phone)}&order=created_at.desc&limit=100`);
 // A recorded opt-out blocks automatic receipts until explicit opt-in is recorded again.
 return !messages.some(m=>/^(stop|stopall|unsubscribe|cancel|end|quit)\b/i.test(String(m.body||'').trim())&&Date.parse(m.created_at)>=Date.parse(pref.created_at));
}
export async function autoPaymentReceipt({invoiceId,event,amount}){
 if(!Number.isFinite(amount)||amount<=0)throw Error('A confirmed positive payment is required.');
 const id=receiptId(event),existing=await db(`fieldops_deliveries?id=eq.${id}&limit=1`);
 if(existing[0])return {status:existing[0].status,duplicate:true};
 // Claim the event before contacting a provider. The primary key blocks concurrent webhook/payment-page sends.
 try{await db('fieldops_deliveries',{method:'POST',body:{id,kind:'receipt',source_id:invoiceId,recipient:'pending',status:'preparing',detail:'Automatic receipt for a confirmed payment.'}});}catch(e){const saved=await db(`fieldops_deliveries?id=eq.${id}&limit=1`);if(saved[0])return {status:saved[0].status,duplicate:true};throw e;}
 let providerContacted=false;
 const update=body=>db(`fieldops_deliveries?id=eq.${id}`,{method:'PATCH',body});
 try{
  const snapshot=await prepare('receipt',invoiceId),customer=snapshot.customer||{},name=String(customer.name||'Customer').replace(/[\r\n]/g,' ').slice(0,160);
  const email=String(customer.email||'').trim();let sent;
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
   validateDelivery(email);const pdf=await buildPdf(snapshot);await update({recipient:email,status:'sending',detail:`Email receipt for ${D.money(amount)} received.`});providerContacted=true;
   sent=await sendMail({to:email,subject:`${name} — A-1 payment receipt`,html:`<div style="font-family:Arial;color:#382923;max-width:600px"><h2>Thank you, ${D.esc(name)}.</h2><p>We recorded your payment of <b>${D.money(amount)}</b>.</p><p>Your payment receipt is attached. It shows the recorded payments and any remaining invoice balance.</p><p>A-1 Plumbing &amp; Heating Co.<br>339-224-4517</p></div>`,pdf,filename:`A1-Receipt-${name.replace(/[^a-z0-9 -]/gi,'').trim()||'Customer'}.pdf`,idempotencyKey:'receipt-'+id});
  }else if(await mayText(customer)){
   const origin=process.env.FIELDOPS_PUBLIC_URL||'https://a-1-field-ops.vercel.app';if(!origin.startsWith('https://'))throw Error('A secure public receipt address is required.');
   const record=await start('receipt',invoiceId),url=origin.replace(/\/$/,'')+'/api/payment-receipt?token='+encodeURIComponent(record.token),phone=phoneNumber(customer.phone);
   await update({recipient:phone,status:'sending',detail:`Text receipt for ${D.money(amount)} received.`});providerContacted=true;
   const account=process.env.TWILIO_ACCOUNT_SID;const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:phone,MessagingServiceSid:process.env.TWILIO_MESSAGING_SERVICE_SID,Body:`A-1 Plumbing & Heating: Payment of ${D.money(amount)} received. Your receipt: ${url} Reply STOP to opt out.`}).toString()});const j=await r.json();if(!r.ok||!j.sid)throw Error('Text receipt could not be confirmed. Check Twilio delivery activity before retrying.');sent={id:j.sid};
  }else{await update({recipient:email||phoneNumber(customer.phone)||'No contact available',status:'needs_contact',detail:'Add a valid email, or record customer permission for text receipts after business texting is enabled.'});return {status:'needs_contact'};}
  await update({provider_id:sent.id,status:'sent',detail:`Receipt accepted by provider for ${D.money(amount)}. Check delivery activity for final delivery.`});return {status:'sent'};
 }catch(e){const status=providerContacted?'unconfirmed':'failed';await update({status,detail:String(e.message||'Receipt needs review.').slice(0,1000)}).catch(()=>{});return {status};}
}
export async function safePaymentReceipt(x){try{return await autoPaymentReceipt(x);}catch{console.error('Payment receipt tracking needs attention for invoice '+x.invoiceId);return {status:'tracking_failed'};}}
