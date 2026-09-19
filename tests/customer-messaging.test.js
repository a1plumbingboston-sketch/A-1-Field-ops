import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {customerMessagingHandler,twilioStatusWebhook} from '../lib/customer-messaging.js';
import {twilioWebhook} from '../lib/twilio-webhook.js';

const account='AC'+'a'.repeat(32),business='+13392244517',customer='+16175550123';
const webhook='https://fieldops.example/api/documents?webhook=twilio-sms';
const statusWebhook='https://fieldops.example/api/documents?webhook=twilio-status';
const sid=n=>'SM'+Number(n).toString(16).padStart(32,'0');
const config={SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',TWILIO_SMS_ENABLED:'true',TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:'synthetic-auth-token',TWILIO_PHONE_NUMBER:business,TWILIO_MESSAGING_SERVICE_SID:'MG'+'b'.repeat(32),TWILIO_SMS_WEBHOOK_URL:webhook,TWILIO_SMS_STATUS_WEBHOOK_URL:statusWebhook};
const signature=(url,body)=>createHmac('sha1',config.TWILIO_AUTH_TOKEN).update(url+Object.keys(body).sort().map(k=>k+body[k]).join('')).digest('base64');
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(body){this.body=body;return this;}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

// Actual SQL functions and API handlers, with only the external HTTP transports replaced.
// There are no open sockets and no real customer/provider calls in this suite.
async function fixture(t,{legacy=[]}={}){
 const pg=new PGlite(),read=p=>readFile(new URL(p,import.meta.url),'utf8');
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create table customers(id uuid primary key default gen_random_uuid(),owner_id uuid,name text,phone text,email text,archived_at timestamptz);
  grant select on customers to service_role;`);
 await pg.exec(await read('../supabase/migrations/20260911052145_twilio_inbound.sql'));
 for(const message of legacy)await pg.query('insert into fieldops_text_messages(message_sid,from_number,to_number,body) values($1,$2,$3,$4)',[message.sid,message.phone||customer,business,message.body]);
 await pg.exec(await read('../supabase/migrations/20260919191145_customer_sms_inbox.sql'));
 const q=async(sql,args=[]) => (await pg.query(sql,args)).rows;
 const previousFetch=global.fetch,previousEnv=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));
 Object.assign(process.env,config);
 const sends=[],rpcCalls=[],mediaRequests=[];
 let provider=async()=>Response.json({sid:sid(999),status:'queued',account_sid:account,from:business,to:customer},{status:201});
 let mediaProvider=async()=>{throw new Error('No media response configured for isolated test');};
 global.fetch=async(input,options={})=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/rpc/fieldops_key_status'))return Response.json(options.headers['x-fieldops-key']==='owner-test-key');
  if(url.pathname.includes('/rest/v1/rpc/')){
   const fn=url.pathname.split('/rpc/')[1],entries=Object.entries(JSON.parse(options.body||'{}'));
   assert.match(fn,/^fieldops_[a-z_]+$/);for(const [key] of entries)assert.match(key,/^[a-z_]+$/);
   rpcCalls.push({fn,args:Object.fromEntries(entries)});
   try{
    const result=await pg.transaction(async tx=>{
     await tx.exec('set local role service_role');
     return (await tx.query(`select ${fn}(${entries.map(([key],i)=>key+' => $'+(i+1)).join(',')}) as result`,entries.map(([,v])=>v))).rows[0].result;
    });
    return Response.json(result);
   }catch(e){return Response.json({message:e.message},{status:400});}
  }
  if(/^\/rest\/v1\/(fieldops_text_messages|fieldops_sms_outbox)$/.test(url.pathname)){
   assert.equal(options.method||'GET','GET');
   const table=url.pathname.split('/').at(-1),columns=url.searchParams.get('select')||'*',where=[],args=[];
   assert.match(columns,/^(\*|[a-z_]+(,[a-z_]+)*)$/);
   for(const [key,value] of url.searchParams){
    if(['select','limit'].includes(key))continue;
    assert.ok(['message_sid','to_number','request_id'].includes(key));assert.ok(value.startsWith('eq.'));
    args.push(value.slice(3));where.push(key+'=$'+args.length);
   }
   const limit=Number(url.searchParams.get('limit')||100);assert.ok(Number.isInteger(limit)&&limit>0&&limit<=100);
   try{return Response.json(await pg.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query(`select ${columns} from ${table}${where.length?' where '+where.join(' and '):''} limit ${limit}`,args)).rows;}));}
   catch(e){return Response.json({message:e.message},{status:400});}
  }
  if(url.hostname==='api.twilio.com'&&url.pathname.endsWith('/Messages.json')){
   assert.equal(options.method,'POST');
   const send={url:String(input),options,form:Object.fromEntries(new URLSearchParams(options.body))};
   sends.push(send);return provider(send);
  }
  if(url.hostname==='api.twilio.com'||url.hostname==='mms.twiliocdn.com'){
   const request={url:String(input),options};mediaRequests.push(request);return mediaProvider(request);
  }
  throw new Error('Unexpected external request in isolated messaging test: '+url.pathname);
 };
 const api=async(operation,body={},key='owner-test-key')=>{
  const res=response();await customerMessagingHandler({method:'POST',headers:{'x-fieldops-key':key,'content-type':'application/json'},body:{action:'customer-messaging',operation,...body}},res);return res;
 };
 const inbound=async(body={},options={})=>{
  const data={AccountSid:account,MessageSid:sid(1),From:customer,To:business,Body:'Can you repair my leaking kitchen sink?',NumMedia:'0',...body};
  const res=response();await twilioWebhook({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':options.signature??signature(webhook,data)},body:options.rawBody??new URLSearchParams(data).toString()},res);return res;
 };
 const callback=async(requestId,body={},options={})=>{
  const url=statusWebhook+'&request_id='+requestId;
  const data={AccountSid:account,MessageSid:sid(999),MessageStatus:'delivered',From:business,To:customer,...body};
  const res=response();await twilioStatusWebhook({method:'POST',query:{webhook:'twilio-status',request_id:requestId},url,headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':options.signature??signature(url,data)},body:options.rawBody??new URLSearchParams(data).toString()},res);return res;
 };
 const reply=(patch={})=>({request_id:randomUUID(),phone:customer,body:'Yes. Please send a photo of the leak so we can discuss the repair.',reply_to_sid:sid(1),consent_confirmed:true,...patch});
 t.after(async()=>{global.fetch=previousFetch;for(const [key,value] of Object.entries(previousEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await pg.close();});
 return {pg,q,api,inbound,callback,reply,sends,rpcCalls,mediaRequests,setProvider(fn){provider=fn;},setMediaProvider(fn){mediaProvider=fn;}};
}

test('owner authentication and complete outbound configuration are required before any provider send',async t=>{
 const f=await fixture(t);
 for(const operation of ['status','list','thread','send','mark-read']){
  const data=operation==='send'?f.reply():{phone:customer,through_sid:sid(1)};
  assert.equal((await f.api(operation,data,'')).statusCode,401);
  assert.equal((await f.api(operation,data,'not-the-owner')).statusCode,401);
 }
 assert.equal(f.rpcCalls.length,0);assert.equal(f.sends.length,0);
 assert.equal((await f.inbound()).statusCode,200);
 for(const key of ['TWILIO_SMS_ENABLED','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER','TWILIO_MESSAGING_SERVICE_SID','TWILIO_SMS_WEBHOOK_URL','TWILIO_SMS_STATUS_WEBHOOK_URL']){
  delete process.env[key];
  const blocked=await f.api('send',f.reply());
  assert.equal(blocked.statusCode,503,key+': '+JSON.stringify(blocked.body));
  process.env[key]=config[key];
 }
 assert.equal(f.sends.length,0,'configuration failure must never contact Twilio');
 const allowed=await f.api('send',f.reply());assert.equal(allowed.statusCode,200,JSON.stringify(allowed.body));assert.equal(f.sends.length,1);
 assert.equal(f.sends[0].form.MessagingServiceSid,config.TWILIO_MESSAGING_SERVICE_SID);
 assert.equal(f.sends[0].form.To,customer);
 assert.match(f.sends[0].form.StatusCallback,/\?webhook=twilio-status&request_id=[\da-f-]+$/);
});

test('inbound webhook validates provider identity and stores duplicate MMS delivery only once',async t=>{
 const f=await fixture(t),message={MessageSid:sid(10),Body:'Leaking valve: see attached photo',NumMedia:'1',MediaUrl0:'https://api.twilio.com/synthetic-media',MediaContentType0:'image/jpeg'};
 assert.equal((await f.inbound(message,{signature:'bad'})).statusCode,403);
 assert.equal((await f.inbound({...message,To:'+16175550999'})).statusCode,403);
 assert.equal((await f.inbound({...message,AccountSid:'AC'+'c'.repeat(32)})).statusCode,403);
 assert.equal((await f.inbound({...message,MessageSid:'invalid'})).statusCode,400);
 assert.equal((await f.inbound(message,{rawBody:'Body=first&Body=second'})).statusCode,400);
 const first=await f.inbound(message),again=await f.inbound(message);
 assert.equal(first.statusCode,200,JSON.stringify(first.body));assert.match(first.body,/<Response><\/Response>/);assert.equal(again.statusCode,200);
 const rows=await f.q('select * from fieldops_text_messages');assert.equal(rows.length,1);assert.equal(rows[0].message_sid,sid(10));assert.equal(rows[0].body,message.Body);assert.ok(rows[0].received_at);
 assert.deepEqual(rows[0].media,[{url:message.MediaUrl0,content_type:'image/jpeg'}]);
 const mmsSid='MM'+'a'.repeat(32),mms=await f.inbound({...message,MessageSid:mmsSid});
 assert.equal(mms.statusCode,200,JSON.stringify(mms.body));assert.equal((await f.q('select count(*)::int n from fieldops_text_messages where message_sid=$1',[mmsSid]))[0].n,1);
 assert.equal(f.sends.length,0,'receipt of SMS must never generate an automatic customer reply');
});

test('replies require a matching substantive inquiry and permission; START restores replies, not control-message replies',async t=>{
 const f=await fixture(t),blocked=async(patch)=>{
  const result=await f.api('send',f.reply(patch));
  assert.ok(result.statusCode>=400,JSON.stringify(result.body));assert.equal(f.sends.length,0);
  return result;
 };
 await blocked({});
 await f.inbound();
 await blocked({consent_confirmed:false});
 await blocked({phone:'+16175550999'});
 await blocked({reply_to_sid:sid(789)});
 await blocked({body:'x'.repeat(1601)});
 await blocked({body:'  '});
 await blocked({request_id:'not-a-uuid'});
 await f.inbound({MessageSid:sid(2),Body:'Please stop contacting me',OptOutType:'STOP'});
 const stopped=await blocked({});assert.equal(stopped.body.code,'OPTED_OUT');assert.equal(stopped.statusCode,409);
 // A new ordinary message does not silently cancel an explicit opt-out.
 await f.inbound({MessageSid:sid(3),Body:'When will the technician arrive?'});
 await blocked({reply_to_sid:sid(3)});
 await f.inbound({MessageSid:sid(4),Body:'START',OptOutType:'START'});
 await blocked({reply_to_sid:sid(4)});
 await f.inbound({MessageSid:sid(5),Body:'Can you come tomorrow to fix the leak?'});
 const resumed=await f.api('send',f.reply({reply_to_sid:sid(5)}));
 assert.equal(resumed.statusCode,200,JSON.stringify(resumed.body));assert.equal(f.sends.length,1);
 const controls=await f.q('select message_sid,opt_out_type from fieldops_text_messages where message_sid in ($1,$2) order by message_sid',[sid(2),sid(4)]);
 assert.deepEqual(controls.map(r=>r.opt_out_type),['STOP','START']);
});

test('only exact fallback keywords alter permission; natural service requests remain replyable',async t=>{
 const f=await fixture(t,{legacy:[{sid:sid(90),body:'Stop by tomorrow'},{sid:sid(91),body:'stop leaking'},{sid:sid(92),phone:'+16175550999',body:' STOP '}]});
 assert.deepEqual((await f.q('select opt_out_type from fieldops_text_messages order by message_sid')).map(row=>row.opt_out_type),[null,null,'STOP'],'migration must preserve old inquiries and exact opt-outs');
 assert.equal((await f.api('thread',{phone:customer})).body.can_reply,true);
 assert.equal((await f.api('thread',{phone:'+16175550999'})).body.blocked,true);
 const texts=['Stop by tomorrow','stop leaking','Cancel the upstairs job but keep the kitchen repair'];
 for(let i=0;i<texts.length;i++){
  assert.equal((await f.inbound({MessageSid:sid(i+1),Body:texts[i]})).statusCode,200);
  const stored=(await f.q('select opt_out_type from fieldops_text_messages where message_sid=$1',[sid(i+1)]))[0];assert.equal(stored.opt_out_type,null,texts[i]);
  const thread=await f.api('thread',{phone:customer});assert.equal(thread.body.can_reply,true,texts[i]);assert.equal(thread.body.reply_to_sid,sid(i+1));
 }
 await f.inbound({MessageSid:sid(4),Body:' sToP '});
 assert.equal((await f.api('thread',{phone:customer})).body.blocked,true);
 await f.inbound({MessageSid:sid(5),Body:'START'});
 assert.equal((await f.api('thread',{phone:customer})).body.blocked,false);
 await f.inbound({MessageSid:sid(6),Body:'Localized opt-out handled by provider',OptOutType:'STOP'});
 assert.equal((await f.api('thread',{phone:customer})).body.blocked,true);
 assert.equal(f.sends.length,0);
});

test('concurrent send and replay claim one provider attempt; changed request payload conflicts',async t=>{
 const f=await fixture(t);await f.inbound();
 const entered=deferred(),release=deferred();
 f.setProvider(async()=>{entered.resolve();await release.promise;return Response.json({sid:sid(999),status:'queued',account_sid:account,from:business,to:customer},{status:201});});
 const request=f.reply(),first=f.api('send',request);
 t.after(()=>release.resolve());
 await Promise.race([entered.promise,first.then(r=>{throw new Error('Send returned before reaching provider: '+JSON.stringify(r.body));})]);
 const simultaneous=await f.api('send',request);
 assert.equal(f.sends.length,1,'a second request during the provider call must not send again');
 assert.ok(simultaneous.statusCode<300,JSON.stringify(simultaneous.body));
 release.resolve();const sent=await first;assert.equal(sent.statusCode,200,JSON.stringify(sent.body));
 assert.equal((await f.api('send',request)).statusCode,200);
 const conflict=await f.api('send',{...request,body:'Changed reply with the same ID'});
 assert.equal(conflict.statusCode,409,JSON.stringify(conflict.body));assert.equal(f.sends.length,1);
});

test('ambiguous provider timeout is never resent and a signed delivery callback recovers without status regression',async t=>{
 const f=await fixture(t);await f.inbound();
 f.setProvider(async()=>{throw new TypeError('Synthetic connection lost after provider accepted the message');});
 const request=f.reply(),attempt=await f.api('send',request);
 assert.equal(f.sends.length,1);assert.equal(attempt.statusCode,200,JSON.stringify(attempt.body));
 assert.equal((await f.q('select status from fieldops_sms_outbox where request_id=$1',[request.request_id]))[0].status,'unconfirmed');
 await f.api('send',request);assert.equal(f.sends.length,1,'ambiguous outcomes cannot be automatically retried');
 assert.equal((await f.callback(request.request_id,{}, {signature:'bad'})).statusCode,403);
 assert.equal((await f.callback(request.request_id,{AccountSid:'AC'+'c'.repeat(32)})).statusCode,400);
 const delivered=await f.callback(request.request_id);assert.equal(delivered.statusCode,204,JSON.stringify(delivered.body));
 assert.equal((await f.callback(request.request_id,{MessageSid:sid(998)})).statusCode,403,'a different provider message cannot take over this request');
 assert.equal((await f.callback(request.request_id,{MessageStatus:'sent'})).statusCode,204);
 assert.equal((await f.callback(request.request_id,{MessageStatus:'queued'})).statusCode,204);
 assert.equal((await f.callback(request.request_id)).statusCode,204,'callback retries must be harmless');
 await f.api('send',request);assert.equal(f.sends.length,1);
 const saved=(await f.q('select status,message_sid from fieldops_sms_outbox where request_id=$1',[request.request_id]))[0];
 assert.deepEqual(saved,{status:'delivered',message_sid:sid(999)});
});

test('pausing outbound still replays an existing uncertain send without attempting a new provider request',async t=>{
 const f=await fixture(t);await f.inbound();
 f.setProvider(async()=>{throw new TypeError('Synthetic provider connection loss');});
 const request=f.reply(),first=await f.api('send',request);
 assert.equal(first.statusCode,200);assert.equal(first.body.message.status,'unconfirmed');assert.equal(f.sends.length,1);
 process.env.TWILIO_SMS_ENABLED='false';
 const replay=await f.api('send',request);
 assert.equal(replay.statusCode,200,JSON.stringify(replay.body));assert.equal(replay.body.duplicate,true);assert.equal(replay.body.unconfirmed,true);
 assert.equal(replay.body.message.request_id,request.request_id);assert.equal(replay.body.message.status,'unconfirmed');assert.equal(f.sends.length,1);
 const newRequest=await f.api('send',f.reply());assert.equal(newRequest.statusCode,503);assert.equal(newRequest.body.code,'SETUP_PENDING');assert.equal(f.sends.length,1);
 assert.equal((await f.q('select count(*)::int n from fieldops_sms_outbox'))[0].n,1);
});

test('provider HTTP 503 is an uncertain outcome and a same-request replay never sends twice',async t=>{
 const f=await fixture(t);await f.inbound();
 f.setProvider(async()=>Response.json({code:20500,message:'Synthetic provider outage'},{status:503}));
 const request=f.reply(),first=await f.api('send',request);
 assert.equal(first.statusCode,200,JSON.stringify(first.body));assert.equal(first.body.unconfirmed,true);assert.equal(first.body.message.status,'unconfirmed');assert.equal(f.sends.length,1);
 const replay=await f.api('send',request);assert.equal(replay.statusCode,200);assert.equal(replay.body.duplicate,true);assert.equal(replay.body.message.status,'unconfirmed');assert.equal(f.sends.length,1);
 assert.equal((await f.q('select status from fieldops_sms_outbox where request_id=$1',[request.request_id]))[0].status,'unconfirmed');
});

test('thread pagination has no gaps at equal timestamps and an older read cutoff leaves a newer arrival unread',async t=>{
 const f=await fixture(t);
 for(let i=1;i<=55;i++)assert.equal((await f.inbound({MessageSid:sid(i),Body:'Synthetic job update '+i})).statusCode,200);
 await f.q("update fieldops_text_messages set received_at='2026-09-19T12:00:00.123456Z'");
 const first=await f.api('thread',{phone:customer});assert.equal(first.statusCode,200,JSON.stringify(first.body));
 assert.equal(first.body.messages.length,50);assert.ok(first.body.next_cursor);
 assert.equal(first.body.messages[0].id,sid(6));assert.equal(first.body.messages.at(-1).id,sid(55));
 const earlier=await f.api('thread',{phone:customer,before:first.body.next_cursor});assert.equal(earlier.statusCode,200,JSON.stringify(earlier.body));
 assert.equal(earlier.body.messages.length,5);assert.equal(earlier.body.next_cursor,null);
 const all=[...earlier.body.messages,...first.body.messages];assert.equal(new Set(all.map(m=>m.id)).size,55);assert.deepEqual(all.map(m=>m.id),Array.from({length:55},(_,i)=>sid(i+1)));
 assert.equal((await f.api('mark-read',{phone:customer,through_sid:sid(55)})).statusCode,200);
 assert.equal((await f.inbound({MessageSid:sid(56),Body:'New arrival while the earlier conversation is open'})).statusCode,200);
 // Same timestamp exercises the SID tie-break; truncating microseconds loses this ordering.
 await f.q("update fieldops_text_messages set received_at='2026-09-19T12:00:00.123456Z' where message_sid=$1",[sid(56)]);
 assert.equal((await f.api('mark-read',{phone:customer,through_sid:sid(55)})).statusCode,200);
 assert.equal((await f.api('mark-read',{phone:customer,through_sid:sid(1)})).statusCode,200,'late stale tabs cannot move the read marker backward');
 const list=await f.api('list');assert.equal(list.statusCode,200,JSON.stringify(list.body));assert.equal(list.body.threads[0].unread_count,1);
 assert.equal((await f.api('mark-read',{phone:'+16175550999',through_sid:sid(56)})).statusCode,400);
 assert.equal((await f.api('mark-read',{phone:customer,through_sid:sid(56)})).statusCode,200);
 assert.equal((await f.api('list')).body.threads[0].unread_count,0);
});

test('inbox list pagination preserves equal-time boundaries and does not guess between duplicate customer matches',async t=>{
 const f=await fixture(t),phones=Array.from({length:55},(_,i)=>'+1617555'+String(i).padStart(4,'0'));
 for(let i=0;i<phones.length;i++)assert.equal((await f.inbound({MessageSid:sid(i+1000),From:phones[i],Body:'Synthetic service inquiry '+i})).statusCode,200);
 await f.q("update fieldops_text_messages set received_at='2026-09-19T12:00:00.123456Z'");
 await f.q("insert into customers(name,phone) values ('Single match',$1),('Shared phone one',$2),('Shared phone two',$2)",[phones[0],phones[1]]);
 const first=await f.api('list');assert.equal(first.statusCode,200,JSON.stringify(first.body));assert.equal(first.body.threads.length,50);assert.ok(first.body.next_cursor);
 assert.equal(first.body.threads[0].customer.name,'Single match');assert.equal(first.body.threads[1].customer,null);
 const next=await f.api('list',{cursor:first.body.next_cursor});assert.equal(next.statusCode,200,JSON.stringify(next.body));assert.equal(next.body.threads.length,5);assert.equal(next.body.next_cursor,null);
 assert.deepEqual([...first.body.threads,...next.body.threads].map(thread=>thread.phone),phones);
 const malformed=await f.api('list',{cursor:'not a cursor'});assert.equal(malformed.statusCode,400);
});

test('customer photos require owner access and exact Twilio media paths; CDN redirects never receive Twilio credentials',async t=>{
 const f=await fixture(t),messageSid='MM'+'a'.repeat(32),mediaSid='ME'+'b'.repeat(32);
 const mediaUrl=`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${messageSid}/Media/${mediaSid}`;
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 assert.equal((await f.inbound({MessageSid:messageSid,Body:'Photo of the leaking valve',NumMedia:'1',MediaUrl0:mediaUrl,MediaContentType0:'image/png'})).statusCode,200);
 assert.equal((await f.api('media',{sid:messageSid,index:0},'')).statusCode,401);assert.equal(f.mediaRequests.length,0);
 f.setMediaProvider(async request=>{
  if(new URL(request.url).hostname==='api.twilio.com')return new Response(null,{status:302,headers:{location:'https://mms.twiliocdn.com/synthetic/photo.png'}});
  return new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}});
 });
 const photo=await f.api('media',{sid:messageSid,index:0});assert.equal(photo.statusCode,200,JSON.stringify(photo.body));assert.deepEqual(Buffer.from(photo.body),png);
 assert.equal(f.mediaRequests.length,2);
 assert.ok(new Headers(f.mediaRequests[0].options.headers).get('authorization'),'Twilio API media request needs server credentials');
 assert.equal(new Headers(f.mediaRequests[1].options.headers).has('authorization'),false,'credentials must never be forwarded to the CDN');
 assert.match(photo.headers['content-type'],/^image\/png/);
 const requestsBefore=f.mediaRequests.length;
 assert.equal((await f.api('media',{sid:messageSid,index:1})).statusCode,404);assert.equal(f.mediaRequests.length,requestsBefore);
 const badSid=sid(456),badMedia={MessageSid:badSid,Body:'Another photo',NumMedia:'1',MediaUrl0:'https://private.example/not-twilio',MediaContentType0:'image/png'};
 assert.equal((await f.inbound(badMedia)).statusCode,200);
 const rejected=await f.api('media',{sid:badSid,index:0});assert.ok(rejected.statusCode>=400);assert.equal(f.mediaRequests.length,requestsBefore,'untrusted media URLs cannot be fetched');
 f.setMediaProvider(async()=>new Response(null,{status:302,headers:{location:'https://mms.twiliocdn.com.attacker.example/photo.png'}}));
 const badRedirect=await f.api('media',{sid:messageSid,index:0});assert.ok(badRedirect.statusCode>=400);assert.equal(f.mediaRequests.length,requestsBefore+1,'only the original trusted Twilio endpoint is contacted');
});

test('messaging SQL and stored customer conversations are inaccessible to public roles',async t=>{
 const f=await fixture(t);
 const functions=await f.q(`select proname,prosecdef,
  has_function_privilege('anon',oid,'execute') anon,
  has_function_privilege('authenticated',oid,'execute') authenticated,
  has_function_privilege('service_role',oid,'execute') service
  from pg_proc where pronamespace='public'::regnamespace and proname in
  ('fieldops_receive_text','fieldops_sms_list','fieldops_sms_thread','fieldops_sms_mark_read','fieldops_sms_claim','fieldops_sms_result')`);
 assert.equal(functions.length,6);
 for(const fn of functions){assert.equal(fn.prosecdef,false,fn.proname);assert.equal(fn.anon,false,fn.proname);assert.equal(fn.authenticated,false,fn.proname);assert.equal(fn.service,true,fn.proname);}
 const tables=await f.q(`select relname,relrowsecurity,
  has_table_privilege('anon',oid,'select') anon,
  has_table_privilege('authenticated',oid,'select') authenticated
  from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname<>'customers'`);
 assert.ok(tables.length>=3);
 for(const table of tables){assert.equal(table.relrowsecurity,true,table.relname);assert.equal(table.anon,false,table.relname);assert.equal(table.authenticated,false,table.relname);}
 await f.pg.exec('set role anon');
 await assert.rejects(f.q('select * from fieldops_text_messages'),/permission denied/i);
 await assert.rejects(f.q('select fieldops_sms_list($1)',[business]),/permission denied/i);
 await f.pg.exec('reset role');
});
