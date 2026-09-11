import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {startServer} from './dev-server.js';
test('Twilio webhook verifies signatures and destination, persists once and fails closed',async()=>{
 const app=await startServer();
 const keys=['TWILIO_AUTH_TOKEN','TWILIO_SMS_WEBHOOK_URL','TWILIO_ACCOUNT_SID','TWILIO_PHONE_NUMBER'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
 const url=app.origin+'/api/documents?webhook=twilio-sms';
 Object.assign(process.env,{TWILIO_AUTH_TOKEN:'test-token',TWILIO_SMS_WEBHOOK_URL:url,TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_PHONE_NUMBER:'+13392244517'});
 const b={AccountSid:process.env.TWILIO_ACCOUNT_SID,MessageSid:'SM'+'b'.repeat(32),From:'+16175550123',To:'+13392244517',Body:'Kitchen sink leak & photo',NumMedia:'1',MediaUrl0:'https://api.twilio.com/test-media',MediaContentType0:'image/jpeg'};
 const signature=data=>createHmac('sha1','test-token').update(url+Object.keys(data).sort().map(k=>k+data[k]).join('')).digest('base64');
 const post=(data,sig=signature(data))=>fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':sig},body:new URLSearchParams(data).toString()});
 assert.equal((await post(b,'bad')).status,403);
 assert.equal((await post({...b,Body:'tampered'},signature(b))).status,403);
 assert.equal((await post({...b,To:'+16175550999'})).status,403);
 assert.equal((await post({...b,AccountSid:'AC'+'c'.repeat(32)})).status,403);
 const good=await post(b);assert.equal(good.status,200);assert.match(await good.text(),/<Response><\/Response>/);
 assert.equal((await post(b)).status,200);const rows=await app.q('select * from fieldops_text_messages');assert.equal(rows.length,1);assert.equal(rows[0].body,b.Body);assert.equal(rows[0].media.length,1);
 const extra={...b,MessageSid:'SM'+'d'.repeat(32),NewTwilioParameter:'future compatible'};assert.equal((await post(extra)).status,200);
 delete process.env.TWILIO_AUTH_TOKEN;assert.equal((await post(b)).status,503);process.env.TWILIO_AUTH_TOKEN='test-token';
 await app.q('drop table fieldops_text_messages');assert.equal((await post(b)).status,503);
 }finally{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await app.close();}
});
