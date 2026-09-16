// One pricing engine, used by both AI estimating entry points:
//  - the quick inline "AI Polish"/research button on a single job in the
//    main estimate form (legacy shape: title/description/labor_hours), and
//  - the full itemized Task Estimator (a list of named tasks with
//    quantities, hours and materials, for service or construction jobs).
// estimatorInput() accepts either shape and always produces the same
// {profile, scope, tasks:[...]} structure so pricing math only has to be
// written once. Task-level difficulty (not job-level) is what changed most
// from the old fixed-4-phase remodel engine: a 24-line bathroom/kitchen
// punch list can now have a different difficulty per task instead of one
// difficulty for the whole job.
import {rateForDifficulty, normalizeDifficulty} from '../estimate-labor.js';

export const text = (v, max = 2400) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
function amount(v, name, max, optional = false) {
  if (optional && (v === '' || v === null || v === undefined)) return null;
  if (typeof v === 'boolean' || (typeof v !== 'number' && typeof v !== 'string')) throw Error(`Enter a valid ${name}.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw Error(`Enter ${name} between 0 and ${max}.`);
  return n;
}
export const money = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function estimatorInput(v = {}) {
  if (!v || typeof v !== 'object') throw Error('Complete the job details.');
  const x = {};
  x.profile = v.profile === 'construction' ? 'construction' : 'service';
  for (const key of ['location', 'conditions', 'responsibilities', 'permits', 'schedule', 'exclusions']) x[key] = text(v[key]);
  x.markup = amount(v.markup_pct ?? v.markup, 'material markup', 1000, true) ?? 25;
  x.fees = amount(v.fees, 'permit and outside costs', 100000, true);
  x.project = text(v.project || v.title, 300);

  let rawTasks = Array.isArray(v.tasks) ? v.tasks : null;
  if (!rawTasks) {
    // Legacy single-job shape sent by the main estimate form's inline AI
    // assist button — treated as one implicit task so it runs through the
    // exact same pricing and safety checks as the itemized tool.
    const scope = text([v.title, v.description].filter(Boolean).join(' \u2014 '), 6000);
    if (!scope) throw Error('Describe the job before requesting AI guidance.');
    x.scope = scope;
    rawTasks = [{
      name: text(v.title, 200) || 'Job',
      quantity: 1,
      difficulty: v.job_difficulty,
      hours: (v.labor_hours === '' || v.labor_hours == null) ? null : v.labor_hours,
      materials: (v.material_cost === '' || v.material_cost == null) ? null : v.material_cost
    }];
  } else {
    x.scope = text(v.scope || v.project || v.title, 6000);
    if (!x.scope) throw Error('Describe the job scope.');
  }
  if (!rawTasks.length) throw Error('Add at least one task.');
  if (rawTasks.length > 60) throw Error('Split this into more than one quote \u2014 60 tasks max.');
  x.tasks = rawTasks.map((t, i) => {
    const name = text(t?.name, 200) || `Task ${i + 1}`;
    const quantity = amount(t?.quantity ?? 1, `${name} quantity`, 1000) ?? 1;
    const difficulty = normalizeDifficulty(t?.difficulty);
    const hours = amount(t?.hours, `${name} hours`, 1000, true);
    const materials = amount(t?.materials, `${name} material cost`, 100000, true);
    return {name, quantity, difficulty, hours, materials};
  });
  return x;
}

// Turns the AI's per-task draft into server-calculated prices. The AI only
// ever supplies descriptions, hour *suggestions* (used solely where the
// owner left hours blank) and reasoning text — every dollar amount here is
// computed from the owner's numbers and the authoritative rate, never taken
// from the model.
export function priceEstimate(input, draft, range) {
  const x = estimatorInput(input);
  if (!draft || !Array.isArray(draft.tasks) || draft.tasks.length !== x.tasks.length || !text(draft.summary)) throw Error('The AI draft is incomplete. Generate it again.');
  const checks = [];
  for (const key of ['location', 'conditions', 'responsibilities', 'permits']) if (!x[key]) checks.push(`Confirm ${key}.`);
  const tasks = x.tasks.map((task, i) => {
    const ai = draft.tasks[i];
    const {rate, provisional} = rateForDifficulty(task.difficulty, range);
    if (provisional) checks.push(`Confirm difficulty for "${task.name}" on site.`);
    const suggestedHours = amount(ai.hours, `${task.name} AI hours`, 1000);
    const hoursPerUnit = task.hours ?? suggestedHours;
    if (task.hours === null) checks.push(`Confirm hours for "${task.name}": ${hoursPerUnit} AI-estimated hours each.`);
    if (task.materials === null) checks.push(`Price materials for "${task.name}" (currently excluded).`);
    const totalHours = money(hoursPerUnit * task.quantity);
    const labor = money(totalHours * rate);
    const materials = money((task.materials ?? 0) * task.quantity * (1 + x.markup / 100));
    return {...task, rate, hoursPerUnit, totalHours, labor, materials, total: money(labor + materials), description: text(ai.description, 300) || task.name, reason: text(ai.reason, 600)};
  });
  if (x.fees === null) checks.push('Confirm permit and outside costs (currently excluded).');
  checks.push(...(Array.isArray(draft.questions) ? draft.questions : []).map(q => text(q, 400)).filter(Boolean));
  const items = tasks.filter(t => t.total > 0).map(t => ({description: `${t.description}${t.quantity !== 1 ? ` \u00d7 ${t.quantity}` : ''}`, quantity: 1, unit_price: t.total}));
  if (x.fees > 0) items.push({description: 'Permit and outside costs \u2014 allowance', quantity: 1, unit_price: money(x.fees)});
  const total = money(items.reduce((n, i) => n + i.unit_price, 0));
  if (total <= 0) throw Error('Add labor hours or material costs before creating a quote.');
  const exclusions = [x.exclusions, ...(Array.isArray(draft.exclusions) ? draft.exclusions : [])].map(s => text(s, 600)).filter(Boolean);
  const isBudget = checks.length > 0;
  const label = x.profile === 'construction' ? 'Remodel' : 'Service';
  const description = [
    `${label} ${isBudget ? 'budget estimate' : 'proposed scope'}: ${text(draft.summary, 800)}`,
    isBudget ? 'Budget only; unresolved scope and allowances require confirmation before a fixed-price agreement.' : '',
    exclusions.length ? 'Exclusions: ' + [...new Set(exclusions)].join('; ') : '',
    'Changes to scope or concealed conditions require a separately priced change order approved before additional work.'
  ].filter(Boolean).join('\n\n');
  return {tasks, items, total, profile: x.profile, checks: [...new Set(checks)], description, isBudget};
}

// Sources/market range are informational context from web search, kept
// separate from priceEstimate's authoritative math.
export function sanitizeMarket(draft = {}) {
  const sources = (Array.isArray(draft.sources) ? draft.sources : []).slice(0, 8).flatMap(s => {
    try {
      const u = new URL(s.url);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return [];
      return [{title: text(s.title, 200) || u.hostname, url: u.href}];
    } catch { return []; }
  });
  const market = {};
  for (const k of ['market_low', 'market_typical', 'market_high']) {
    market[k] = sources.length && typeof draft[k] === 'number' && Number.isFinite(draft[k]) && draft[k] >= 0 && draft[k] <= 100000000 ? draft[k] : null;
  }
  if (market.market_low !== null && market.market_high !== null && market.market_low > market.market_high) for (const k in market) market[k] = null;
  return {...market, sources};
}

export function relevantPrices(rows, input) {
  const ignored = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'need', 'customer', 'supplied']);
  const scopeText = String(input.scope || '') + ' ' + (Array.isArray(input.tasks) ? input.tasks.map(t => t.name).join(' ') : '');
  const words = new Set((scopeText.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !ignored.has(w)));
  return rows.map(r => ({r, score: [...words].filter(w => (r.name + ' ' + r.description + ' ' + r.category).toLowerCase().includes(w)).length}))
    .filter(x => x.score > 0 && Number.isFinite(Number(x.r.unit_price)) && Number(x.r.unit_price) >= 0 && Number.isFinite(Number(x.r.quantity)) && Number(x.r.quantity) > 0)
    .sort((a, b) => b.score - a.score).slice(0, 15)
    .map(({r}) => ({name: text(r.name, 160), description: text(r.description, 500), quantity: Number(r.quantity), unit_price: Number(r.unit_price)}));
}

const string = {type: 'string'};
export function buildEstimatorSchema(taskCount) {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      summary: string,
      tasks: {type: 'array', minItems: taskCount, maxItems: taskCount, items: {type: 'object', additionalProperties: false, properties: {description: string, hours: {type: 'number'}, reason: string}, required: ['description', 'hours', 'reason']}},
      exclusions: {type: 'array', items: string},
      questions: {type: 'array', items: string},
      market_low: {type: ['number', 'null']}, market_typical: {type: ['number', 'null']}, market_high: {type: ['number', 'null']},
      sources: {type: 'array', items: {type: 'object', additionalProperties: false, properties: {title: string, url: string}, required: ['title', 'url']}}
    },
    required: ['summary', 'tasks', 'exclusions', 'questions', 'market_low', 'market_typical', 'market_high', 'sources']
  };
}
