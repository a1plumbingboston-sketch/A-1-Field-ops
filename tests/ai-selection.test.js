import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('AI selection binds a callable handler and applies only checked items with recalculated totals',async()=>{
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.ok(!html.includes('id="applyAiQuote"'),'form controls must not shadow the handler');
 assert.ok(!html.includes('onclick="applyAiQuote()"'),'bind outside inline form scope');
 const source=html.slice(html.indexOf('function withTruckFee('),html.indexOf('function quickEstimator()'));
 const controls={'#applyAiQuoteButton':{},'#aiSelectedTotal':{},'#estimateItems':{},'#aiAppliedStatus':{}};
 let chosen=[{value:'0'},{value:'1'}],rows=[],saved=0,total=0;
 const context=vm.createContext({$:s=>controls[s],document:{querySelectorAll:()=>chosen,querySelector:()=>chosen[0]},money:n=>String(n),addEstimateItem:(...args)=>rows.push(args),calcEstimateTotal:()=>{total=rows.reduce((n,r)=>n+r[1]*r[2],0);},persistQuoteDraft:()=>saved++});
 vm.runInContext(source+"aiQuoteSuggestions=[{description:'Labor',quantity:2,unit_price:125},{description:'Misc fittings',quantity:1,unit_price:50}];"+html.match(/if\(aiQuoteSuggestions.length\)\{\$\('#applyAiQuoteButton'\).*?\}/)[0],context);
 assert.equal(controls['#aiSelectedTotal'].textContent,'300');
 controls['#applyAiQuoteButton'].onclick();assert.equal(total,375);assert.equal(saved,1);
 rows=[];chosen=[{value:'1'}];vm.runInContext('updateAiSelection()',context);controls['#applyAiQuoteButton'].onclick();assert.deepEqual(rows,[['Misc fittings',1,50],['Truck fee',1,75]]);assert.equal(total,125);
 rows=[];vm.runInContext("aiQuoteSuggestions.push({description:'Truck fee',quantity:1,unit_price:75});",context);chosen=[{value:'1'},{value:'2'}];controls['#applyAiQuoteButton'].onclick();assert.equal(total,125);assert.equal(rows.filter(r=>r[0]==='Truck fee').length,1);
 chosen=[];vm.runInContext('updateAiSelection()',context);assert.equal(controls['#applyAiQuoteButton'].disabled,true);assert.equal(controls['#aiSelectedTotal'].textContent,'0');
});
