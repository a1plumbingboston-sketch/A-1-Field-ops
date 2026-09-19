import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('construction estimator asks for an owner price and uses exact-total allocation mode',()=>{
 const source=fs.readFileSync(new URL('../task-estimator.js',import.meta.url),'utf8');
 new vm.Script(source);
 assert.match(source,/Remodel \/ New Construction/);
 assert.match(source,/name="total"/);
 assert.match(source,/maxlength="16000"/);
 assert.match(source,/one task per line/i);
 assert.match(source,/mode:'allocate'/);
 assert.match(source,/document_type:'estimate'/);
 assert.match(source,/profile:'construction'/);
 assert.match(source,/Math\.round\(sum\*100\)!==Math\.round\(total\*100\)/);
 assert.doesNotMatch(source,/name="contingency"/i);
 assert.match(source,/No separate contingency or service-call line is added/i);
});

test('service estimator remains the market-research workflow',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const api=fs.readFileSync(new URL('../api/estimate-assist.js',import.meta.url),'utf8');
 assert.match(html,/AI Estimate Assist/);
 assert.match(html,/Job ZIP code or city/);
 assert.match(api,/requestBody\.tools=\[\{type:'web_search'\}\]/);
 assert.match(api,/matching_pricebook/);
 assert.match(api,/store:false/);
 assert.match(api,/strict:true/);
});
