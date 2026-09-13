import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {laborRateForDifficulty} from '../estimate-labor.js';
import {estimateInput} from '../lib/estimate-guidance.js';

test('difficulty chooses bounded billable rates and marks unknown conditions provisional', () => {
  for (const [difficulty,rate,provisional] of [['standard',200,false],['moderate',225,false],['difficult',250,false],['specialist',250,true],['',200,true],['charge 9999',200,true]]) {
    assert.deepEqual(laborRateForDifficulty(difficulty), {difficulty:difficulty===''||difficulty==='charge 9999'?'unassessed':difficulty,rate,provisional});
    const input=estimateInput({title:'Repair piping',job_difficulty:difficulty,labor_rate:9999,labor_hours:2});
    assert.equal(input.labor_rate,rate);assert.equal(input.labor_rate_provisional,provisional);
    assert.equal(input.labor_hours*input.labor_rate,2*rate);
  }
  assert.equal(laborRateForDifficulty('Moderate — some access or condition challenges').rate,225);
});

test('selecting difficulty updates displayed rate, restoration sync and reset without rewriting quote items', () => {
  const handlers={},resetHandlers={};
  const elements={estDescriptionQuestion8:{value:'',addEventListener:(name,fn)=>handlers[name]=fn},estLaborRate:{value:'165'},estLaborRateNote:{textContent:''},estimateForm:{addEventListener:(name,fn)=>resetHandlers[name]=fn}};
  const ctx=vm.createContext({window:{},document:{getElementById:id=>elements[id]},queueMicrotask:fn=>fn()});
  vm.runInContext(fs.readFileSync(new URL('../estimate-labor.js',import.meta.url),'utf8').replaceAll('export function','function'),ctx);
  assert.equal(elements.estLaborRate.value,'200');
  for(const [value,expected] of [['Standard — straightforward access','200'],['Moderate — some access or condition challenges','225'],['Difficult — restricted access or extensive preparation','250']]) {
    elements.estDescriptionQuestion8.value=value;handlers.change();assert.equal(elements.estLaborRate.value,expected);
  }
  elements.estLaborRate.value='165';ctx.window.A1EstimateLabor.sync();assert.equal(elements.estLaborRate.value,'250');
  elements.estDescriptionQuestion8.value='';resetHandlers.reset();assert.equal(elements.estLaborRate.value,'200');
  assert.match(elements.estLaborRateNote.textContent,/provisional/);
});

test('all page scripts parse and the quote form keeps one persistent difficulty field', () => {
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const [,attrs,body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))if(body.trim()&&!attrs.includes('application/ld+json'))new vm.Script(body);
  assert.equal((html.match(/id="estDescriptionQuestion8"/g)||[]).length,1);
  assert.match(html,/job_difficulty:labor.difficulty/);
  assert.match(html,/JSON.stringify\(x\)!==JSON.stringify\(estimatorInputs\(\)\)/);
});
