import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../customer-messaging.js',import.meta.url),'utf8');
const PHONE='+16175550100',OTHER='+16175550101';
const setup={inbound_ready:true,outbound_ready:true,business_number:'+13395550123',disabled_reason:''};
const thread=(phone=PHONE)=>({...setup,phone,customer:{id:'fixture-customer',name:'Sample Client'},messages:[{id:'SM-incoming',sid:'SM-incoming',direction:'inbound',body:'Can you look at the kitchen leak?',at:'2026-09-19T12:00:00Z',status:'received',media_count:0}],latest_inbound_sid:'SM-incoming',reply_to_sid:'SM-incoming',can_reply:true,blocked:false,next_cursor:null});
const pause=()=>new Promise(setImmediate);
function harness({handler,storage=new Map([['a1_fieldops_key','fixture-owner-key']])}={}){
  const nodes=[],requests=[],intervals=new Map(),urls=[],revoked=[];let serial=0;
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.style={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this._text='';this.className='';this.scrollHeight=500;this.scrollTop=0;this.classList={toggle:(c,on)=>{const classes=new Set(this.className.split(' ').filter(Boolean));on?classes.add(c):classes.delete(c);this.className=[...classes].join(' ');}};nodes.push(this);}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;this._text='';}
    set textContent(value){this._text=String(value);this.children=[];}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    setAttribute(k,v){this.attributes[k]=String(v);}
    getAttribute(k){return this.attributes[k];}
  }
  const main=new Element('main');const document={visibilityState:'visible',createElement:tag=>new Element(tag),getElementById:id=>nodes.find(n=>n.id===id)||null,querySelector:selector=>selector==='#app main'?main:null};
  const window={addEventListener(){},openCustomerHistory:id=>requests.push({history:id})};
  const defaultHandler=payload=>payload.operation==='list'?{...setup,threads:[{phone:PHONE,customer:{id:'fixture-customer',name:'Sample Client'},preview:'Kitchen leak',last_at:'2026-09-19T12:00:00Z',unread_count:1}],next_cursor:null}:payload.operation==='thread'?thread(payload.phone):payload.operation==='mark-read'?{saved:true}:payload.operation==='send'?{message:{id:payload.request_id,request_id:payload.request_id,direction:'outbound',status:'queued',body:payload.body},duplicate:false,unconfirmed:false}:setup;
  const ctx=vm.createContext({window,document,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=>`fixture-request-${++serial}`},URL:{createObjectURL:()=>{const url='blob:fixture-'+urls.length;urls.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},AbortController,Date,console,setTimeout,clearTimeout,setInterval:fn=>{const id=++serial;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),fetch:async(url,options)=>{assert.equal(url,'/api/documents');assert.equal(options.method,'POST');assert.equal(options.headers['x-fieldops-key'],'fixture-owner-key');const payload=JSON.parse(options.body);assert.equal(payload.action,'customer-messaging');requests.push(payload);const response=handler?await handler(payload,defaultHandler):defaultHandler(payload);return {ok:!response?.httpError,status:response?.httpError||200,json:async()=>response,headers:{get:name=>name==='content-type'?response?.media?.type:name==='content-length'?String(response?.media?.size||0):null},blob:async()=>({size:response?.media?.size||200})};}});
  vm.runInContext(source,ctx);
  const $=id=>document.getElementById(id),open=()=>window.A1CustomerMessaging.open();
  const select=async(phone=PHONE)=>{const item=$('cmConversations').children.find(n=>n.tagName==='button'&&(n.textContent.includes(phone)||n.textContent.includes(phone===PHONE?'(617) 555-0100':'(617) 555-0101')));assert.ok(item,'Conversation button exists');return item.onclick();};
  const type=(body='We can help with the leak.')=>{$('cmReply').value=body;$('cmReply').oninput();$('cmConsent').checked=true;$('cmConsent').onchange();};
  return {$,open,select,type,submit:()=>$('cmReplyForm').onsubmit({preventDefault(){}}),requests,nodes,storage,urls,revoked,api:window.A1CustomerMessaging,intervals,main};
}

