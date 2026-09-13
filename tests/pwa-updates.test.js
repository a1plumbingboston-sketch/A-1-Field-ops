import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const code=await readFile(new URL('../app-updates.js',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function page({offline=false,storageDenied=false,url='https://app.test/?release=old'}={}){
 let now=100000,release='1-initial',calls=0,bodyResolve;const events={},intervals=[],nodes=[],replaced=[],messages=[];let blockers=[];
 const element=()=>({isConnected:true,textContent:'',style:{},hidden:false,append(){},setAttribute(){},getClientRects(){return [{}];},matches(){return false;},closest(){return null;}});
 const document={visibilityState:'visible',activeElement:null,querySelector:()=>({content:'1-initial'}),querySelectorAll:()=>blockers,createElement:()=>{const el=element();nodes.push(el);return el;},body:{append(){}},addEventListener:(name,fn)=>(events[name]??=[]).push(fn)};
 const registration={waiting:null,update:async()=>{},addEventListener(){}};
 const memory=new Map();const window={fetch:async input=>{calls++;if(input==='/release.json')return Response.json({id:release});const response=new Response('{}');response.json=()=>new Promise(r=>bodyResolve=r);return response;},addEventListener:(name,fn)=>(events[name]??=[]).push(fn)};
 const navigator={onLine:!offline,serviceWorker:{register:async(url,options)=>{assert.equal(options.updateViaCache,'none');return registration;},addEventListener(){}}};
 const context={window,document,navigator,URL,Response,AbortSignal,Date:{now:()=>now},setInterval:fn=>intervals.push(fn),confirm:()=>true,sessionStorage:{getItem:k=>{if(storageDenied)throw Error('blocked');return memory.get(k);},setItem:(k,v)=>{if(storageDenied)throw Error('blocked');memory.set(k,v);},removeItem:k=>memory.delete(k)},location:{href:url,replace:next=>replaced.push(next)}};
 vm.runInNewContext(code,context);
 return {document,navigator,registration,nodes,replaced,messages,window,memory,element,settle,
 setRelease:v=>release=v,tick:n=>now+=n,block:els=>blockers=els,
 emit:async(type,target)=>{for(const fn of events[type]||[])fn({target});await settle();},
 idle:async()=>{intervals[1]();await settle();},calls:()=>calls,resolveBody:()=>bodyResolve({ok:true})};
}
test('foreground release check reloads an idle app and preserves its destination',async()=>{
 const p=page({url:'https://app.test/employee?owner=1&release=old#today'});await p.settle();assert.equal(p.replaced.length,0);
 p.tick(16000);p.setRelease('2-new');await p.emit('focus');await p.idle();assert.equal(p.replaced.length,1);
 const u=new URL(p.replaced[0]);assert.equal(u.pathname,'/employee');assert.equal(u.searchParams.get('owner'),'1');assert.equal(u.searchParams.has('release'),false);assert.equal(u.searchParams.get('app-build'),'2-new');assert.equal(u.hash,'#today');
});
test('unsaved work, open forms, and response-body processing defer automatic updates',async()=>{
 const p=page();await p.settle();const edit=p.element();edit.matches=()=>true;edit.type='text';await p.emit('input',edit);
 p.tick(16000);p.setRelease('2-new');await p.emit('focus');await p.idle();assert.equal(p.replaced.length,0);assert.match(p.nodes[1].textContent,/Save your work/);
 const form={contains:el=>el===edit};await p.emit('reset',form);p.block([p.element()]);await p.idle();assert.equal(p.replaced.length,0);
 p.block([]);const response=await p.window.fetch('/api/save');const body=response.json();p.tick(10000);await p.idle();assert.equal(p.replaced.length,0);
 p.resolveBody();await body;p.tick(6000);await p.idle();assert.equal(p.replaced.length,1);
});
test('offline checks stay quiet and a returning connection discovers the new release',async()=>{
 const p=page({offline:true});await p.settle();assert.equal(p.calls(),0);p.setRelease('2-new');p.tick(16000);p.navigator.onLine=true;await p.emit('online');await p.idle();assert.equal(p.replaced.length,1);
});
test('denied storage cannot break the app and a mismatched reload cannot loop',async()=>{
 const p=page({storageDenied:true,url:'https://app.test/?app-build=2-new'});await p.settle();p.tick(16000);p.setRelease('2-new');await p.emit('focus');await p.idle();assert.equal(p.replaced.length,0);assert.match(p.nodes[1].textContent,/still arriving/);
});
test('each deployment stamps pages and offline assets, including releases without a version bump',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'a1-release-'));const build=new URL('../scripts/build-release.mjs',import.meta.url);const env={...process.env};delete env.VERCEL_GIT_COMMIT_SHA;
 try{
  for(const name of ['index.html','employee.html'])await writeFile(path.join(dir,name),'<meta name="fieldops-release" content="1.0"><script src="/app.js?v=old"></script><script src="https://cdn.test/external.js"></script>');
  for(const name of ['app.js','dependency.js','manifest.webmanifest','employee.webmanifest','a1-logo.png'])await writeFile(path.join(dir,name),'fixture');
  await writeFile(path.join(dir,'package.json'),'{"version":"1.0"}');await writeFile(path.join(dir,'service-worker.js'),"const CACHE='old';\nconst ASSETS=[];\n");
  const run=()=>execFileSync(process.execPath,[build.pathname],{cwd:dir,env});run();const first=JSON.parse(await readFile(path.join(dir,'release.json'),'utf8'));
  run();assert.equal(JSON.parse(await readFile(path.join(dir,'release.json'),'utf8')).id,first.id);
  assert.match(await readFile(path.join(dir,'index.html'),'utf8'),new RegExp(first.id));assert.match(await readFile(path.join(dir,'service-worker.js'),'utf8'),/dependency.js/);
  await writeFile(path.join(dir,'dependency.js'),'changed');run();assert.notEqual(JSON.parse(await readFile(path.join(dir,'release.json'),'utf8')).id,first.id);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('offline navigation uses the correct app shell; payment and API requests never enter the cache',async()=>{
 const events={};let activated=0,claimed=0;const cache={match:async x=>typeof x==='string'?new Response(x):undefined,addAll:async()=>{}};
 vm.runInNewContext(await readFile(new URL('../service-worker.js',import.meta.url),'utf8'),{URL,Response,self:{location:{origin:'https://app.test'},addEventListener:(n,fn)=>events[n]=fn,skipWaiting:async()=>activated++,clients:{claim:async()=>claimed++}},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>{}},fetch:async()=>{throw Error('offline');}});
 for(const url of ['/api/documents','/customer-sign?token=private','/pay','/release.json']){let intercepted=false;events.fetch({request:{url:'https://app.test'+url,method:'GET',mode:'navigate'},respondWith(){intercepted=true;}});assert.equal(intercepted,false);}
 let response;events.fetch({request:{url:'https://app.test/employee?owner=1',method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.equal(await (await response).text(),'/employee.html');
 let work;events.message({data:{type:'ACTIVATE_UPDATE'},waitUntil:p=>work=p});await work;assert.equal(activated,1);events.activate({waitUntil:p=>work=p});await work;assert.equal(claimed,1);
});

test('app entry pages keep update code out of inline document templates',async()=>{
 for(const name of ['index.html','employee.html']){
  const html=await readFile(new URL('../'+name,import.meta.url),'utf8');
  assert.equal((html.match(/name="fieldops-release"/g)||[]).length,1);
  assert.equal((html.match(/src="\/app-updates\.js/g)||[]).length,1);
  for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc=|type="(?:module|application\/ld\+json)"/.test(script[1]))continue;
   assert.doesNotThrow(()=>new vm.Script(script[2]),name+' has valid inline JavaScript');
  }
 }
});
