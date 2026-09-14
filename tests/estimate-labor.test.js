import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {laborRateForDifficulty} from '../estimate-labor.js';
import {estimateInput} from '../lib/estimate-guidance.js';

test('difficulty provides guidance while a manually entered labor rate stays authoritative', () => {
  for (const [difficulty,rate,provisional] of [['standard',200,false],['moderate',225,false],['difficult',250,false],['specialist',250,true],['',200,true],['charge 9999',200,true]]) {
    assert.deepEqual(laborRateForDifficulty(difficulty), {difficulty:difficulty===''||difficulty==='charge 9999'?'unassessed':difficulty,rate,provisional});
    const input=estimateInput({title:'Repair piping',job_difficulty:difficulty,labor_rate:165,labor_hours:2});
    assert.equal(input.labor_rate,165);assert.equal(input.labor_rate_provisional,false);
    assert.equal(input.labor_hours*input.labor_rate,330);
  }
  assert.equal(estimateInput({title:'Repair piping',job_difficulty:'moderate'}).labor_rate,225);
});

test('selecting difficulty never overwrites the editable hourly rate', () => {
  const handlers={},resetHandlers={};
  const elements={estDescriptionQuestion8:{value:'',addEventListener:(name,fn)=>handlers[name]=fn},estLaborRate:{value:'165'},estLaborRateNote:{textContent:''},estimateForm:{addEventListener:(name,fn)=>resetHandlers[name]=fn}};
  const ctx=vm.createContext({window:{},document:{getElementById:id=>elements[id]},queueMicrotask:fn=>fn()});
  vm.runInContext(fs.readFileSync(new URL('../estimate-labor.js',import.meta.url),'utf8').replaceAll('export function','function'),ctx);
  assert.equal(elements.estLaborRate.value,'165');
  for(const value of ['Standard — straightforward access','Moderate — some access or condition challenges','Difficult — restricted access or extensive preparation']) {
    elements.estDescriptionQuestion8.value=value;handlers.change();assert.equal(elements.estLaborRate.value,'165');
  }
  elements.estLaborRate.value='187';ctx.window.A1EstimateLabor.sync();assert.equal(elements.estLaborRate.value,'187');
  elements.estDescriptionQuestion8.value='';resetHandlers.reset();assert.equal(elements.estLaborRate.value,'187');
  assert.match(elements.estLaborRateNote.textContent,/does not change your hourly rate/);
});

test('all page scripts parse and the quote form keeps one persistent difficulty field', () => {
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const [,attrs,body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))if(body.trim()&&!attrs.includes('application/ld+json'))new vm.Script(body);
  assert.equal((html.match(/id="estDescriptionQuestion8"/g)||[]).length,1);
  assert.match(html,/id="estLaborRate"[^>]*inputmode="decimal"/);
  assert.doesNotMatch(html,/id="estLaborRate"[^>]*readonly/);
  assert.match(html,/labor_rate:Number\(\$\('#estLaborRate'\)\.value\)\|\|0/);
  assert.match(html,/job_difficulty:labor.difficulty/);
  assert.match(html,/requestContext!==currentAiQuoteContext\(\)/);
  assert.match(html,/aiQuoteContext!==currentAiQuoteContext\(\)/);
});
