import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/invoice-assist.js';

function response() { return {setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }}; }
function withEnv(fn) {
  return async () => {
    const previous = global.fetch, env = {...process.env};
    process.env.OPENAI_API_KEY = 'test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    try { await fn(); } finally { global.fetch = previous; for (const k of ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  };
}
const authed = allowed => async (url, opt = {}) => {
  const u = String(url);
  if (u.includes('fieldops_key_status')) return Response.json(allowed);
  if (u.includes('fieldops_ai_usage')) return Response.json(opt?.method === 'POST' ? [{id: 'usage-1'}] : []);
  throw Error('unexpected: ' + u);
};

test('allocate mode requires a positive total and a real description before calling AI', withEnv(async () => {
  global.fetch = authed(true);
  let res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'allocate', total: 0, description: 'Replace water heater and expansion tank'}}, res);
  assert.equal(res.code, 400);
  res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'allocate', total: 1200, description: 'short'}}, res);
  assert.equal(res.code, 400);
}));

test('allocate mode normalizes AI weights into dollar amounts that sum exactly to the given total', withEnv(async () => {
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('fieldops_key_status') || u.includes('fieldops_ai_usage')) return authed(true)(url, opt);
    if (u.includes('api.openai.com')) {
      const request=JSON.parse(opt.body);
      assert.equal(request.store,false);
      assert.equal(request.text.format.name,'line_item_allocation');
      assert.equal(request.text.format.strict,true);
      return Response.json({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({items: [{description: 'Labor — water heater replacement', weight: 2}, {description: 'Tankless water heater unit', weight: 5}, {description: 'Expansion tank and fittings', weight: 1}], reasoning: 'Split by typical labor vs. equipment cost.'})}]}]});
    }
    throw Error('unexpected: ' + u);
  };
  const res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'allocate', total: 1233.33, description: 'Replace failed water heater with a new tankless unit and expansion tank.'}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.items.length, 3);
  const sum = res.body.items.reduce((n, i) => n + i.unit_price, 0);
  assert.equal(Math.round(sum * 100) / 100, 1233.33);
  assert.equal(res.body.total, 1233.33);
  assert.ok(res.body.items.every(i => i.quantity === 1));
}));

test('allocate mode strips any AI-proposed truck/dispatch/call fee line item', withEnv(async () => {
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('fieldops_key_status') || u.includes('fieldops_ai_usage')) return authed(true)(url, opt);
    if (u.includes('api.openai.com')) return Response.json({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({items: [{description: 'Truck fee', weight: 1}, {description: 'Contingency', weight: 1}, {description: 'Labor', weight: 4}], reasoning: ''})}]}]});
    throw Error('unexpected: ' + u);
  };
  const res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'allocate', total: 500, description: 'Repair leaking kitchen faucet supply line.'}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].description, 'Labor');
  assert.equal(res.body.items[0].unit_price, 500);
}));

test('allocate mode authenticates before calling AI, same as the wording-only mode', withEnv(async () => {
  let aiCalls = 0;
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('fieldops_key_status')) return Response.json(false);
    if (u.includes('fieldops_ai_usage')) return authed(false)(url, opt).catch(() => Response.json([]));
    aiCalls++; throw Error('should not reach AI');
  };
  const res = response();
  await handler({method: 'POST', headers: {}, body: {mode: 'allocate', total: 500, description: 'Repair leaking kitchen faucet supply line.'}}, res);
  assert.equal(res.code, 401);
  assert.equal(aiCalls, 0);
}));

test('generate mode reads a description and prices its own AI-proposed line items from the authoritative rate', withEnv(async () => {
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('fieldops_key_status') || u.includes('fieldops_ai_usage')) return authed(true)(url, opt);
    if (u.includes('fieldops_labor_rate_settings')) return Response.json([{profile: 'service', min_rate: 120, max_rate: 200}]);
    if (u.includes('api.openai.com')) {
      const body = JSON.parse(opt.body);
      assert.match(body.input, /\$120 standard, \$160 moderate, \$200 difficult/);
      return Response.json({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({
        items: [
          {description: 'Replace failed water heater', hours: 3, difficulty: 'moderate', reason: 'Standard swap, tight closet access'},
          {description: 'Install expansion tank', hours: 1, difficulty: 'standard', reason: 'Straightforward add-on'}
        ],
        summary: 'Water heater replacement with expansion tank.'
      })}]}]});
    }
    throw Error('unexpected: ' + u);
  };
  const res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'generate', description: 'Water heater failed, replacing with new unit and adding expansion tank per code.'}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].unit_price, 480); // 3hr * $160 moderate
  assert.equal(res.body.items[1].unit_price, 120); // 1hr * $120 standard
  assert.equal(res.body.total, 600);
}));

