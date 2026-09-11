import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const ctx={Date};vm.createContext(ctx);vm.runInContext(html.split('\n').filter(l=>l.startsWith('function followUpRows(')).join('\n'),ctx);
test('follow-ups exclude approved quotes and settled invoices, account for refunds/credits and prioritize past due',()=>{
 const invoices=[{id:'partial',status:'partial',total:200,credit_amount:25,created_at:'2026-09-01',due_at:'2026-09-05'},{id:'paid',status:'paid',total:100},{id:'void',status:'void',total:500},{id:'draft',status:'draft',total:500}];
 const payments=[{invoice_id:'partial',amount:100,status:'succeeded'},{invoice_id:'partial',amount:-20,status:'succeeded'},{invoice_id:'partial',amount:50,status:'failed'},{invoice_id:'paid',amount:100,status:'succeeded'}];
 const rows=ctx.followUpRows([{id:'sent',status:'sent',total:50,created_at:'2026-08-01'},{id:'approved',status:'approved',total:50}],invoices,payments,Date.parse('2026-09-11'));
 assert.equal(rows.length,2);assert.equal(rows[0].doc.id,'partial');assert.equal(rows[0].amount,95);assert.equal(rows[0].overdue,true);assert.equal(rows[1].doc.id,'sent');
});
