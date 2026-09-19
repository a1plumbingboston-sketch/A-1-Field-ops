import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/documents.js';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});

test('document router keeps customer texts private and routes signed callbacks before owner authentication',async()=>{
 const oldFetch=global.fetch,oldEnv={...process.env};
 Object.assign(process.env,{SUPABASE_SERVICE_ROLE_KEY:'test-only',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'test-only',TWILIO_PHONE_NUMBER:'+13392244517',TWILIO_SMS_WEBHOOK_URL:'https://example.test/api/documents?webhook=twilio-sms',TWILIO_SMS_STATUS_WEBHOOK_URL:'https://example.test/api/documents?webhook=twilio-status',TWILIO_SMS_ENABLED:'false'});
 const paths=[];
 global.fetch=async(url,options={})=>{paths.push(String(url));if(String(url).includes('fieldops_key_status'))return Response.json(options.headers['x-fieldops-key']==='owner');if(String(url).includes('rpc/fieldops_sms_list'))return Response.json([]);if(String(url).includes('fieldops_sms_outbox?request_id=eq.'))return Response.json([]);throw Error('Unexpected request');};
 try{
  let r=response();await handler({method:'POST',headers:{'content-type':'application/json'},body:{action:'customer-messaging',operation:'list'},query:{}},r);assert.equal(r.code,401);assert.equal(paths.length,0);
  r=response();await handler({method:'POST',headers:{'content-type':'application/json','x-fieldops-key':'owner'},body:{action:'customer-messaging',operation:'list'},query:{}},r);assert.deepEqual(r.body.threads,[]);assert.equal(r.body.outbound_ready,false);assert.ok(paths.some(p=>p.includes('fieldops_sms_list')));
  r=response();await handler({method:'POST',headers:{'content-type':'application/json','x-fieldops-key':'owner'},body:{action:'customer-messaging',operation:'send',phone:'+16175550100',body:'We can help with your service inquiry.',request_id:'10000000-0000-4000-8000-000000000001',reply_to_sid:'SM'+'2'.repeat(32),consent_confirmed:true},query:{}},r);assert.equal(r.code,503);assert.equal(r.body.code,'SETUP_PENDING');assert.ok(paths.some(p=>p.includes('fieldops_sms_outbox?request_id=eq.')));assert.equal(paths.some(p=>p.includes('api.twilio.com')),false);
  paths.length=0;r=response();await handler({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':'forged'},body:'MessageStatus=delivered',query:{webhook:'twilio-status',request_id:'10000000-0000-4000-8000-000000000001'}},r);assert.equal(r.code,403);assert.equal(paths.length,0);assert.equal(r.headers['Cache-Control'],'no-store');
 }finally{global.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);}
});

test('existing owner labor-rate settings remain reachable through the document router',async()=>{
 const oldFetch=global.fetch,key=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
 global.fetch=async(url,options={})=>{if(String(url).includes('fieldops_key_status'))return Response.json(options.headers['x-fieldops-key']==='owner');if(String(url).includes('fieldops_labor_rate_settings'))return Response.json([{profile:'service',min_rate:200,max_rate:250},{profile:'construction',min_rate:200,max_rate:250}]);throw Error('Unexpected request');};
 try{let r=response();await handler({method:'GET',headers:{},query:{feature:'labor-rate-settings'}},r);assert.equal(r.code,401);r=response();await handler({method:'GET',headers:{'x-fieldops-key':'owner'},query:{feature:'labor-rate-settings'}},r);assert.equal(r.code,200);assert.deepEqual(r.body.service,{min:200,max:250});}finally{global.fetch=oldFetch;if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;}
});
