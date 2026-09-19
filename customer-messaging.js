// Owner inbox. Opening or refreshing it never sends customer messages.
(() => {
  const $ = id => document.getElementById(id);
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const button = (text, fn, className) => { const el=node('button',text,className);el.type='button';el.onclick=fn;return el; };
  const storageKey='a1_customer_message_pending_v1';
  const drafts=new Map(), pending=new Map(),mediaCache=new Map();let mediaEpoch=0;
  let threads=[],listCursor=null,phone='',detail=null,setup={},listGeneration=0,threadGeneration=0,sessionGeneration=0,sending=false,timer=null;
  let threadCursor=null,messages=[],active=false;
  const root=node('section',undefined,'cm-workspace');root.id='customerMessagesView';root.style.display='none';
  root.setAttribute('aria-label','Customer messages');
  const top=node('div',undefined,'cm-top');const heading=node('div');heading.append(node('p','CUSTOMER CONVERSATIONS','eyebrow'),node('h2','A clearer conversation.'),node('p','Keep service requests and replies together. Every text is sent by you.','meta'));
  const refresh=button('Refresh inbox',()=>refreshInbox());refresh.id='cmRefresh';top.append(heading,refresh);
  const setupBox=node('div',undefined,'cm-setup');setupBox.id='cmSetup';setupBox.setAttribute('role','status');
  const notice=node('p','','cm-notice');notice.id='cmNotice';notice.setAttribute('role','status');
  const layout=node('div',undefined,'cm-layout');
  const sidebar=node('aside',undefined,'cm-sidebar');sidebar.setAttribute('aria-label','Conversations');
  const searchLabel=node('label','Find a conversation','cm-label');const search=node('input');search.id='cmSearch';search.type='search';search.placeholder='Customer name or phone';searchLabel.append(search);
  const list=node('div',undefined,'cm-conversations');list.id='cmConversations';
  const listMore=button('Load more conversations',()=>loadList(true),'cm-more');listMore.id='cmListMore';listMore.hidden=true;
  sidebar.append(searchLabel,list,listMore);
  const conversation=node('section',undefined,'cm-conversation');conversation.setAttribute('aria-label','Selected conversation');
  const empty=node('div',undefined,'cm-empty');empty.id='cmEmpty';empty.append(node('h3','Your customer conversations, in one place.'),node('p','Choose a conversation to read their message and write a reply.','meta'));
  const threadView=node('div',undefined,'cm-thread');threadView.id='cmThread';threadView.hidden=true;
  const threadHeader=node('div',undefined,'cm-thread-header');const identity=node('div');const name=node('h3');name.id='cmName';const number=node('p','','meta');number.id='cmNumber';identity.append(name,number);
  const history=button('Customer history',()=>{if(detail?.customer?.id)window.openCustomerHistory?.(detail.customer.id);});history.id='cmHistory';history.hidden=true;threadHeader.append(identity,history);
  const reason=node('p','','cm-reply-reason');reason.id='cmReplyReason';reason.setAttribute('role','status');
  const older=button('Earlier messages',()=>loadThread(phone,{older:true}),'cm-more');older.id='cmOlder';older.hidden=true;
  const log=node('div',undefined,'cm-log');log.id='cmLog';log.setAttribute('role','log');log.setAttribute('aria-label','Message history');log.setAttribute('aria-live','polite');
  const form=node('form',undefined,'cm-compose');form.id='cmReplyForm';
  const replyLabel=node('label','Your reply','cm-label');const reply=node('textarea');reply.id='cmReply';reply.rows=4;reply.maxLength=1600;reply.placeholder='Write a clear, helpful reply about their service request.';reply.setAttribute('aria-describedby','cmReplyHelp cmCount');replyLabel.append(reply);
  const help=node('p','Replies go from your business number. Attachments cannot be sent here yet. ','meta');help.id='cmReplyHelp';const terms=node('a','Texting terms & privacy');terms.href='/texting.html';terms.target='_blank';terms.rel='noopener';help.append(terms);
  const confirmLabel=node('label',undefined,'cm-consent');const consent=node('input');consent.type='checkbox';consent.id='cmConsent';confirmLabel.append(consent,node('span',"This reply addresses the customer’s service request, not marketing."));
  const composeBottom=node('div',undefined,'cm-compose-bottom');const count=node('span','0 / 1,600','meta');count.id='cmCount';const send=node('button','Send reply','convert');send.id='cmSend';send.type='submit';composeBottom.append(count,send);
  const pendingBox=node('div',undefined,'cm-pending');pendingBox.id='cmPending';pendingBox.hidden=true;const pendingText=node('p');const retry=button('Retry same reply',()=>sendReply(true));retry.id='cmRetry';pendingBox.append(pendingText,retry);
  const status=node('p','','cm-send-status');status.id='cmSendStatus';status.setAttribute('role','status');
  form.append(replyLabel,help,confirmLabel,composeBottom,pendingBox,status);threadView.append(threadHeader,reason,older,log,form);conversation.append(empty,threadView);layout.append(sidebar,conversation);root.append(top,setupBox,notice,layout);
  document.querySelector('#app main')?.append(root);

  function restorePending(){
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))for(const x of saved.slice(0,20))if(/^\+[1-9]\d{7,14}$/.test(x?.phone)&&typeof x.body==='string'&&x.body.length<=1600&&typeof x.request_id==='string'&&typeof x.reply_to_sid==='string')pending.set(x.phone,x);}catch{}
  }
  function savePending(){try{sessionStorage.setItem(storageKey,JSON.stringify([...pending.values()]));return true;}catch{return false;}}
  restorePending();
  function currentKey(){return sessionStorage.getItem('a1_fieldops_key')||'';}
  function currentSession(generation,key){return generation===sessionGeneration&&key===currentKey()&&!!key;}
  async function request(operation,data={}){
    const key=currentKey();if(!key)throw Object.assign(new Error('Sign in to FieldOps to view messages.'),{code:'AUTH_REQUIRED'});
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const r=await fetch('/api/documents',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':key},body:JSON.stringify({action:'customer-messaging',operation,...data}),signal:controller.signal});
      const j=await r.json();if(!r.ok)throw Object.assign(new Error(j.error||'Messages could not be loaded.'),{code:j.code,status:r.status});return j;
    }finally{clearTimeout(timeout);}
  }
  const date=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time unavailable';};
  const phoneLabel=v=>/^\+1\d{10}$/.test(v)?`(${v.slice(2,5)}) ${v.slice(5,8)}-${v.slice(8)}`:String(v||'');
  const delivery={received:'Received',inbound:'Received',queued:'Queued',accepted:'Accepted by provider',sending:'Sending',submitting:'Awaiting confirmation',sent:'Sent to carrier',delivered:'Delivered',undelivered:'Not delivered',failed:'Failed',canceled:'Canceled',unconfirmed:'Delivery unconfirmed'};
  function setSetup(data){
    setup={...setup,...Object.fromEntries(['inbound_ready','outbound_ready','disabled_reason','business_number'].filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]))};
    setupBox.classList.toggle('cm-setup-ready',setup.outbound_ready===true);
    setupBox.replaceChildren(node('strong',setup.outbound_ready===true?'Business texting is ready':'Texting setup needs attention'),node('p',setup.outbound_ready===true?`Sending from ${phoneLabel(setup.business_number)}. Delivered means carrier delivery, not that the customer read it.`:(setup.disabled_reason||'Checking your business texting setup…')));
  }
  function renderList(){
    list.replaceChildren();const term=search.value.trim().toLowerCase();const matching=threads.filter(t=>`${t.customer?.name||''} ${t.phone}`.toLowerCase().includes(term));
    for(const t of matching){
      const item=button('',()=>loadThread(t.phone),'cm-conversation-button');item.setAttribute('aria-pressed',String(phone===t.phone));
      const line=node('span',undefined,'cm-list-title');line.append(node('strong',t.customer?.name||phoneLabel(t.phone)));
      if(Number(t.unread_count)>0)line.append(node('span',`${t.unread_count} unread`,'cm-unread'));
      item.append(line,node('span',t.customer?'Customer · '+phoneLabel(t.phone):'Unmatched number','cm-list-identity'),node('span',t.preview||'No text content','cm-preview'),node('span',date(t.last_at)+(t.blocked?' · Opted out':''),'cm-list-date'));list.append(item);
    }
    if(!matching.length)list.append(node('p',term?'No loaded conversations match.':'No customer texts yet. Incoming messages will appear here once your number is connected.','cm-empty-list'));
    listMore.hidden=!listCursor;
  }
  function draftFor(number){if(!drafts.has(number))drafts.set(number,{body:'',confirmed:false});return drafts.get(number);}
  function rememberDraft(){if(phone&&!pending.has(phone)){drafts.set(phone,{body:reply.value,confirmed:consent.checked});}}
  function syncComposer(){
    const unresolved=pending.get(phone),ready=detail?.can_reply===true&&setup.outbound_ready===true&&!detail?.blocked;
    const body=reply.value.trim();count.textContent=`${reply.value.length.toLocaleString()} / 1,600`;
    reply.disabled=consent.disabled=!ready||sending||!!unresolved;
    send.disabled=!ready||sending||!!unresolved||!body||body.length>1600||!consent.checked;
    send.textContent=sending?'Sending…':'Send reply';
    pendingBox.hidden=!unresolved;retry.disabled=sending||!ready;
    if(unresolved)pendingText.textContent='Delivery has not been confirmed. Refresh to check the conversation. Retry same reply uses the original request so it cannot create a duplicate send.';
    reason.textContent=detail?.blocked?'This number has opted out. Replies are disabled.':!setup.outbound_ready?(setup.disabled_reason||'Outbound texting is not ready yet.'):!detail?.can_reply?'A customer service inquiry is required before replying from FieldOps.':'';
  }
  function clearMedia(){mediaEpoch++;for(const value of mediaCache.values())URL.revokeObjectURL(value.url);mediaCache.clear();}
  function photoElement(value){const img=node('img',undefined,'cm-photo');img.src=value.url;img.alt='Photo attached to the customer’s message';img.loading='lazy';return img;}
  async function viewMedia(sid,index,container,trigger){
    if(trigger.disabled)return;
    const epoch=mediaEpoch,session=sessionGeneration,key=currentKey(),cacheKey=sid+':'+index;
    if(mediaCache.has(cacheKey)){container.replaceChildren(photoElement(mediaCache.get(cacheKey)));return;}
    trigger.disabled=true;const text=node('p','Loading private attachment…','cm-attachment');container.replaceChildren(text);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const r=await fetch('/api/documents',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':key},body:JSON.stringify({action:'customer-messaging',operation:'media',sid,index}),signal:controller.signal});
      if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'This attachment is not available.');}
      const type=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(!['image/jpeg','image/png','image/webp','image/gif'].includes(type))throw new Error('This attachment is not a supported photo.');
      if(Number(r.headers.get('content-length'))>4*1024*1024)throw new Error('This photo is too large to display here.');
      const blob=await r.blob();if(blob.size>4*1024*1024)throw new Error('This photo is too large to display here.');
      if(epoch!==mediaEpoch||!currentSession(session,key))return;
      const value={url:URL.createObjectURL(blob)};if(mediaCache.has(cacheKey))URL.revokeObjectURL(mediaCache.get(cacheKey).url);mediaCache.set(cacheKey,value);
      if(container.isConnected!==false)container.replaceChildren(photoElement(value));else renderMessages();
    }catch(e){if(epoch===mediaEpoch&&currentSession(session,key))text.textContent=e.name==='AbortError'?'Photo loading took too long. Try again.':e.message;}
    finally{clearTimeout(timeout);trigger.disabled=false;}
  }
  function renderMessages(scrollToEnd=false){
    log.replaceChildren();for(const m of messages){
      const inbound=m.direction==='inbound';const article=node('article',undefined,'cm-message '+(inbound?'cm-inbound':'cm-outbound'));
      article.append(node('p',inbound?(detail?.customer?.name||'Customer'):'A-1 Plumbing & Heating','cm-message-author'),node('p',m.body||'(No text content)','cm-message-body'));
      if(Number(m.media_count)>0){article.append(node('p',`${m.media_count} attachment${Number(m.media_count)===1?'':'s'} received.`,'cm-attachment'));if(inbound&&m.sid)for(let index=0;index<Math.min(10,Number(m.media_count));index++){
        const container=node('div',undefined,'cm-photo-container'),cacheKey=m.sid+':'+index;const photoButton=button('View attachment '+(index+1),()=>viewMedia(m.sid,index,container,photoButton),'cm-photo-button');photoButton.setAttribute('aria-label','View attachment '+(index+1)+' received '+date(m.at));
        if(mediaCache.has(cacheKey))container.append(photoElement(mediaCache.get(cacheKey)));article.append(photoButton,container);
      }}
      article.append(node('p',date(m.at)+' · '+(inbound?'Received':delivery[m.status]||'Status unavailable'),'cm-message-meta'));
      if(!inbound&&m.error)article.append(node('p',typeof m.error==='string'?m.error:m.error.message||m.error.code||'Delivery needs attention.','cm-message-error'));
      log.append(article);
    }
    if(!messages.length)log.append(node('p','No messages in this conversation yet.','meta'));
    older.hidden=!threadCursor;if(scrollToEnd)log.scrollTop=log.scrollHeight;
  }
  function reconcilePending(){
    const attempt=pending.get(phone);if(!attempt)return;
    const found=messages.find(m=>(m.request_id||m.id)===attempt.request_id);if(!found||['submitting','unconfirmed','sending'].includes(found.status))return;
    pending.delete(phone);savePending();
    if(['failed','undelivered','canceled'].includes(found.status)){drafts.set(phone,{body:attempt.body,confirmed:false});status.textContent='The reply was not delivered. Review the failure before deciding whether to send a new reply.';}
    else{drafts.set(phone,{body:'',confirmed:false});status.textContent='Your previous reply is recorded. No duplicate was sent.';}
  }
  async function loadList(append=false){
    const generation=++listGeneration,session=sessionGeneration,key=currentKey();refresh.disabled=true;listMore.disabled=true;
    try{const j=await request('list',append&&listCursor?{cursor:listCursor}:{});if(generation!==listGeneration||!currentSession(session,key))return;setSetup(j);threads=append?[...threads,...(j.threads||[]).filter(t=>!threads.some(a=>a.phone===t.phone))]:j.threads||[];listCursor=j.next_cursor||null;renderList();notice.textContent='';}
    catch(e){if(generation===listGeneration&&currentSession(session,key))notice.textContent=e.name==='AbortError'?'The inbox took too long to load. Refresh to try again.':e.message;}
    finally{if(generation===listGeneration){refresh.disabled=false;listMore.disabled=false;}}
  }
  async function loadThread(target,{older:loadOlder=false,quiet=false}={}){
    if(!target)return;rememberDraft();const same=target===phone;phone=target;const generation=++threadGeneration,session=sessionGeneration,key=currentKey();
    if(!same){clearMedia();detail=null;messages=[];threadCursor=null;status.textContent='';reply.value='';consent.checked=false;renderList();renderMessages();}
    empty.hidden=true;threadView.hidden=false;name.textContent='Loading conversation…';number.textContent=phoneLabel(target);history.hidden=true;syncComposer();
    try{
      const j=await request('thread',{phone:target,...(loadOlder&&threadCursor?{before:threadCursor}:{})});if(generation!==threadGeneration||!currentSession(session,key))return;
      detail=j;setSetup(j);threadCursor=j.next_cursor||null;
      messages=loadOlder?[...(j.messages||[]),...messages.filter(m=>!(j.messages||[]).some(x=>x.id===m.id))]:j.messages||[];
      reconcilePending();name.textContent=j.customer?.name||phoneLabel(target);number.textContent=j.customer?phoneLabel(target):'Unmatched number · '+phoneLabel(target);history.hidden=!j.customer?.id;
      const draft=pending.get(phone)||draftFor(phone);reply.value=draft.body||'';consent.checked=!!draft.confirmed;renderMessages(!loadOlder&&!quiet);syncComposer();
      if(active&&document.visibilityState!=='hidden'&&j.latest_inbound_sid){
        await request('mark-read',{phone:target,through_sid:j.latest_inbound_sid});if(generation===threadGeneration&&currentSession(session,key)){const t=threads.find(x=>x.phone===target);if(t)t.unread_count=0;renderList();}
      }
    }catch(e){if(generation===threadGeneration&&currentSession(session,key)){notice.textContent=e.name==='AbortError'?'The conversation took too long to load. Refresh to try again.':e.message;if(!detail){name.textContent=phoneLabel(target);reason.textContent='Conversation could not be loaded. Refresh before replying.';syncComposer();}}}
  }
  const definitive=new Set(['SETUP_PENDING','CONSENT_REQUIRED','INVALID_INPUT','OPTED_OUT','REPLY_REQUIRED','REQUEST_CONFLICT','RATE_LIMITED','AUTH_REQUIRED']);
  async function sendReply(retryExisting=false){
    if(sending||!phone||detail?.can_reply!==true||setup.outbound_ready!==true||detail?.blocked)return;
    rememberDraft();let attempt=pending.get(phone);
    if(attempt&&!retryExisting)return;
    if(!attempt){const body=reply.value.trim();if(!body||body.length>1600||!consent.checked)return;attempt={phone,body,request_id:crypto.randomUUID(),reply_to_sid:detail.reply_to_sid,consent_confirmed:true};if(!attempt.reply_to_sid){status.textContent='Refresh this conversation before replying.';return;}pending.set(phone,attempt);if(!savePending()){pending.delete(phone);status.textContent='This browser could not save a send-recovery record. Nothing was sent. Allow session storage before sending from FieldOps.';syncComposer();return;}}
    const target=phone,session=sessionGeneration,key=currentKey();sending=true;status.textContent='Sending your reply…';syncComposer();
    try{
      const j=await request('send',attempt);if(!currentSession(session,key))return;
      const uncertain=j.unconfirmed||!j.message||['submitting','unconfirmed'].includes(j.message.status);
      if(!uncertain){pending.delete(target);savePending();drafts.set(target,{body:['failed','undelivered','canceled'].includes(j.message.status)?attempt.body:'',confirmed:false});}
      if(phone===target){const draft=pending.get(target)||draftFor(target);reply.value=draft.body||'';consent.checked=false;status.textContent=uncertain?'Delivery is unconfirmed. Check the conversation before trying again.':['failed','undelivered','canceled'].includes(j.message.status)?'The reply was not delivered. Review the delivery details below.':'Reply accepted. Delivery status will update in the conversation.';await loadThread(target,{quiet:true});}
      await loadList();
    }catch(e){if(currentSession(session,key)){
      if(definitive.has(e.code)){pending.delete(target);savePending();drafts.set(target,{body:attempt.body,confirmed:false});}
      if(phone===target){status.textContent=definitive.has(e.code)?e.message:'Delivery could not be confirmed. Refresh first, or retry the same reply safely.';const d=pending.get(target)||draftFor(target);reply.value=d.body||'';consent.checked=false;}
    }}finally{if(session===sessionGeneration){sending=false;syncComposer();}}
  }
  async function refreshInbox(){await loadList();if(phone)await loadThread(phone,{quiet:true});}
  search.oninput=renderList;reply.oninput=()=>{rememberDraft();syncComposer();};consent.onchange=()=>{rememberDraft();syncComposer();};form.onsubmit=e=>{e.preventDefault();return sendReply();};
  function leave(){active=false;clearInterval(timer);timer=null;rememberDraft();}
  async function open(){
    active=true;clearInterval(timer);setSetup({});await refreshInbox();
    if(active)timer=setInterval(()=>{if(active&&document.visibilityState!=='hidden'&&!sending)refreshInbox();},30000);
  }
  function clear(){
    leave();clearMedia();sessionGeneration++;listGeneration++;threadGeneration++;phone='';detail=null;threads=[];messages=[];setup={};drafts.clear();pending.clear();sending=false;
    try{sessionStorage.removeItem(storageKey);}catch{}list.replaceChildren();log.replaceChildren();reply.value='';consent.checked=false;notice.textContent='';status.textContent='';threadView.hidden=true;empty.hidden=false;
  }
  window.A1CustomerMessaging=Object.freeze({open,leave,clear});
  window.addEventListener('pagehide',leave);
  syncComposer();
})();