test('inbox reads without sending and explains registration-disabled replies',async()=>{
  const h=harness({handler:(p,next)=>({...next(p),outbound_ready:false,disabled_reason:'Business texting registration is pending.'})});await h.open();await h.select();
  assert.match(h.$('cmSetup').textContent,/registration is pending/);assert.match(h.$('cmLog').textContent,/kitchen leak/);assert.equal(h.$('cmReply').disabled,true);assert.equal(h.$('cmSend').disabled,true);assert.equal(h.requests.filter(r=>r.operation==='send').length,0);assert.equal(h.requests.find(r=>r.operation==='mark-read').through_sid,'SM-incoming');
});
test('unmatched numbers, customer text and attachment counts use safe visible text',async()=>{
  const malicious='<img src=x onerror=alert(1)>';const h=harness({handler:(p,next)=>p.operation==='thread'?{...thread(),customer:null,messages:[{...thread().messages[0],body:malicious,media_count:2}]}:next(p)});await h.open();await h.select();
  assert.match(h.$('cmNumber').textContent,/Unmatched number/);assert.equal(h.$('cmHistory').hidden,true);assert.match(h.$('cmLog').textContent,/2 attachments received/);assert.ok(h.$('cmLog').textContent.includes(malicious));assert.equal(h.nodes.some(n=>n.tagName==='img'),false);
});
test('explicit confirmed reply sends once while pending and clears only the sent draft',async()=>{
  let release;const h=harness({handler:async(p,next)=>{if(p.operation==='send')await new Promise(r=>{release=r;});return next(p);}});await h.open();await h.select();h.type();
  const send=h.submit();await pause();assert.equal(h.$('cmSend').disabled,true);assert.equal(h.$('cmReply').disabled,true);await h.submit();assert.equal(h.requests.filter(r=>r.operation==='send').length,1);release();await send;
  const payload=h.requests.find(r=>r.operation==='send');assert.equal(payload.phone,PHONE);assert.equal(payload.reply_to_sid,'SM-incoming');assert.equal(payload.consent_confirmed,true);assert.equal(h.$('cmReply').value,'');assert.equal(h.$('cmConsent').checked,false);assert.equal(h.$('cmPending').hidden,true);
});
test('a lost send response retains the request and explicit retry reuses its UUID',async()=>{
  let sends=0;const h=harness({handler:(p,next)=>{if(p.operation==='send'&&++sends===1)throw Error('Network lost');return next(p);}});await h.open();await h.select();h.type('A specific reply');await h.submit();
  assert.equal(h.$('cmPending').hidden,false);assert.equal(h.$('cmReply').disabled,true);assert.equal(h.$('cmReply').value,'A specific reply');assert.match(h.$('cmSendStatus').textContent,/could not be confirmed/);await h.$('cmRetry').onclick();
  const attempts=h.requests.filter(r=>r.operation==='send');assert.equal(attempts.length,2);assert.deepEqual(attempts[1],attempts[0]);assert.equal(h.$('cmPending').hidden,true);assert.equal(h.$('cmReply').value,'');
});
test('refresh resolves a pending request from its journal ID without sending again',async()=>{
  let existing=null;const h=harness({handler:(p,next)=>{if(p.operation==='send'){existing={id:p.request_id,request_id:p.request_id,direction:'outbound',body:p.body,status:'delivered',at:'2026-09-19T12:02:00Z'};throw Error('Response lost');}if(p.operation==='thread'&&existing)return {...thread(),messages:[...thread().messages,existing]};return next(p);}});await h.open();await h.select();h.type();await h.submit();await h.$('cmRefresh').onclick();
  assert.equal(h.requests.filter(r=>r.operation==='send').length,1);assert.equal(h.$('cmPending').hidden,true);assert.equal(h.$('cmReply').value,'');assert.match(h.$('cmLog').textContent,/Delivered/);
});
test('unconfirmed reply survives reload and never automatically retries',async()=>{
  const h=harness({handler:(p,next)=>p.operation==='send'?{message:{id:p.request_id,status:'unconfirmed'},unconfirmed:true}:next(p)});await h.open();await h.select();h.type('Preserve this reply');await h.submit();
  const next=harness({storage:h.storage});await next.open();await next.select();assert.equal(next.$('cmReply').value,'Preserve this reply');assert.equal(next.$('cmPending').hidden,false);assert.equal(next.requests.filter(r=>r.operation==='send').length,0);
});
test('drafts follow their customer and stale thread results cannot replace the selected conversation',async()=>{
  let release,blocking=false;const h=harness({handler:async(p,next)=>{if(p.operation==='list')return {...next(p),threads:[...next(p).threads,{phone:OTHER,customer:{id:'customer-two',name:'Other Client'},preview:'Second inquiry'}]};if(p.operation==='thread'&&p.phone===PHONE&&blocking)await new Promise(r=>{release=r;});return p.operation==='thread'&&p.phone===OTHER?{...thread(OTHER),customer:{id:'customer-two',name:'Other Client'},messages:[{...thread().messages[0],body:'Second inquiry'}]}:next(p);}});
  await h.open();await h.select();h.type('First client draft');await h.select(OTHER);assert.equal(h.$('cmReply').value,'');h.type('Second client draft');blocking=true;const old=h.select(PHONE);await pause();await h.select(OTHER);release();await old;
  assert.equal(h.$('cmName').textContent,'Other Client');assert.equal(h.$('cmReply').value,'Second client draft');assert.match(h.$('cmLog').textContent,/Second inquiry/);assert.equal(h.requests.filter(r=>r.operation==='send').length,0);
});
test('opted-out and inquiry-free conversations cannot send even with filled controls',async()=>{
  for(const extra of [{blocked:true},{can_reply:false}]){const h=harness({handler:(p,next)=>p.operation==='thread'?{...thread(),...extra}:next(p)});await h.open();await h.select();h.type();await h.submit();assert.equal(h.$('cmSend').disabled,true);assert.equal(h.requests.filter(r=>r.operation==='send').length,0);}
});
test('definitive setup rejection keeps the reply editable but requires fresh confirmation',async()=>{
  const h=harness({handler:(p,next)=>p.operation==='send'?{httpError:503,code:'SETUP_PENDING',error:'Registration is still pending.'}:next(p)});await h.open();await h.select();h.type('Keep my typed reply');await h.submit();assert.equal(h.$('cmPending').hidden,true);assert.equal(h.$('cmReply').value,'Keep my typed reply');assert.equal(h.$('cmConsent').checked,false);assert.match(h.$('cmSendStatus').textContent,/Registration/);
});
test('logout clears private thread content and ignores an in-flight response',async()=>{
  let release;const h=harness({handler:async(p,next)=>{if(p.operation==='thread')await new Promise(r=>{release=r;});return next(p);}});await h.open();const loading=h.select();await pause();h.storage.delete('a1_fieldops_key');h.api.clear();release();await loading;assert.equal(h.$('cmLog').textContent,'');assert.equal(h.$('cmConversations').textContent,'');assert.equal(h.$('cmThread').hidden,true);assert.equal(h.intervals.size,0);
});
test('polling refreshes only while the inbox is active and never sends',async()=>{
  const h=harness();await h.open();await h.select();h.type();assert.equal(h.intervals.size,1);await [...h.intervals.values()][0]();await pause();assert.equal(h.requests.filter(r=>r.operation==='send').length,0);h.api.leave();assert.equal(h.intervals.size,0);assert.equal(h.$('cmReply').value,'We can help with the leak.');
});
test('fresh source has clear entry point, lock cleanup and labeled reply controls',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/id="navMessages">Messages/);assert.match(html,/customer-messaging\.js/);assert.match(html,/if\(!isSignedIn\)window\.A1CustomerMessaging\?\.clear\(\)/);assert.match(html,/messages:'#customerMessagesView'/);assert.equal(source.includes('innerHTML'),false);
  const h=harness();assert.equal(h.$('cmReply').maxLength,1600);assert.equal(h.$('cmReply').getAttribute('aria-describedby'),'cmReplyHelp cmCount');assert.equal(h.$('cmSendStatus').getAttribute('role'),'status');
});