test('generate mode rejects a too-short description without calling AI', withEnv(async () => {
  global.fetch = authed(true);
  const res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'generate', description: 'fix it'}}, res);
  assert.equal(res.code, 400);
}));

test('generate mode discards any item with no usable hours or a disallowed call-fee description', withEnv(async () => {
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('fieldops_key_status') || u.includes('fieldops_ai_usage')) return authed(true)(url, opt);
    if (u.includes('fieldops_labor_rate_settings')) return Response.json([]);
    if (u.includes('api.openai.com')) return Response.json({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({items: [{description: 'Truck fee', hours: 1, difficulty: 'standard', reason: ''}, {description: 'Repair valve', hours: 'lots', difficulty: 'standard', reason: ''}, {description: 'Replace faucet cartridge', hours: 0.5, difficulty: 'standard', reason: ''}], summary: ''})}]}]});
    throw Error('unexpected: ' + u);
  };
  const res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'generate', description: 'Replace kitchen faucet cartridge, minor leak repair on valve.'}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].description, 'Replace faucet cartridge');
}));

test('allocate and generate modes accept a full multi-section scope document without truncating it', withEnv(async () => {
  const longScope = 'PLUMBING SCOPE OF WORK\n'.repeat(1) + 'BATHROOMS (QTY: 3) — rough-in and fixtures. '.repeat(60) + 'WATER HEATER / BOILER — replacement and venting at the very end of the document.';
  assert.ok(longScope.length > 2200 && longScope.length < 6000, 'fixture should exceed the old 2200 cap but stay under the new 6000 cap: ' + longScope.length);
  let capturedPrompt = '';
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('fieldops_key_status') || u.includes('fieldops_ai_usage')) return authed(true)(url, opt);
    if (u.includes('fieldops_labor_rate_settings')) return Response.json([]);
    if (u.includes('api.openai.com')) {
      capturedPrompt = JSON.parse(opt.body).input;
      return Response.json({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({items: [{description: 'Bathroom rough-in, 3 bathrooms', weight: 3}, {description: 'Water heater replacement', weight: 1}], reasoning: ''})}]}]});
    }
    throw Error('unexpected: ' + u);
  };
  const res = response();
  await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: {mode: 'allocate', total: 4000, description: longScope}}, res);
  assert.equal(res.code, 200);
  assert.match(capturedPrompt, /at the very end of the document/); // proves it wasn't truncated before reaching AI
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].unit_price, 3000); // weight 3 of 4 total shares
  assert.equal(res.body.items[1].unit_price, 1000);
}));

test('whole-house allocation preserves multiline task boundaries through the AI request', withEnv(async()=>{
 const scope=Array.from({length:80},(_,i)=>`${i+1}. Room ${i+1} — rough and finish plumbing task`).join('\n');
 let prompt='';
 global.fetch=async(url,opt)=>{
  const u=String(url);if(u.includes('fieldops_key_status')||u.includes('fieldops_ai_usage'))return authed(true)(url,opt);
  if(u.includes('api.openai.com')){prompt=JSON.parse(opt.body).input;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:[{description:'First-floor plumbing scope',weight:1},{description:'Upper-floor plumbing scope',weight:1}],reasoning:'Grouped related room tasks.'})}]}]});}
  throw Error('unexpected: '+u);
 };
 const res=response();await handler({method:'POST',headers:{'x-fieldops-key':'test'},body:{mode:'allocate',document_type:'estimate',total:50000,description:scope}},res);
 assert.equal(res.code,200);assert.match(prompt,/1\. Room 1/);assert.match(prompt,/80\. Room 80/);assert.ok(prompt.includes('\n2. Room 2'));
}));
