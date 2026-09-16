import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimatorInput, priceEstimate, relevantPrices, sanitizeMarket, buildEstimatorSchema} from '../lib/estimator.js';
import handler from '../api/estimate-assist.js';

const range = {min: 120, max: 200};
const construction = () => ({
  profile: 'construction', project: 'Bathroom remodel', scope: 'Replace toilet and vanity, relocate shower drain.',
  location: 'Peabody', conditions: 'Open wall access', responsibilities: 'GC handles finishes', permits: 'A-1 obtains permit',
  markup: 25, fees: 250,
  tasks: [
    {name: 'Install toilet flange', quantity: 3, difficulty: 'moderate', hours: 1, materials: 20},
    {name: 'Mount vanity to wall', quantity: 4, difficulty: 'standard', hours: 1.5, materials: 30},
    {name: 'Install tankless water heater', quantity: 1, difficulty: 'difficult', hours: null, materials: 900}
  ]
});
const constructionDraft = () => ({
  summary: 'Multi-fixture bathroom remodel.',
  tasks: [
    {description: 'Install toilet flanges', hours: 1, reason: 'Standard swap'},
    {description: 'Mount vanities', hours: 1.5, reason: 'Standard access'},
    {description: 'Install tankless heater', hours: 6, reason: 'Venting and gas line'}
  ],
  exclusions: ['Tile work by others'], questions: [],
  market_low: null, market_typical: null, market_high: null, sources: []
});

test('itemized construction quote prices each task by hours × difficulty-based rate × quantity, plus marked-up materials', () => {
  const q = priceEstimate(construction(), constructionDraft(), range);
  assert.equal(q.tasks[0].rate, 160); // moderate = midpoint of 120-200
  assert.equal(q.tasks[1].rate, 120); // standard = low end
  assert.equal(q.tasks[2].rate, 200); // difficult = high end
  assert.equal(q.tasks[0].labor, 480); // 1hr * 3 qty * $160
  assert.equal(q.tasks[0].materials, 75); // $20 * 3 qty * 1.25 markup
  assert.equal(q.total, 4000);
  assert.equal(q.profile, 'construction');
  assert.equal(q.isBudget, true); // tankless heater hours were AI-estimated
  assert.match(q.checks.join(' '), /AI-estimated hours/);
  assert.match(q.description, /Budget only/);
  assert.match(q.description, /change order/);
});

test('a fully-specified job with confirmed conditions is not flagged as a budget estimate', () => {
  const x = construction(); x.tasks[2].hours = 6;
  const q = priceEstimate(x, constructionDraft(), range);
  assert.equal(q.isBudget, false);
  assert.match(q.description, /proposed scope/);
});

test('legacy single-job shape from the inline estimate-form AI button becomes one implicit task', () => {
  const x = estimatorInput({title: 'Replace toilet', description: 'Standard swap', job_difficulty: 'moderate', labor_hours: 2, material_cost: 100});
  assert.equal(x.profile, 'service');
  assert.equal(x.tasks.length, 1);
  assert.equal(x.tasks[0].quantity, 1);
  assert.equal(x.tasks[0].difficulty, 'moderate');
  assert.throws(() => estimatorInput({}));
  assert.throws(() => estimatorInput({tasks: [{name: 'Task', quantity: -1}]}));
});

test('difficulty range, zero-hour exclusions, invalid numeric data and malformed AI response', () => {
  for (const [difficulty, rate] of [['standard', 120], ['moderate', 160], ['difficult', 200], ['unassessed', 120], ['specialist', 200]]) {
    const x = construction(); x.tasks[0].difficulty = difficulty;
    assert.equal(priceEstimate(x, constructionDraft(), range).tasks[0].rate, rate);
  }
  for (const v of [-1, Infinity, NaN, 'bad', true]) assert.throws(() => estimatorInput({...construction(), markup: v}));
  assert.throws(() => priceEstimate(construction(), {...constructionDraft(), tasks: []}, range));
  const x = construction(); x.tasks[0].hours = 0;
  assert.equal(priceEstimate(x, constructionDraft(), range).tasks[0].labor, 0);
});

test('price book selection matches against scope and task names, bounded to 15 results', () => {
  const input = estimatorInput({title: 'Replace toilet', tasks: [{name: 'Toilet replacement', quantity: 1}]});
  const rows = [{name: 'Toilet replacement', description: 'Existing fixture', quantity: 1, unit_price: 300}, {name: 'Water heater', description: 'Tank', quantity: 1, unit_price: 2500}, {name: 'Toilet', quantity: 1, unit_price: 'bad'}];
  const matched = relevantPrices(rows, input);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].unit_price, 300);
  assert.ok(relevantPrices(Array(30).fill(rows[0]), input).length <= 15);
});

