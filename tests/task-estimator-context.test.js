import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../task-estimator.js',import.meta.url),'utf8');
function harness({stored=null,fetcher}={}){
 const nodes=new Map(),storage=new Map(stored?[['a1_construction_estimator_v1',JSON.stringify(stored)]]:[]),events=[],applied=[];
 const make=()=>({hidden:true,innerHTML:'',textContent:'',disabled:false,checked:false,listeners:{},before(){},after(){},focus(){},scrollIntoView(){},addEventListener(type,fn){this.listeners[type]=fn;}});
 const node=s=>{if(!nodes.has(s))nodes.set(s,make());return nodes.get(s);};
 const fields=['project','location','scope','conditions','exclusions','total'].map(name=>({name,value:'',disabled:false}));
 const form=node('#taskEstimatorForm');form.elements=fields;form.reset=()=>fields.forEach(f=>f.value='');let id='estimate-A';
 const document={querySelector:node,createElement:make,dispatchEvent:e=>events.push(e.type)};
 const window={A1RemodelBridge:{key:()=> 'local-fixture',contextId:()=>id,apply:async proposal=>{applied.push(proposal);return true;}}};
 const fetch=fetcher||(async()=>({ok:true,json:async()=>({items:[{description:'Plumbing project',quantity:1,unit_price:2500}],reasoning:'Synthetic allocation'})}));
 vm.runInNewContext(source,{window,document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},Event:class{constructor(type){this.type=type;}},AbortController,confirm:()=>true,fetch,console});
 return {api:window.A1TaskEstimator,form,node,events,storage,applied,setContext:v=>{id=v;},submit:()=>form.onsubmit({preventDefault(){}})};
}
const input=()=>({project:'Bathroom project',location:'Second floor',scope:'Install plumbing for the shower, toilet and vanity.',conditions:'Occupied home',exclusions:'Tile by others',total:'2500.00'});
const plain=v=>JSON.parse(JSON.stringify(v));
test('quote-specific intake restores complete walkthrough and captures disabled controls',()=>{
 const h=harness({stored:{...input(),project:'Unrelated old draft'}});h.api.restore(input());h.form.elements.forEach(el=>el.disabled=true);assert.deepEqual(plain(h.api.capture()),input());assert.deepEqual(h.events,[]);h.api.restore({project:'Partial',total:0,conditions:null});assert.equal(h.api.capture().project,'Partial');assert.equal(h.api.capture().total,'0');assert.equal(h.api.capture().scope,'');assert.equal(h.api.capture().conditions,'');h.api.reset();assert.equal(h.storage.has('a1_construction_estimator_v1'),false);
});
test('user edits update recovery and notify parent while programmatic restore stays silent',()=>{
 const h=harness();h.api.restore(input());assert.equal(h.events.length,0);h.form.listeners.input();assert.deepEqual(h.events,['fieldops:construction-change']);assert.deepEqual(JSON.parse(h.storage.get('a1_construction_estimator_v1')),input());
});
test('quote change rejects late AI allocation even if inputs are identical',async()=>{
 let resolve;const h=harness({fetcher:()=>new Promise(r=>{resolve=r;})});h.api.restore(input());const request=h.submit();h.setContext('estimate-B');resolve({ok:true,json:async()=>({items:[{description:'Old quote line',quantity:1,unit_price:2500}]})});await request;assert.equal(h.node('#taskResult').innerHTML,'');assert.match(h.node('#taskStatus').textContent,/estimate changed/);assert.equal(h.node('#buildTaskEstimate').disabled,false);
});
test('restoring another quote aborts pending allocation and stale result cannot overwrite it',async()=>{
 let resolve,signal;const h=harness({fetcher:(_,o)=>{signal=o.signal;return new Promise(r=>{resolve=r;});}});h.api.restore(input());const request=h.submit();h.api.restore({...input(),project:'Second quote'});assert.equal(signal.aborted,true);resolve({ok:true,json:async()=>({items:[{description:'Old quote line',quantity:1,unit_price:2500}]})});await request;assert.equal(h.api.capture().project,'Second quote');assert.equal(h.node('#taskResult').innerHTML,'');assert.equal(h.node('#taskStatus').textContent,'');
});
test('reviewed allocation retains owner total and sends full raw intake to the parent',async()=>{
 const h=harness();h.api.restore(input());await h.submit();h.node('#reviewTaskEstimate').checked=true;await h.node('#applyTaskEstimate').onclick();assert.equal(h.applied.length,1);assert.equal(h.applied[0].profile,'construction');assert.deepEqual(plain(h.applied[0].intake),input());assert.equal(h.applied[0].items.reduce((s,i)=>s+i.quantity*i.unit_price,0),2500);
});
test('reviewed allocation cannot be applied to a different selected quote',async()=>{
 const h=harness();h.api.restore(input());await h.submit();h.node('#reviewTaskEstimate').checked=true;h.setContext('estimate-B');await h.node('#applyTaskEstimate').onclick();assert.equal(h.applied.length,0);assert.equal(h.node('#taskResult').innerHTML,'');assert.match(h.node('#taskStatus').textContent,/estimate changed/);
});
test('incorrect allocation total is rejected and cannot be applied',async()=>{
 const h=harness({fetcher:async()=>({ok:true,json:async()=>({items:[{description:'Wrong total',quantity:1,unit_price:2600}]})})});h.api.restore(input());await h.submit();assert.equal(h.node('#taskResult').innerHTML,'');assert.match(h.node('#taskStatus').textContent,/did not match/);assert.equal(h.applied.length,0);
});


test('combined walkthrough above the API limit is not silently truncated or sent',async()=>{
 let calls=0;const h=harness({fetcher:async()=>{calls++;throw Error('Must not send oversized intake');}});
 const oversized={...input(),scope:'S'.repeat(16000),conditions:'C'.repeat(2400),exclusions:'E'.repeat(2400)};
 h.api.restore(oversized);await h.submit();assert.equal(calls,0);assert.match(h.node('#taskStatus').textContent,/combined 20,000 characters/);assert.deepEqual(plain(h.api.capture()),oversized);assert.equal(h.node('#taskResult').innerHTML,'');assert.equal(h.node('#buildTaskEstimate').disabled,false);
});
