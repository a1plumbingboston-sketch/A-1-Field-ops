import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function refreshMoneyToday(){'),source.indexOf('function logAiUsage'));
async function render(results){
 const elements={'#moneyGrid':{},'#moneyNext':{}};
 const context=vm.createContext({cache:[],money:n=>`$${n}`, $:id=>elements[id],sb:{from:table=>({select:()=>({order:()=>({limit:async()=>results[table]})})})}});
 await vm.runInContext(code+';refreshMoneyToday()',context);
 return elements;
}
test('money dashboard excludes converted estimates and fully credited invoices',async()=>{
 const el=await render({estimates:{data:[{status:'converted',total:2500},{status:'draft',total:300}]},invoices:{data:[{status:'sent',total:100,credit_amount:100},{status:'partial',total:500,amount_paid:100,credit_amount:50}]}});
 assert.match(el['#moneyGrid'].innerHTML,/\$300/);
 assert.match(el['#moneyGrid'].innerHTML,/\$350/);
 assert.match(el['#moneyNext'].textContent,/1 invoice to collect/);
 assert.doesNotMatch(el['#moneyGrid'].innerHTML,/2500/);
});
test('failed totals query reports unavailable instead of showing false zero balances',async()=>{
 const el=await render({estimates:{data:[]},invoices:{error:{message:'offline'}}});
 assert.match(el['#moneyGrid'].innerHTML,/could not refresh/);
 assert.equal(el['#moneyNext'].textContent,'Current totals are unavailable.');
});
