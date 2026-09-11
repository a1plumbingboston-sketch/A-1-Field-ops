import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ctx={Date};vm.createContext(ctx);vm.runInContext(html.split('\n').filter(l=>/^function (weekStart|weekBuckets|jobDate)\(/.test(l)).join('\n'),ctx);
test('week schedule starts Monday, handles Sunday and year boundaries',()=>{
 const d=ctx.weekStart(0,new Date(2026,0,4,15));assert.equal(d.getDay(),1);assert.equal(d.getFullYear(),2025);assert.equal(d.getMonth(),11);assert.equal(d.getDate(),29);
 assert.equal(ctx.weekStart(1,new Date(2026,0,4)).getDate(),5);
});
test('week schedule uses local date boundaries, sorts appointments and excludes archived/cancelled work',()=>{
 const start=ctx.weekStart(0,new Date(2026,8,14));const jobs=[{id:'late',scheduled_at:new Date(2026,8,14,17).toISOString()},{id:'early',scheduled_at:new Date(2026,8,14,8).toISOString()},{id:'next',scheduled_at:new Date(2026,8,21).toISOString()},{id:'archived',archived_at:'yes',scheduled_at:start.toISOString()},{id:'cancelled',status:'cancelled',scheduled_at:start.toISOString()},{id:'none'}];
 const days=ctx.weekBuckets(jobs,start);assert.equal(days.length,7);assert.deepEqual(Array.from(days[0].jobs,j=>j.id),['early','late']);assert.equal(days.reduce((n,d)=>n+d.jobs.length,0),2);
});