test('photos are fetched with owner authentication, shown as blobs, and revoked on logout',async()=>{
 const h=harness({handler:(p,next)=>p.operation==='media'?{media:{type:'image/jpeg',size:400}}:p.operation==='thread'?{...thread(),messages:[{...thread().messages[0],media_count:1}]}:next(p)});await h.open();await h.select();const photo=h.nodes.find(n=>n.tagName==='button'&&n.textContent==='View attachment 1');await photo.onclick();
 const call=h.requests.find(r=>r.operation==='media');assert.equal(call.sid,'SM-incoming');assert.equal(call.index,0);assert.equal(h.nodes.find(n=>n.tagName==='img').src,'blob:fixture-0');h.api.clear();assert.deepEqual(h.revoked,['blob:fixture-0']);
});

test('unsupported or oversized media is never made into a browser URL',async()=>{
 for(const media of [{type:'image/svg+xml',size:200},{type:'image/png',size:4*1024*1024+1}]){const h=harness({handler:(p,next)=>p.operation==='media'?{media}:p.operation==='thread'?{...thread(),messages:[{...thread().messages[0],media_count:1}]}:next(p)});await h.open();await h.select();await h.nodes.find(n=>n.tagName==='button'&&n.textContent==='View attachment 1').onclick();assert.equal(h.urls.length,0);assert.match(h.$('cmLog').textContent,/not a supported photo|too large/);}
});

test('a photo finishing after signout cannot create a private blob URL',async()=>{
 let release;const h=harness({handler:async(p,next)=>{if(p.operation==='media'){await new Promise(r=>{release=r;});return {media:{type:'image/jpeg',size:200}};}return p.operation==='thread'?{...thread(),messages:[{...thread().messages[0],media_count:1}]}:next(p);}});await h.open();await h.select();const loading=h.nodes.find(n=>n.tagName==='button'&&n.textContent==='View attachment 1').onclick();await pause();h.storage.delete('a1_fieldops_key');h.api.clear();release();await loading;assert.equal(h.urls.length,0);
});
