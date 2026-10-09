import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateInput,validateEstimate} from '../lib/estimate-guidance.js';
import handler from '../api/estimate-assist.js';
const photo='data:image/jpeg;base64,/9j/';
test('photos are bounded and external URLs and unsupported content are rejected',()=>{
 assert.deepEqual(estimateInput({title:'Replace faucet',photos:[photo]}).photos,[photo]);
 for(const photos of [[photo,photo,photo,photo],['https://example.com/photo.jpg'],['data:image/svg+xml;base64,AAAA'],[photo+'!'],['data:image/jpeg;base64,'+'A'.repeat(700001)]])assert.throws(()=>estimateInput({title:'Repair',photos}));
});
test('clarification never exposes a speculative price or applicable quote lines',()=>{
 const result=validateEstimate({needs_clarification:true,clarifying_questions:['Who supplies the faucet?'],recommended_line_items:[{description:'Invented task',quantity:1,unit_price:900}],market_typical:900});
 assert.equal(result.recommended_total,0);assert.equal(result.market_typical,null);assert.deepEqual(result.recommended_line_items,[]);
 assert.throws(()=>validateEstimate({needs_clarification:true,clarifying_questions:[]}));
});
test('authenticated photo estimates send multimodal input and return clarification without repricing',async t=>{
 const previous=process.env.OPENAI_API_KEY,dbKey=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.OPENAI_API_KEY='test';delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;if(dbKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=dbKey;});
 t.mock.method(global,'fetch',async(url,opt)=>{
  if(String(url).includes('fieldops_key_status'))return Response.json(true);
  const body=JSON.parse(opt.body),content=body.input[0].content;
  assert.equal(content[1].type,'input_image');assert.equal(content[1].image_url,photo);
  const context=JSON.parse(content[0].text);assert.equal(context.job.labor_rate,200);assert.equal(context.job.photos,undefined);
  assert.match(body.instructions,/never infer hidden piping/);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({needs_clarification:true,clarifying_questions:['Customer-supplied fixture?']})}]}]});
 });
 const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{'x-fieldops-key':'test'},body:{title:'Faucet replacement',labor_rate:200,photos:[photo]}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.analysis.needs_clarification,true);assert.deepEqual(res.body.analysis.recommended_line_items,[]);
});
test('clarifying questions clear old suggestions and cannot render an Apply button',async()=>{
 const fs=await import('node:fs/promises'),vm=await import('node:vm');
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('function a1NeedsClarification('),html.indexOf('function estimatePricingBreakdown('));
 const panel={},context=vm.createContext({panel,aiQuoteSuggestions:[{unit_price:900}],aiQuoteContext:'old',esc:s=>s.replace(/</g,'&lt;')});
 vm.runInContext(source+"a1NeedsClarification({needs_clarification:true,clarifying_questions:['<Supply fixture?>']},panel)",context);
 assert.equal(context.aiQuoteSuggestions.length,0);assert.equal(context.aiQuoteContext,null);assert.match(panel.innerHTML,/&lt;Supply fixture/);assert.ok(!panel.innerHTML.includes('applyAiQuoteButton'));
});
