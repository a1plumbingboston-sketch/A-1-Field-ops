import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {startServer} from './dev-server.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const disposition=html.slice(html.indexOf('window.setAiDisposition='),html.indexOf('\n};',html.indexOf('window.setAiDisposition='))+3);
test('AI draft generation, edited approval and hold persist using the live lead columns',async()=>{
 const app=await startServer();try{
  const id=(await app.q('select id from leads limit 1'))[0].id;
  const result=await fetch(app.origin+'/api/ai-lead-reply',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify({id,message:'Please help with my faucet.'})});
  assert.equal(result.status,200);
  let lead=(await app.q('select * from leads where id=$1',[id]))[0];
  assert.equal(lead.ai_reply_draft,'Synthetic reply for local workflow testing.');
  assert.equal(lead.ai_reply_status,'draft_ready');
  const input={value:'My reviewed and edited reply.',disabled:false},banners=[];
  const context=vm.createContext({window:{},URL:app.origin,KEY:'test',sessionStorage:{getItem:()=> 'test-key'},fetch,$:()=>input,showBanner:(text,type)=>banners.push({text,type}),load:async()=>{lead=(await app.q('select * from leads where id=$1',[id]))[0];}});
  vm.runInContext(disposition,context);
  await context.window.setAiDisposition(id,'approved');
  assert.equal(banners.at(-1).type,'success');assert.equal(lead.ai_reply_status,'approved');assert.equal(lead.ai_reply_draft,input.value);
  input.value='Revised reply held for review.';
  await context.window.setAiDisposition(id,'held');
  assert.equal(lead.ai_reply_status,'held');assert.equal(lead.ai_reply_draft,input.value);
  input.disabled=true;await context.window.setAiDisposition(id,'approved');assert.equal(banners.at(-1).type,'error');
  input.disabled=false;await context.window.setAiDisposition(crypto.randomUUID(),'approved');assert.equal(banners.at(-1).type,'error');
  await app.q('alter table leads drop column ai_reply_reason');
  const failed=await fetch(app.origin+'/api/ai-lead-reply',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify({id,message:'Faucet repair'})});
  assert.equal(failed.status,500);assert.match((await failed.json()).error,/could not be saved/);
 }finally{await app.close();}
});

test('AI quote allowance uses Misc fittings without altering quantity or price',async()=>{
 const {default:handler}=await import('../api/estimate-assist.js');
 const original=global.fetch;const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only';
 try{
  let prompt='';global.fetch=async (url,options)=>{if(String(url).includes('fieldops_key_status'))return Response.json(true);prompt=JSON.parse(options.body).input;return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({recommended_line_items:[{description:'Contingency (10%)',quantity:1,unit_price:150,price:150}]})}]}]});};
  let status,body;await handler({method:'POST',headers:{'x-fieldops-key':'test-key'},body:{}},{status(n){status=n;return this;},json(value){body=value;return this;}});
  assert.match(prompt,/Per-task fixed pricing/);assert.match(prompt,/only to material cost, never to labor/);assert.match(prompt,/fixed \$75 Truck fee/);
  assert.equal(status,200);assert.deepEqual(body.analysis.recommended_line_items,[{description:'Misc fittings (10%)',quantity:1,unit_price:150,price:150}]);
  await handler({method:'POST',headers:{'x-fieldops-key':'test-key'},body:{pricing_mode:'hourly'}},{status(){return this;},json(){return this;}});assert.match(prompt,/Hourly pricing: show labor hours/);
 }finally{global.fetch=original;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
