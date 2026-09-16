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
    if (u.includes('api.openai.com')) return Response.json({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({items: [{description: 'Truck fee', weight: 1}, {description: 'Labor', weight: 4}], reasoning: ''})}]}]});
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
