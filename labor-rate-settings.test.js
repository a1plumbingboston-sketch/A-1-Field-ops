import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getLaborRateRanges, invalidateLaborRateCache, laborRateSettingsHandler} from '../lib/labor-rate.js';

function response() { return {setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }}; }
function withEnv(fn) {
  return async () => {
    const previous = global.fetch, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    invalidateLaborRateCache();
    try { await fn(); } finally { global.fetch = previous; if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = key; invalidateLaborRateCache(); }
  };
}

test('getLaborRateRanges reads saved rows and falls back to defaults for a missing or invalid profile', withEnv(async () => {
  global.fetch = async url => { if (String(url).includes('fieldops_labor_rate_settings')) return Response.json([{profile: 'construction', min_rate: 150, max_rate: 220}, {profile: 'service', min_rate: 300, max_rate: 100}]); throw Error('unexpected: ' + url); };
  const ranges = await getLaborRateRanges();
  assert.deepEqual(ranges.construction, {min: 150, max: 220});
  assert.deepEqual(ranges.service, {min: 120, max: 200}); // invalid row (max<min) ignored, default kept
}));

test('getLaborRateRanges fails open to defaults on a database error', withEnv(async () => {
  global.fetch = async () => { throw new Error('network down'); };
  const ranges = await getLaborRateRanges();
  assert.deepEqual(ranges, {service: {min: 120, max: 200}, construction: {min: 120, max: 200}});
}));

test('laborRateSettingsHandler requires authentication and validates the range before saving', withEnv(async () => {
  let allowed = false, patched = null;
  global.fetch = async (url, opt = {}) => {
    if (String(url).includes('fieldops_key_status')) return Response.json(allowed);
    if (String(url).includes('fieldops_labor_rate_settings')) { if (opt.method === 'PATCH') { patched = JSON.parse(opt.body); return Response.json([{profile: 'service', min_rate: 130, max_rate: 210}]); } return Response.json([{profile: 'service', min_rate: 130, max_rate: 210}, {profile: 'construction', min_rate: 120, max_rate: 200}]); }
    throw Error('unexpected: ' + url);
  };
  let res = response();
  await laborRateSettingsHandler({method: 'POST', headers: {}, body: {profile: 'service', min: 130, max: 210}}, res);
  assert.equal(res.code, 401);
  allowed = true;
  res = response();
  await laborRateSettingsHandler({method: 'POST', headers: {'x-fieldops-key': 'owner'}, body: {profile: 'nonsense', min: 130, max: 210}}, res);
  assert.equal(res.code, 400);
  res = response();
  await laborRateSettingsHandler({method: 'POST', headers: {'x-fieldops-key': 'owner'}, body: {profile: 'service', min: 210, max: 130}}, res);
  assert.equal(res.code, 400);
  res = response();
  await laborRateSettingsHandler({method: 'POST', headers: {'x-fieldops-key': 'owner'}, body: {profile: 'service', min: 130, max: 210}}, res);
  assert.equal(res.code, 200);
  assert.equal(patched.min_rate, 130);
  assert.equal(patched.max_rate, 210);
  res = response();
  await laborRateSettingsHandler({method: 'GET', headers: {'x-fieldops-key': 'owner'}}, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.service, {min: 130, max: 210});
}));
