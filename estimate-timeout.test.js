import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import handler from '../api/estimate-assist.js';
import {requestEstimate} from '../estimate-request.js';

const advice={summary:'Replace the supplied fixture.',tasks:[{description:'Fixture replacement labor',hours:1,reason:'One hour, moderate difficulty.'}],exclusions:[],questions:[],market_low:null,market_typical:null,market_high:null,sources:[]};
const completed={id:'resp-test',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(advice)}]}]};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,headers:new Headers(),json:async()=>body});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const pendingUntilAbort=signal=>new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
function setup(t,{pricebook=false}={}){
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
 const env={OPENAI_API_KEY:process.env.OPENAI_API_KEY,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,OPENAI_ESTIMATE_MODEL:process.env.OPENAI_ESTIMATE_MODEL};
 const originalFetch=global.fetch;
 process.env.OPENAI_API_KEY='test';delete process.env.OPENAI_ESTIMATE_MODEL;
 if(pricebook)process.env.SUPABASE_SERVICE_ROLE_KEY='test';else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 t.mock.method(console,'info',()=>{});t.mock.method(console,'warn',()=>{});
 t.after(()=>{global.fetch=originalFetch;for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
}
function startHandler(){
 const res=new EventEmitter();Object.assign(res,{statusCode:200,writableEnded:false,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;}});
 const promise=handler({method:'POST',headers:{'x-fieldops-key':'test'},body:{title:'Replace fixture',job_difficulty:'moderate',labor_rate:1}},res);
 return {res,promise};
}

test('researched estimate completes after 70 seconds without reducing quality or retrying',async t=>{
 setup(t);let calls=0,providerSignal,providerInput;
 global.fetch=async(url,opt={})=>{
  if(String(url).includes('fieldops_key_status'))return response(true);
  if(String(url).includes('fieldops_labor_rate_settings'))return response([]);
  if(String(url).includes('fieldops_ai_usage'))return response(opt?.method==='POST'?[{id:'usage-1'}]:[]);
  calls++;providerSignal=opt.signal;providerInput=JSON.parse(opt.body);
  return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(response(completed)),70000);opt.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(opt.signal.reason);},{once:true});});
 };
 const {res,promise}=startHandler();await flush();assert.equal(calls,1);
 t.mock.timers.tick(56000);await flush();assert.equal(res.body,undefined);assert.equal(providerSignal.aborted,false);
 t.mock.timers.tick(14000);await promise;
 assert.equal(res.statusCode,200);assert.equal(res.body.analysis.recommended_total,160);assert.equal(calls,1);
 assert.equal(providerInput.model,'gpt-6-astra');assert.equal(providerInput.store,false);assert.equal(providerInput.reasoning.effort,'high');assert.deepEqual(providerInput.tools,[{type:'web_search'}]);assert.equal(providerInput.text.format.strict,true);assert.equal(JSON.parse(providerInput.input).job.tasks[0].difficulty,'moderate');assert.match(providerInput.instructions,/\$120 standard, \$160 moderate, \$200 difficult/);
 t.mock.timers.tick(300000);assert.equal(providerSignal.aborted,false,'successful request must clear its deadline');assert.equal(res.listenerCount('close'),0);
});

test('four-minute provider deadline also aborts an unfinished response body and does not retry',async t=>{
 setup(t);let calls=0,providerSignal,reading=false;
 global.fetch=async(url,opt={})=>{
  if(String(url).includes('fieldops_key_status'))return response(true);
  if(String(url).includes('fieldops_labor_rate_settings'))return response([]);
  if(String(url).includes('fieldops_ai_usage'))return response(opt?.method==='POST'?[{id:'usage-1'}]:[]);
  calls++;providerSignal=opt.signal;
  return {...response(null),json:()=>{reading=true;return pendingUntilAbort(opt.signal);}};
 };
 const {res,promise}=startHandler();await flush();assert.equal(reading,true);
 t.mock.timers.tick(239999);await flush();assert.equal(res.body,undefined);
 t.mock.timers.tick(1);await promise;
 assert.equal(providerSignal.reason.name,'TimeoutError');assert.equal(res.statusCode,503);assert.match(res.body.error,/four minutes/);assert.match(res.body.error,/draft is unchanged/i);assert.equal(calls,1);assert.equal(res.listenerCount('close'),0);
});

test('client disconnect aborts provider work without writing a result to the closed response',async t=>{
 setup(t);let calls=0,providerSignal;
 global.fetch=async(url,opt={})=>{
  if(String(url).includes('fieldops_key_status'))return response(true);
  if(String(url).includes('fieldops_labor_rate_settings'))return response([]);
  if(String(url).includes('fieldops_ai_usage'))return response(opt?.method==='POST'?[{id:'usage-1'}]:[]);
  calls++;providerSignal=opt.signal;return pendingUntilAbort(opt.signal);
 };
 const {res,promise}=startHandler();await flush();res.emit('close');await promise;
 assert.equal(providerSignal.reason.name,'AbortError');assert.equal(res.body,undefined);assert.equal(calls,1);assert.equal(res.listenerCount('close'),0);
});

