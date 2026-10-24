import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestAi} from '../ai-request.js';
import handler from '../api/invoice-assist.js';
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
function setup(t){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const old=global.fetch,env={...process.env};
 process.env.OPENAI_API_KEY='test';delete process.env.AI_HOURLY_LIMIT;
 t.after(()=>{global.fetch=old;for(const key of ['OPENAI_API_KEY','AI_HOURLY_LIMIT','SUPABASE_SERVICE_ROLE_KEY'])if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];});
}
const res=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
const req=()=>({method:'POST',headers:{'x-fieldops-key':'test'},body:{mode:'allocate',document_type:'estimate',description:'Install bathroom toilet and vanity plumbing',total:2500}});
test('stalled browser fetch times out once even if adapter ignores abort',async t=>{
 setup(t);let calls=0,signal;global.fetch=(_,o)=>{calls++;signal=o.signal;return new Promise(()=>{});};
 const p=requestAi('/api/invoice-assist');const rejected=assert.rejects(p,/too long.*draft is unchanged/i);
 t.mock.timers.tick(120000);await rejected;assert.equal(signal.aborted,true);assert.equal(calls,1);
});
test('browser deadline covers stalled JSON body',async t=>{
 setup(t);global.fetch=async()=>({ok:true,json:()=>new Promise(()=>{})});
 const p=requestAi('/api/invoice-assist'),rejected=assert.rejects(p,/too long/i);await flush();t.mock.timers.tick(120000);await rejected;
});
test('successful response preserves payload and clears timer',async t=>{
 setup(t);let signal;global.fetch=async(_,o)=>{signal=o.signal;return {ok:true,status:200,json:async()=>({items:[{quantity:1,unit_price:2500}]})};};
 const r=await requestAi('/api/invoice-assist');assert.deepEqual(await r.json(),{items:[{quantity:1,unit_price:2500}]});t.mock.timers.tick(120000);assert.equal(signal.aborted,false);
});
test('cancel before starting sends no request; cancel during body settles promptly',async t=>{
 setup(t);let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:()=>new Promise(()=>{})};};
 const a=new AbortController();a.abort();await assert.rejects(requestAi('/api/invoice-assist',{signal:a.signal}),{name:'AbortError'});assert.equal(calls,0);
 const b=new AbortController(),p=requestAi('/api/invoice-assist',{signal:b.signal}),rejected=assert.rejects(p,{name:'AbortError'});await flush();b.abort();await rejected;assert.equal(calls,1);
});
test('stalled authentication ends with 503 without contacting AI',async t=>{
 setup(t);let calls=0;global.fetch=()=>{calls++;return new Promise(()=>{});};const r=res(),p=handler(req(),r);await flush();t.mock.timers.tick(15000);await p;assert.equal(r.statusCode,503);assert.match(r.body.error,/draft is unchanged/i);assert.equal(calls,1);
});
test('stalled quota database ends with 503 without contacting AI',async t=>{
 setup(t);process.env.AI_HOURLY_LIMIT='30';process.env.SUPABASE_SERVICE_ROLE_KEY='test';let provider=0;
 global.fetch=async url=>{if(String(url).includes('fieldops_key_status'))return {ok:true,json:async()=>true};if(String(url).includes('api.openai.com'))provider++;return new Promise(()=>{});};
 const r=res(),p=handler(req(),r);await flush();t.mock.timers.tick(10000);await p;assert.equal(r.statusCode,503);assert.equal(provider,0);
});
test('allocation success retains exact owner total',async t=>{
 setup(t);global.fetch=async url=>({ok:true,json:async()=>String(url).includes('fieldops_key_status')?true:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:[{description:'Toilet plumbing',weight:1},{description:'Vanity plumbing',weight:2}],reasoning:'By scope'})}]}]}});
 const r=res();await handler(req(),r);assert.equal(r.statusCode,200);assert.equal(r.body.items.reduce((n,i)=>n+i.unit_price,0),2500);
});

// Exercise the actual saved-quote button handler, without a live database or model.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {withinDeadline} from '../request-deadline.js';
const pageSource=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
function scopeWriter({read,save=async()=>{},refresh=async()=>{}}){
 const button={disabled:false,textContent:''},panel={innerHTML:''};let requests=0;
 const query={select(){return this;},eq(){return this;},order(){return read();}};
 const context={window:{A1WithinDeadline:withinDeadline,A1AiRequest:async()=>{requests++;return {ok:true,json:async()=>({draft:{brief_description:'Reviewed plumbing scope'}})};}},estimateCache:[{id:1,title:'Original quote',description:'Owner scope',total:2500}],sessionStorage:{getItem:()=> 'test'},sb:{from:()=>query},$:(s)=>s==='#estimateAiPanel'?panel:button,saveDocumentEdit:save,loadEstimates:refresh,openEstimate:async()=>{},showBanner(){},esc:String};
 vm.runInNewContext(pageSource.slice(pageSource.indexOf('window.aiEstimateDescription=async id=>{'),pageSource.indexOf('let invoiceCache=[];')),context);
 return {run:()=>context.window.aiEstimateDescription(1),button,panel,requests:()=>requests};
}
test('saved-scope stalled item read releases button without calling AI',async t=>{
 setup(t);const h=scopeWriter({read:()=>new Promise(()=>{})}),p=h.run();t.mock.timers.tick(15000);await p;
 assert.equal(h.button.disabled,false);assert.match(h.panel.innerHTML,/Loading quote items timed out/);assert.equal(h.requests(),0);
});
test('saved-scope stalled save releases button and reports uncertain outcome, not unchanged',async t=>{
 setup(t);const h=scopeWriter({read:async()=>({data:[]}),save:()=>new Promise(()=>{})}),p=h.run();await flush();t.mock.timers.tick(20000);await p;
 assert.equal(h.button.disabled,false);assert.match(h.panel.innerHTML,/save may still finish/);assert.doesNotMatch(h.panel.innerHTML,/unchanged/);assert.equal(h.requests(),1);
});
