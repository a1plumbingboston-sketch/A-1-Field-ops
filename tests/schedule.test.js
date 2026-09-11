import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('Google appointment draft targets the shared calendar and safely encodes job details',()=>{
 const ctx={URLSearchParams};vm.createContext(ctx);vm.runInContext(html.split('\n').find(l=>l.startsWith('function googleJobUrl(')),ctx);
 const u=new URL(ctx.googleJobUrl({id:'job-123',title:'Fix A&B #1',address:'123 Main St, Boston'}));assert.equal(u.hostname,'calendar.google.com');assert.equal(u.searchParams.get('action'),'TEMPLATE');assert.match(u.searchParams.get('src'),/@group.calendar.google.com$/);assert.equal(u.searchParams.get('text'),'A-1 · Fix A&B #1');assert.match(u.searchParams.get('details'),/job-123/);assert.equal(u.searchParams.has('dates'),false);
 assert.equal(html.includes('type="datetime-local"'),false);assert.equal(html.includes('id="weekJobs"'),false);
});
