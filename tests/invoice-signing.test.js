import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startServer} from './dev-server.js';
test('invoice link prevents customer price edits and preserves signed PDF and signature',{timeout:30000},async()=>{
 const app=await startServer();try{
 const call=(path,body,auth=false)=>fetch(app.origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{'x-fieldops-key':'test-key'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const id=(await app.q("insert into invoices(customer_id,job_id,title,description,total,subtotal) values($1,$2,'Invoice signing test','Completed plumbing service',750,750) returning id",[app.customer,app.job]))[0].id;
 await app.q("insert into invoice_items(invoice_id,description,quantity,unit_price,line_total,sort_order) values($1,'Plumbing service',1,750,750,0)",[id]);
 const link=await (await call('/api/send-document',{kind:'invoice',id,action:'link'},true)).json();const token=new URL(link.signing_url).searchParams.get('token');
 assert.equal((await call('/api/send-document',{kind:'invoice',id},true)).status,200);assert.ok(app.mails.at(-1).html.includes(link.signing_url));
 await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/invoice-signing-unsigned.pdf',Buffer.from(app.mails.at(-1).attachments[0].content,'base64'));
 assert.equal((await call('/api/update-invoice',{kind:'invoice',id,token,items:[{description:'Tampered',quantity:1,unit_price:1}]})).status,401);
 assert.equal((await call('/api/signing-session?token=invalid')).status,400);
 const signature='data:image/jpeg;base64,'+(await fs.readFile(new URL('./signature-fixture.jpg',import.meta.url))).toString('base64');
 const signed=await call('/api/sign-invoice',{token,customer_name:'Invoice Test Customer',signature_data:signature,total:1,snapshot:{doc:{total:1}},items:[]});assert.equal(signed.status,200);
 const before=(await app.q('select snapshot,signed_pdf,signed_pdf_sha256,customer_name,signature_data from fieldops_documents where token=$1',[token]))[0];assert.equal(Number(before.snapshot.doc.total),750);assert.equal(before.signature_data,signature);assert.equal(Number((await app.q('select total from invoices where id=$1',[id]))[0].total),750);
 await app.q('update invoices set archived_at=now() where id=$1',[id]);
 await assert.rejects(app.q('update invoices set total=1 where id=$1',[id]),/Signed document/);
 await app.q('update invoices set archived_at=null where id=$1',[id]);
 const download=await call('/api/signing-session?token='+token+'&download=pdf');assert.equal(download.status,200);const pdf=Buffer.from(await download.arrayBuffer());assert.deepEqual(pdf,Buffer.from(before.signed_pdf,'base64'));await fs.writeFile('test-results/invoice-signing-signed.pdf',pdf);
 const retry=await call('/api/sign-invoice',{token,customer_name:'Replacement Signer',signature_data:signature});assert.equal((await retry.json()).already_signed,true);assert.deepEqual((await app.q('select snapshot,signed_pdf,signed_pdf_sha256,customer_name,signature_data from fieldops_documents where token=$1',[token]))[0],before);
 }finally{await app.close();}
});
