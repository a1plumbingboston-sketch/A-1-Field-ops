import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateInput,relevantPrices,validateEstimate} from '../lib/estimate-guidance.js';
import handler from '../api/estimate-assist.js';
const advice=()=>({recommended_total:99999,market_low:200,market_typical:300,market_high:400,summary:'Review fittings.',risks:[],sources:[{title:'Reference',url:'https://example.com/prices'},{title:'Unsafe',url:'javascript:alert(1)'}],recommended_line_items:[{description:'Contingency fittings',quantity:2,unit_price:12.5,reason:'Allow fittings'}]});
test('estimate validation computes totals and rejects invalid numbers or duplicate call fees',()=>{
 const a=validateEstimate(advice());assert.equal(a.recommended_total,25);assert.equal(a.recommended_line_items[0].description,'Misc fittings');assert.equal(a.sources.length,1);
 for(const patch of [{quantity:-1},{unit_price:NaN},{description:'Truck fee'},{description:'Dispatch fee'},{description:'Service-call charge'},{unit_price:'25'}]){const v=advice();Object.assign(v.recommended_line_items[0],patch);assert.throws(()=>validateEstimate(v));}
 const missing=advice();missing.sources=[];assert.equal(validateEstimate(missing).market_low,null);
 assert.throws(()=>estimateInput({title:'Test',labor_hours:-1}));assert.throws(()=>estimateInput({}));assert.equal(estimateInput({title:'Test'}).markup_pct,25);
});
test('price book selection is bounded and keeps saved selling prices unchanged',()=>{
 const input=estimateInput({title:'Replace toilet'});const rows=[{name:'Toilet replacement',description:'Existing fixture',quantity:1,unit_price:300},{name:'Water heater',description:'Tank',quantity:1,unit_price:2500},{name:'Toilet',quantity:1,unit_price:'bad'}];
 const matched=relevantPrices(rows,input);assert.equal(matched.length,1);assert.equal(matched[0].unit_price,300);assert.ok(relevantPrices(Array(30).fill(rows[0]),input).length<=15);
});
test('AI estimator authenticates first, uses structured price-book context and rejects invalid responses',async()=>{
 const previous=global.fetch,key=process.env.OPENAI_API_KEY,dbKey=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.OPENAI_API_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';let allowed=false,mode='ok',calls=0;
 global.fetch=async(url,opt={})=>{
  if(String(url).includes('fieldops_key_status'))return Response.json(allowed);
  if(String(url).includes('fieldops_pricebook'))return Response.json([{name:'Toilet replacement',quantity:1,unit_price:300}]);
  calls++;const req=JSON.parse(opt.body);assert.equal(req.store,false);assert.equal(req.text.format.strict,true);assert.equal(req.model,'gpt-6-astra');assert.ok(opt.signal);assert.equal(JSON.parse(req.input).matching_pricebook[0].unit_price,300);
  const a=advice();if(mode==='bad')a.recommended_line_items[0].quantity=-2;
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(a)}]}]});
 };
 const run=async()=>{const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};await handler({method:'POST',headers:{'x-fieldops-key':'test'},body:{title:'Replace toilet'}},res);return res;};
 try{assert.equal((await run()).statusCode,401);assert.equal(calls,0);allowed=true;const good=await run();assert.equal(good.statusCode,200);assert.equal(good.body.analysis.recommended_total,25);assert.equal(good.body.pricebook_matches,1);mode='bad';assert.equal((await run()).statusCode,502);}finally{global.fetch=previous;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(dbKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=dbKey;}
});
