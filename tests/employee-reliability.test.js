import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../employee.js',import.meta.url),'utf8');
function harness(fetch,timers={}){
 const nodes=new Map();const context=vm.createContext({URLSearchParams,location:{search:''},document:{querySelector:s=>{if(!nodes.has(s))nodes.set(s,{textContent:''});return nodes.get(s);}},Intl,Date,AbortController,setTimeout,clearTimeout,fetch,...timers});
 vm.runInContext(source.slice(0,source.indexOf('function range()')),context);return {context,nodes};
}
test('technician timeout releases busy state and warns of an uncertain save',async()=>{
 const h=harness(async(_url,options)=>{assert.ok(options.signal);const e=new Error('aborted');e.name='AbortError';throw e;});
 await vm.runInContext("run(()=>request('message',{text:'Test'}))",h.context);
 assert.match(h.nodes.get('#notice').textContent,/may have saved/);assert.equal(vm.runInContext('busy',h.context),false);
});
test('successful job save retains notification warning after refresh and success text',async()=>{
 let calls=0;const h=harness(async()=>({ok:true,json:async()=>++calls===1?{notification_warning:'Saved, but device notifications were not confirmed.'}:{}}));
 await vm.runInContext("run(async()=>{await request('status');await request('detail');say('Saved');})",h.context);
 assert.match(h.nodes.get('#notice').textContent,/notifications were not confirmed/);
});
