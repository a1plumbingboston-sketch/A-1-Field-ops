import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {laborRateForDifficulty, rateForDifficulty, DEFAULT_RANGES} from '../estimate-labor.js';

test('difficulty chooses bounded billable rates within a range and marks unknown conditions provisional', () => {
  const range = {min: 120, max: 200};
  for (const [difficulty, rate, provisional] of [['standard', 120, false], ['moderate', 160, false], ['difficult', 200, false], ['specialist', 200, true], ['', 120, true], ['charge 9999', 120, true]]) {
    assert.deepEqual(rateForDifficulty(difficulty, range), {difficulty: difficulty === '' || difficulty === 'charge 9999' ? 'unassessed' : difficulty, rate, provisional});
  }
  assert.equal(rateForDifficulty('Moderate — some access or condition challenges', range).rate, 160);
});

test('laborRateForDifficulty defaults to the service profile and falls back to defaults for an invalid range', () => {
  assert.deepEqual(laborRateForDifficulty('standard'), {difficulty: 'standard', rate: DEFAULT_RANGES.service.min, provisional: false});
  assert.deepEqual(rateForDifficulty('standard', {min: 5, max: 1}), {difficulty: 'standard', rate: DEFAULT_RANGES.service.min, provisional: false});
  assert.deepEqual(rateForDifficulty('standard', null), {difficulty: 'standard', rate: DEFAULT_RANGES.service.min, provisional: false});
});

test('selecting difficulty updates displayed rate, restoration sync and reset without rewriting quote items', () => {
  const handlers = {}, resetHandlers = {}, quoteModeHandlers = {};
  const elements = {
    estDescriptionQuestion8: {value: '', addEventListener: (name, fn) => handlers[name] = fn},
    estQuoteMode: {value: 'service', addEventListener: (name, fn) => quoteModeHandlers[name] = fn},
    estLaborRate: {value: '165', min: '', max: ''},
    estLaborRateNote: {textContent: ''},
    estimateForm: {addEventListener: (name, fn) => resetHandlers[name] = fn}
  };
  const ctx = vm.createContext({window: {}, document: {getElementById: id => elements[id]}, queueMicrotask: fn => fn()});
  vm.runInContext(fs.readFileSync(new URL('../estimate-labor.js', import.meta.url), 'utf8').replaceAll('export function', 'function').replaceAll('export const', 'const').replaceAll('export async function', 'async function'), ctx);
  assert.equal(elements.estLaborRate.value, '120');
  for (const [value, expected] of [['Standard — straightforward access', '120'], ['Moderate — some access or condition challenges', '160'], ['Difficult — restricted access or extensive preparation', '200']]) {
    elements.estDescriptionQuestion8.value = value; handlers.change(); assert.equal(elements.estLaborRate.value, expected);
  }
  elements.estLaborRate.value = '165'; ctx.window.A1EstimateLabor.sync(); assert.equal(elements.estLaborRate.value, '200');
  elements.estDescriptionQuestion8.value = ''; resetHandlers.reset(); assert.equal(elements.estLaborRate.value, '120');
  assert.match(elements.estLaborRateNote.textContent, /provisional/);
  // Switching to remodel/construction mode uses the construction profile.
  elements.estQuoteMode.value = 'remodel'; elements.estDescriptionQuestion8.value = 'Difficult — restricted access or extensive preparation'; ctx.window.A1EstimateLabor.sync();
  assert.equal(elements.estLaborRate.value, '200');
});

test('all page scripts parse and the quote form keeps one persistent difficulty field', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) if (body.trim() && !attrs.includes('application/ld+json')) new vm.Script(body);
  assert.equal((html.match(/id="estDescriptionQuestion8"/g) || []).length, 1);
  assert.match(html, /job_difficulty:labor.difficulty/);
  assert.match(html, /requestContext!==currentAiQuoteContext\(\)/);
  assert.match(html, /aiQuoteContext!==currentAiQuoteContext\(\)/);
});
