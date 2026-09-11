import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from './dev-server.js';
test('quote email uses a stable signing link without an unsigned attachment; edits replace it',async()=>{
 const app=await startServer();try{
  const call=async body=>{const r=await fetch(app.origin+'/api/send-document',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  const body={kind:'estimate',id:app.estimate};const first=await call({...body,action:'link'});
  await call(body);const mail=app.mails.at(-1);assert.equal(mail.attachments,undefined);assert.ok(mail.html.includes(first.signing_url));assert.match(mail.html,/secure link/);
  const again=await call({...body,action:'link'});assert.equal(again.signing_url,first.signing_url);
  const session=await fetch(app.origin+'/api/signing-session?token='+new URL(first.signing_url).searchParams.get('token'));assert.equal(session.status,200);
  // Customer token cannot authorize editing the underlying estimate.
  const denied=await fetch(app.origin+'/api/update-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'estimate',id:app.estimate,token:new URL(first.signing_url).searchParams.get('token'),items:[{description:'Tampered price',quantity:1,unit_price:1}]})});assert.equal(denied.status,401);
  await app.q('update estimates set description=$1 where id=$2',['Revised scope',app.estimate]);
  const replaced=await call({...body,action:'link'});assert.notEqual(replaced.signing_url,first.signing_url);
  const old=await fetch(app.origin+'/api/signing-session?token='+new URL(first.signing_url).searchParams.get('token'));assert.equal(old.status,409);
 }finally{await app.close();}
});
test('invoice delivery: PDF, recipient, failures, and accepted email with failed status update',async()=>{
 const app=await startServer();const original=global.fetch;
 try{
 const call=async(body)=>{const r=await fetch(app.origin+'/api/send-document',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 const inv=(await app.q("insert into invoices(customer_id,title,total,subtotal) values($1,'Send test',125,125) returning id",[app.customer]))[0].id;
 const body={kind:'invoice',id:inv};
 delete process.env.RESEND_API_KEY;
 assert.match((await call(body)).error,/not configured/);assert.equal(app.mails.length,0);
 assert.equal((await app.q('select * from fieldops_documents where source_id=$1',[inv])).length,0);
 process.env.RESEND_API_KEY='test-only-mail';
 await app.q("update customers set email='bad-address' where id=$1",[app.customer]);
 assert.match((await call(body)).error,/valid customer email/);assert.equal(app.mails.length,0);
 await app.q("update customers set email='invoice@example.test' where id=$1",[app.customer]);
 global.fetch=async(url,opts)=>String(url)==='https://api.resend.com/emails'?Response.json({message:'rejected'},{status:403}):original(url,opts);
 assert.match((await call(body)).error,/verified sender/);assert.equal((await app.q('select status from invoices where id=$1',[inv]))[0].status,'draft');
 global.fetch=async(url,opts)=>String(url).includes('/rest/v1/invoices?')&&opts?.method==='PATCH'?Response.json({message:'offline'},{status:500}):original(url,opts);
 const result=await call(body);assert.equal(result.status,200);assert.equal(result.sent,true);assert.match(result.warning,/status could not update/);
 assert.equal(app.mails.length,1);const mail=app.mails[0];assert.deepEqual(mail.to,['invoice@example.test']);assert.match(mail.subject,/INVOICE/);assert.match(mail.html,/Review & Sign/);assert.ok(Buffer.from(mail.attachments[0].content,'base64').toString().startsWith('%PDF'));assert.match(mail.attachments[0].filename,/A1-invoice/);
 global.fetch=original;await app.q("update invoices set status='paid',amount_paid=125 where id=$1",[inv]);
 assert.equal((await call(body)).sent,true);assert.equal((await app.q('select status from invoices where id=$1',[inv]))[0].status,'paid');
 }finally{global.fetch=original;await app.close();}
});

test('send button blocks repeated clicks and reports refresh failures separately',async()=>{
 const fs=await import('node:fs');const vm=await import('node:vm');const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('const sendingDocuments='),source.indexOf('window.contactDoc='));
 let resolve,calls=0;const banners=[];const button={disabled:false,getAttribute:()=>"sendCustomerDocument('invoice','test-id')",setAttribute(){},removeAttribute(){}};
 const context=vm.createContext({window:{},$:()=>null,invoiceCache:[],estimateCache:[],document:{querySelectorAll:()=>[button]},getAccessKey:()=> 'test',showBanner:(m,t)=>banners.push({m,t}),fetch:()=>{calls++;return new Promise(r=>resolve=r);},loadInvoices:async()=>{throw new Error('offline');},loadEstimates:async()=>{},loadInvoiceSignatureStatus:async()=>{}});
 vm.runInContext(code,context);
 const pending=context.window.sendCustomerDocument('invoice','test-id');await context.window.sendCustomerDocument('invoice','test-id');assert.equal(calls,1);assert.equal(button.disabled,true);
 resolve({ok:true,json:async()=>({sent:true,to:'client@example.test'})});await pending;assert.equal(button.disabled,false);assert.equal(banners.at(-1).t,'success');assert.match(banners.at(-1).m,/accepted for delivery/);
});
