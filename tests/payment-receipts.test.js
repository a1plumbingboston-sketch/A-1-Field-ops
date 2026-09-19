import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {autoPaymentReceipt,receiptId} from '../lib/payment-receipts.js';
const invoice='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222';
test('confirmed payment receipt sends once, survives replays, and preserves missing-contact/provider failures',async()=>{
 const old=global.fetch,env={...process.env};Object.assign(process.env,{SUPABASE_SERVICE_ROLE_KEY:'fixture',RESEND_API_KEY:'fixture',FIELDOPS_FROM_EMAIL:'test@example.test'});delete process.env.TWILIO_SMS_ENABLED;const rows=new Map();let sends=0,noEmail=false,fail=false;
 global.fetch=async(url,o={})=>{const u=new URL(String(url)),body=o.body?JSON.parse(o.body):null;
 if(u.hostname==='api.resend.com'){sends++;assert.equal(o.headers['Idempotency-Key'],'receipt-'+receiptId(fail?'failure':'one'));assert.match(body.subject,/Sample Homeowner/);assert.ok(body.attachments[0].content.length>100);if(fail)throw Error('Connection lost');return Response.json({id:'email-1'});}
 if(u.pathname.endsWith('/rpc/fieldops_document_data'))return Response.json({kind:'receipt',doc:{id:invoice,invoice_number:42,total:100,created_at:'2026-09-13T12:00:00Z'},customer:{id:customer,name:'Sample Homeowner',email:noEmail?'':'sample@example.test',phone:'6175550100'},items:[],job:{},payments:[{amount:100,status:'succeeded',method:'cash',created_at:'2026-09-13T12:00:00Z'}]});
 if(u.pathname.endsWith('/fieldops_deliveries')){const id=(u.searchParams.get('id')||'').replace('eq.','');if(o.method==='POST'){if(rows.has(body.id))return Response.json({message:'duplicate'},{status:409});rows.set(body.id,body);return Response.json([body]);}if(o.method==='PATCH'){rows.set(id,{...rows.get(id),...body});return Response.json([rows.get(id)]);}return Response.json(rows.has(id)?[rows.get(id)]:[]);}
 throw Error('Unexpected request '+u.pathname);
 };
 try{const [a,b]=await Promise.all([autoPaymentReceipt({invoiceId:invoice,event:'one',amount:100}),autoPaymentReceipt({invoiceId:invoice,event:'one',amount:100})]);assert.equal(sends,1);assert.ok([a.status,b.status].includes('sent'));await autoPaymentReceipt({invoiceId:invoice,event:'one',amount:100});assert.equal(sends,1);noEmail=true;assert.equal((await autoPaymentReceipt({invoiceId:invoice,event:'no-contact',amount:100})).status,'needs_contact');assert.equal(sends,1);noEmail=false;fail=true;assert.equal((await autoPaymentReceipt({invoiceId:invoice,event:'failure',amount:100})).status,'unconfirmed');await autoPaymentReceipt({invoiceId:invoice,event:'failure',amount:100});assert.equal(sends,2);await assert.rejects(autoPaymentReceipt({invoiceId:invoice,event:'bad',amount:-1}));}
 finally{global.fetch=old;for(const k of ['SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','FIELDOPS_FROM_EMAIL','TWILIO_SMS_ENABLED'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}
});
test('text fallback uses real inbound timestamps, enforces consent and STOP, and fails closed when history is unavailable',async()=>{
 const pg=new PGlite();await pg.exec('create role anon; create role authenticated; create role service_role;');await pg.exec(await readFile(new URL('../supabase/migrations/20260911052145_twilio_inbound.sql',import.meta.url),'utf8'));
 const old=global.fetch,env={...process.env};Object.assign(process.env,{SUPABASE_SERVICE_ROLE_KEY:'test',TWILIO_SMS_ENABLED:'true',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'test',TWILIO_MESSAGING_SERVICE_SID:'MG'+'b'.repeat(32),FIELDOPS_PUBLIC_URL:'https://fieldops.example.test'});const rows=new Map();let allow=false,sends=0,preferenceTime='2026-09-13T12:00:00Z';
 const snapshot={kind:'receipt',doc:{id:invoice,total:100,invoice_number:42},customer:{id:customer,name:'Sample Homeowner',phone:'6175550100'},items:[],payments:[{amount:100,status:'succeeded'}],job:{}};
 global.fetch=async(url,o={})=>{const u=new URL(String(url));if(u.hostname==='api.twilio.com'){sends++;const b=new URLSearchParams(o.body);assert.equal(b.get('To'),'+16175550100');assert.match(b.get('Body'),/https:\/\/fieldops.example.test\/api\/documents\?feature=payment-receipt&token=/);return Response.json({sid:'SM'+'c'.repeat(32)});}const b=o.body?JSON.parse(o.body):null;
 if(u.pathname.endsWith('/rpc/fieldops_document_data'))return Response.json(snapshot);
 if(u.pathname.endsWith('/rpc/fieldops_start_document'))return Response.json({token:'a'.repeat(43),snapshot:b.p_snapshot});
 if(u.pathname.endsWith('/fieldops_documents'))return Response.json([]);
 if(u.pathname.endsWith('/fieldops_text_messages')){
  const [column,direction]=(u.searchParams.get('order')||'').split('.');assert.match(column,/^[a-z_]+$/);assert.equal(direction,'desc');assert.equal(u.searchParams.get('limit'),'100');
  try{return Response.json((await pg.query(`select * from fieldops_text_messages where from_number=$1 order by "${column}" desc limit 100`,[(u.searchParams.get('from_number')||'').replace(/^eq\./,'')])).rows);}catch(e){return Response.json({message:e.message},{status:400});}
 }
 if(u.pathname.endsWith('/fieldops_deliveries')){if(u.searchParams.get('kind')==='eq.receipt_preference')return Response.json(allow?[{status:'sms_allowed',recipient:'+16175550100',created_at:preferenceTime}]:[]);const id=(u.searchParams.get('id')||'').replace('eq.','');if(o.method==='POST'){rows.set(b.id,b);return Response.json([b]);}if(o.method==='PATCH'){rows.set(id,{...rows.get(id),...b});return Response.json([rows.get(id)]);}return Response.json(rows.has(id)?[rows.get(id)]:[]);}throw Error(u.pathname);};
 const receipt=event=>autoPaymentReceipt({invoiceId:invoice,event,amount:100});
 try{
  assert.equal((await receipt('no-permission')).status,'needs_contact');assert.equal(sends,0);allow=true;
  process.env.TWILIO_SMS_ENABLED='false';assert.equal((await receipt('disabled')).status,'needs_contact');assert.equal(sends,0);process.env.TWILIO_SMS_ENABLED='true';
  await pg.query('insert into fieldops_text_messages(message_sid,from_number,to_number,body,received_at) values($1,$2,$3,$4,$5)',['SM'+'e'.repeat(32),'+16175550100','+13392244517','Stop by tomorrow; the sink will not stop leaking.','2026-09-13T12:30:00Z']);
  assert.equal((await receipt('allowed')).status,'sent');assert.equal(sends,1);
  await pg.query('insert into fieldops_text_messages(message_sid,from_number,to_number,body,received_at) values($1,$2,$3,$4,$5)',['SM'+'d'.repeat(32),'+16175550100','+13392244517','STOP','2026-09-13T13:00:00Z']);
  assert.equal((await receipt('stopped')).status,'needs_contact');assert.equal(sends,1);
  preferenceTime='2026-09-13T13:00:00Z';assert.equal((await receipt('same-time')).status,'needs_contact');assert.equal(sends,1);
  preferenceTime='2026-09-13T14:00:00Z';assert.equal((await receipt('explicit-opt-in-after-stop')).status,'sent');assert.equal(sends,2);
  await pg.exec('alter table fieldops_text_messages add column opt_out_type text');
  await pg.query('insert into fieldops_text_messages(message_sid,from_number,to_number,body,received_at,opt_out_type) values($1,$2,$3,$4,$5,$6)',['SM'+'f'.repeat(32),'+16175550100','+13392244517','A custom opt-out phrase','2026-09-13T15:00:00Z','STOP']);
  assert.equal((await receipt('provider-classified-stop')).status,'needs_contact');assert.equal(sends,2);
  await pg.exec('drop table fieldops_text_messages');assert.equal((await receipt('history-unavailable')).status,'failed');assert.equal(sends,2);
  assert.equal(rows.get(receiptId('history-unavailable')).status,'failed');
 }finally{global.fetch=old;for(const k of ['SUPABASE_SERVICE_ROLE_KEY','TWILIO_SMS_ENABLED','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_MESSAGING_SERVICE_SID','FIELDOPS_PUBLIC_URL'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];await pg.close();}
});
