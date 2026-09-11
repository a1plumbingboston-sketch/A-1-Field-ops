import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {startServer} from './dev-server.js';
test('Square: secure checkout, retries, signed webhooks, refund accounting, stale balance and pending locks',async()=>{
 const app=await startServer();const original=global.fetch;const old={};for(const k of ['SQUARE_ACCESS_TOKEN','SQUARE_LOCATION_ID','SQUARE_APPLICATION_ID','SQUARE_WEBHOOK_SIGNATURE_KEY','SQUARE_WEBHOOK_URL']){old[k]=process.env[k];process.env[k]=k;}
 process.env.SQUARE_WEBHOOK_URL=app.origin+'/api/documents?webhook=square';
 let payment,refund,requests=0,lose=false;const ids=new Map();
 global.fetch=async(url,opt)=>{if(String(url).startsWith('https://connect.squareup.com')){if(String(url).includes('/locations/'))return Response.json({location:{status:'ACTIVE',currency:'USD',capabilities:['CREDIT_CARD_PROCESSING']}});if(String(url).endsWith('/webhooks/subscriptions'))return Response.json({subscriptions:[{enabled:true,notification_url:process.env.SQUARE_WEBHOOK_URL,signature_key:process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,event_types:['payment.created','payment.updated','refund.created','refund.updated']}]});if(opt.method==='POST'){requests++;const b=JSON.parse(opt.body);payment=ids.get(b.idempotency_key)||{id:'p-'+b.idempotency_key,reference_id:b.reference_id,location_id:b.location_id,amount_money:b.amount_money,status:'COMPLETED'};ids.set(b.idempotency_key,payment);if(lose){lose=false;throw new Error('Connection lost');}return Response.json({payment});}return Response.json(String(url).includes('/refunds/')?{refund}:{payment});}return original(url,opt);};
 const call=async(path,body,key='test-key')=>{const r=await fetch(app.origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-fieldops-key':key},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const hook=async(type,object,bad=false)=>{const raw=JSON.stringify({type,data:{object}}),sig=createHmac('sha256',process.env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(process.env.SQUARE_WEBHOOK_URL+raw).digest('base64');const r=await fetch(process.env.SQUARE_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json','x-square-hmacsha256-signature':bad?'bad':sig},body:raw});return r.status;};
 try{
 const inv=(await call('/api/complete-job',{job_id:app.job})).data.invoice_id;await app.q('update invoices set subtotal=2500,total=2500 where id=$1',[inv]);
 assert.equal((await call('/api/documents',{action:'square-link',id:inv},'')).status,401);
 const link=(await call('/api/documents',{action:'square-link',id:inv,amount:1000})).data;
 assert.ok(link.payment_url,JSON.stringify(link));const token=new URL(link.payment_url).searchParams.get('token');
 const details=(await call('/api/documents?payment=square&token='+token)).data;assert.equal(details.amount,1000);assert.equal(details.source_id,undefined);
 lose=true;assert.equal((await call('/api/documents?payment=square',{token,source_id:'cnon:test'})).status,500);
 assert.equal((await call('/api/documents',{action:'payment',id:inv,amount:10,method:'cash',request_id:crypto.randomUUID()})).status,409);
 await assert.rejects(app.q('update invoices set total=3000 where id=$1',[inv]),/pending/);
 assert.equal((await call('/api/documents?payment=square',{token,source_id:'different'})).data.status,'COMPLETED');assert.equal(ids.size,1);
 assert.equal((await call('/api/documents?payment=square',{token,source_id:'again'})).data.status,'COMPLETED');assert.equal(requests,2);
 assert.equal(await hook('payment.updated',{payment},true),401);
 assert.equal(await hook('payment.updated',{payment}),200);assert.equal(await hook('payment.updated',{payment}),200);
 assert.equal(Number((await app.q('select amount_paid from invoices where id=$1',[inv]))[0].amount_paid),1000);
 refund={id:'r-test',payment_id:payment.id,status:'COMPLETED',amount_money:{amount:25000,currency:'USD'}};
 assert.equal(await hook('refund.updated',{refund}),200);assert.equal(await hook('refund.updated',{refund}),200);
 assert.equal(Number((await app.q('select amount_paid from invoices where id=$1',[inv]))[0].amount_paid),750);
 assert.equal((await app.q('select * from payments where invoice_id=$1',[inv])).length,2);
 const stale=(await call('/api/documents',{action:'square-link',id:inv})).data;await call('/api/documents',{action:'payment',id:inv,amount:1000,method:'cash',request_id:crypto.randomUUID()});
 assert.equal((await call('/api/documents?payment=square',{token:new URL(stale.payment_url).searchParams.get('token'),source_id:'cnon:stale'})).status,409);
 }finally{global.fetch=original;for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await app.close();}
});
