import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {serviceInput,calculateServiceQuote,retrievedSourceUrls} from '../lib/service-quote.js';
import {estimateInput,estimateLineItemTarget,reconcileEstimateTotal} from '../lib/estimate-guidance.js';
import handler from '../api/service-quote.js';
const input=serviceInput({description:'Replace customer-supplied faucet with accessible working stops.',labor_rate:200,markup_pct:25,contingency_pct:10});
const scope={summary:'Replace faucet and test.',questions:[],assumptions:['1.5 person-hours including cleanup.'],exclusions:['Countertop repair'],tasks:[{description:'Replace kitchen faucet',labor_hours:1.5,material_cost:40,materials:'Two supplies',cost_basis:'Unverified allowance for supplies',source_url:null}]};
test('service price uses the entered rate, marks materials once and adds one call fee',()=>{
 const a=calculateServiceQuote(scope,input);assert.equal(a.status,'review_required');assert.equal(a.tasks[0].labor_sell,300);assert.equal(a.tasks[0].materials_sell,55);assert.equal(a.recommended_total,355);assert.equal(a.total_with_truck,430);assert.equal(a.tasks[0].cost_verified,false);
 const b=calculateServiceQuote(scope,{...input,labor_rate:225,contingency_pct:0});assert.equal(b.recommended_total,387.5);
});
test('missing scope blocks price even if AI returns priced tasks',()=>{const a=calculateServiceQuote({...scope,questions:['Are the shutoffs working?']},input);assert.equal(a.recommended_total,null);assert.deepEqual(a.tasks,[]);assert.deepEqual(a.recommended_line_items,[]);});
test('unknown purchase cost never becomes zero or an applicable quote',()=>{const a=calculateServiceQuote({...scope,tasks:[{...scope.tasks[0],material_cost:null}]},input);assert.equal(a.status,'needs_costs');assert.equal(a.total_with_truck,null);assert.deepEqual(a.recommended_line_items,[]);});
test('customer-supplied material zero is supported but unsupported source claims are stripped',()=>{
 const t={...scope.tasks[0],material_cost:0,source_url:'https://supplier.example/item'};
 assert.equal(calculateServiceQuote({...scope,tasks:[t]},input).tasks[0].source_url,null);
 assert.equal(calculateServiceQuote({...scope,tasks:[t]},input,['https://supplier.example/item']).tasks[0].cost_verified,true);
 assert.equal(calculateServiceQuote({...scope,tasks:[t]},input).total_with_truck,375);
});
test('invalid inputs, duplicate tasks and extra fees fail closed',()=>{
 for(const rate of [0,-1,Infinity,1001])assert.throws(()=>serviceInput({...input,labor_rate:rate}));
 for(const changes of [{labor_hours:-1},{material_cost:'40'},{material_cost:Infinity},{description:'Truck fee'},{description:'Contingency'}])assert.throws(()=>calculateServiceQuote({...scope,tasks:[{...scope.tasks[0],...changes}]},input));
 assert.throws(()=>calculateServiceQuote({...scope,tasks:[scope.tasks[0],scope.tasks[0]]},input));
});
test('preset allocation honors exact total independently of service calculations',()=>{
 const x=estimateInput({title:'Faucet',allocation_mode:true,target_total:1000.01,labor_hours:9,labor_rate:225,material_cost:700});assert.equal(estimateLineItemTarget(x),1000.01);
 const a=reconcileEstimateTotal({recommended_line_items:[{description:'A',price:2},{description:'B',price:1}]},estimateLineItemTarget(x));assert.equal(a.recommended_total,1000.01);assert.equal(Math.round(a.recommended_line_items.reduce((n,i)=>n+i.price,0)*100),100001);
});
test('source verification uses provider citations and retrieved search sources',()=>{assert.deepEqual(retrievedSourceUrls({output:[{type:'web_search_call',action:{sources:[{url:'https://supplier.example/a'}]}},{content:[{annotations:[{type:'url_citation',url:'https://supplier.example/b'}]}]}]}),['https://supplier.example/a','https://supplier.example/b']);});
test('service endpoint authenticates, uses the structured Responses protocol and returns validated arithmetic',async()=>{
 const savedFetch=global.fetch,savedKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';let calls=0;
 const res=()=>Object.assign(new EventEmitter(),{setHeader(){},status(n){this.code=n;return this;},json(j){this.body=j;return this;}});
 try{
  global.fetch=async(url,options)=>{if(String(url).includes('fieldops_key_status'))return Response.json(options.headers['x-fieldops-key']==='valid');calls++;const body=JSON.parse(options.body);assert.equal(body.text.format.schema.additionalProperties,false);assert.equal(body.store,false);return Response.json({status:'completed',id:'test',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(scope)}]}]});};
  let r=res();await handler({method:'POST',headers:{},body:input},r);assert.equal(r.code,401);assert.equal(calls,0);
  r=res();await handler({method:'POST',headers:{'x-fieldops-key':'valid'},body:input},r);assert.equal(r.body.analysis.total_with_truck,430);assert.equal(calls,1);
  global.fetch=async url=>String(url).includes('fieldops_key_status')?Response.json(true):Response.json({status:'incomplete'});r=res();await handler({method:'POST',headers:{'x-fieldops-key':'valid'},body:input},r);assert.equal(r.code,502);assert.ok(!r.body.analysis);
 }finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=savedKey;}
});