test('market data is only trusted alongside at least one valid https source, and low/high are cleared when inverted', () => {
  assert.deepEqual(sanitizeMarket({market_low: 100, market_typical: 200, market_high: 300, sources: []}), {market_low: null, market_typical: null, market_high: null, sources: []});
  const good = sanitizeMarket({market_low: 100, market_typical: 200, market_high: 300, sources: [{title: 'Ref', url: 'https://example.com/prices'}, {title: 'Unsafe', url: 'javascript:alert(1)'}]});
  assert.equal(good.sources.length, 1);
  assert.equal(good.market_low, 100);
  const inverted = sanitizeMarket({market_low: 300, market_typical: 200, market_high: 100, sources: [{title: 'Ref', url: 'https://example.com'}]});
  assert.equal(inverted.market_low, null);
  assert.equal(inverted.market_high, null);
});

test('schema requires exactly one task entry per supplied task, in order', () => {
  const schema = buildEstimatorSchema(3);
  assert.equal(schema.properties.tasks.minItems, 3);
  assert.equal(schema.properties.tasks.maxItems, 3);
});

test('AI estimator authenticates first, applies the correct rate profile, and rejects invalid responses', async () => {
  const previous = global.fetch, key = process.env.OPENAI_API_KEY, dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OPENAI_API_KEY = 'test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  let allowed = false, mode = 'ok', calls = 0;
  global.fetch = async (url, opt = {}) => {
    if (String(url).includes('fieldops_key_status')) return Response.json(allowed);
    if (String(url).includes('fieldops_ai_usage')) return Response.json(opt?.method === 'POST' ? [{id: 'usage-1'}] : []);
    if (String(url).includes('fieldops_labor_rate_settings')) return Response.json([{profile: 'service', min_rate: 120, max_rate: 200}, {profile: 'construction', min_rate: 130, max_rate: 210}]);
    if (String(url).includes('fieldops_pricebook')) return Response.json([{name: 'Toilet replacement', quantity: 1, unit_price: 300}]);
    calls++;
    const req = JSON.parse(opt.body);
    assert.equal(req.store, false);
    assert.equal(req.text.format.strict, true);
    assert.equal(req.model, 'gpt-6-astra');
    assert.ok(opt.signal);
    const job = JSON.parse(req.input).job;
    assert.equal(job.profile, 'construction');
    assert.match(req.instructions, /\$130 standard, \$170 moderate, \$210 difficult/);
    const draft = mode === 'bad' ? {...constructionDraft(), tasks: []} : constructionDraft();
    return Response.json({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(draft)}]}]});
  };
  const run = async () => { const res = {statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; }}; await handler({method: 'POST', headers: {'x-fieldops-key': 'test'}, body: construction()}, res); return res; };
  try {
    assert.equal((await run()).statusCode, 401); assert.equal(calls, 0);
    allowed = true;
    const good = await run();
    assert.equal(good.statusCode, 200);
    assert.equal(good.body.quote.total, good.body.analysis.recommended_total);
    assert.equal(good.body.pricebook_matches, 1);
    mode = 'bad';
    assert.equal((await run()).statusCode, 502);
  } finally {
    global.fetch = previous;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
    if (dbKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = dbKey;
  }
});

test('estimator API refuses AI work once the usage rate limit is hit', async () => {
  const previous = global.fetch, key = process.env.OPENAI_API_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY, hourly = process.env.AI_HOURLY_LIMIT;
  process.env.OPENAI_API_KEY = 'fixture'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture'; process.env.AI_HOURLY_LIMIT = '2';
  let aiCalls = 0;
  global.fetch = async (url, o) => {
    if (String(url).includes('fieldops_key_status')) return Response.json(true);
    if (String(url).includes('fieldops_ai_usage')) return Response.json(o?.method === 'POST' ? [{id: 'usage-1'}] : [{id: 1}, {id: 2}]);
    if (String(url).includes('fieldops_labor_rate_settings')) return Response.json([]);
    if (String(url).includes('api.openai.com')) { aiCalls++; return Response.json({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(constructionDraft())}]}]}); }
    throw Error('Unexpected request: ' + url);
  };
  const response = () => ({setHeader() {}, status(s) { this.code = s; return this; }, json(j) { this.body = j; return this; }});
  try {
    const r = response();
    await handler({method: 'POST', headers: {'x-fieldops-key': 'owner'}, body: construction()}, r);
    assert.equal(r.code, 429);
    assert.match(r.body.error, /AI usage limit reached/);
    assert.equal(aiCalls, 0);
  } finally {
    global.fetch = previous;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
    if (svcKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = svcKey;
    if (hourly === undefined) delete process.env.AI_HOURLY_LIMIT; else process.env.AI_HOURLY_LIMIT = hourly;
  }
});