test('slow optional price book falls through after five seconds while unauthorized requests never call AI',async t=>{
 setup(t,{pricebook:true});let allowed=false,providerCalls=0,pricebookCalls=0,providerInput;
 global.fetch=async(url,opt={})=>{
  if(String(url).includes('fieldops_key_status'))return response(allowed);
  if(String(url).includes('fieldops_labor_rate_settings'))return response([]);
  if(String(url).includes('fieldops_ai_usage'))return response(opt?.method==='POST'?[{id:'usage-1'}]:[]);
  if(String(url).includes('fieldops_pricebook')){pricebookCalls++;return new Promise(()=>{});}
  providerCalls++;providerInput=JSON.parse(opt.body);return response(completed);
 };
 const denied=startHandler();await denied.promise;assert.equal(denied.res.statusCode,401);assert.equal(providerCalls,0);assert.equal(pricebookCalls,0);
 allowed=true;const accepted=startHandler();await flush();assert.equal(pricebookCalls,1);
 t.mock.timers.tick(4999);await flush();assert.equal(providerCalls,0);
 t.mock.timers.tick(1);await accepted.promise;
 assert.equal(providerCalls,1);assert.equal(accepted.res.statusCode,200);assert.equal(accepted.res.body.pricebook_available,false);assert.deepEqual(JSON.parse(providerInput.input).matching_pricebook,[]);
});

test('client rejects a truncated result once and clears progress callbacks',async t=>{
 setup(t);let calls=0,progress=0;
 global.fetch=async()=>{calls++;return {...response(null),json:async()=>{throw new SyntaxError('Unexpected end of JSON input');}};};
 await assert.rejects(requestEstimate({title:'Fixture'},{onProgress:()=>progress++}),/connection ended before a complete result/i);
 const after=progress;t.mock.timers.tick(300000);await flush();assert.equal(progress,after);assert.equal(calls,1);
});

test('cancel during client body parsing aborts and removes timers and external signal listener',async t=>{
 setup(t);const userController=new AbortController();let calls=0,progress=0,requestSignal,reading=false,removed=0;
 const remove=userController.signal.removeEventListener.bind(userController.signal);
 t.mock.method(userController.signal,'removeEventListener',(...args)=>{if(args[0]==='abort')removed++;return remove(...args);});
 global.fetch=async(url,opt)=>{calls++;requestSignal=opt.signal;return {...response(null),json:()=>{reading=true;return pendingUntilAbort(opt.signal);}};};
 const promise=requestEstimate({title:'Fixture'},{signal:userController.signal,onProgress:()=>progress++});
 const rejected=assert.rejects(promise,/research canceled.*draft is unchanged/i);await flush();assert.equal(reading,true);
 userController.abort(new DOMException('Canceled by user','AbortError'));await rejected;
 assert.equal(requestSignal.aborted,true);assert.equal(removed,1);const after=progress;
 t.mock.timers.tick(300000);await flush();assert.equal(progress,after);assert.equal(calls,1);
});

test('client connection deadline covers body parsing and never automatically repeats a paid request',async t=>{
 setup(t);let calls=0,progress=0,requestSignal;
 global.fetch=async(url,opt)=>{calls++;requestSignal=opt.signal;return {...response(null),json:()=>pendingUntilAbort(opt.signal)};};
 const promise=requestEstimate({title:'Fixture'},{onProgress:()=>progress++});
 const rejected=assert.rejects(promise,/connection timed out.*draft is unchanged/i);await flush();
 t.mock.timers.tick(279999);await flush();assert.equal(requestSignal.aborted,false);
 t.mock.timers.tick(1);await rejected;assert.equal(requestSignal.reason.name,'TimeoutError');
 const after=progress;t.mock.timers.tick(300000);await flush();assert.equal(progress,after);assert.equal(calls,1);
});

test('cancel at the body-completion boundary cannot return a late result',async t=>{
 setup(t);const userController=new AbortController();let calls=0;
 global.fetch=async()=>{calls++;return {...response(null),json:async()=>{userController.abort();return {analysis:advice};}};};
 await assert.rejects(requestEstimate({title:'Fixture'},{signal:userController.signal}),/research canceled.*draft is unchanged/i);
 assert.equal(calls,1);
});

test('an unrelated provider AbortError gets an error response rather than leaving the client hanging',async t=>{
 setup(t);let calls=0;
 global.fetch=async(url,opt={})=>{if(String(url).includes('fieldops_key_status'))return response(true);
  if(String(url).includes('fieldops_labor_rate_settings'))return response([]);
  if(String(url).includes('fieldops_ai_usage'))return response(opt?.method==='POST'?[{id:'usage-1'}]:[]);calls++;throw new DOMException('Upstream connection ended','AbortError');};
 const {res,promise}=startHandler();await promise;
 assert.equal(res.statusCode,503);assert.match(res.body.error,/temporarily unavailable/i);assert.equal(calls,1);assert.equal(res.listenerCount('close'),0);
});
