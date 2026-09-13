(() => {
  'use strict';
  const current = document.querySelector('meta[name="fieldops-release"]')?.content;
  if (!current) return;
  let registration, pending, checking = false, reloading = false, busy = 0, lastCheck = 0, touched = Date.now();
  const dirty = new Set();
  const nativeFetch = window.fetch.bind(window);
  // Track saves, payments, AI requests and uploads without changing their responses.
  window.fetch = async (...args) => {
    busy++;
    try {
      const response = await nativeFetch(...args);
      for (const method of ['json','text','blob','arrayBuffer','formData']) {
        const read = response[method].bind(response);
        response[method] = async (...values) => { busy++; try { return await read(...values); } finally { busy--; touched = Date.now(); } };
      }
      return response;
    } finally { busy--; touched = Date.now(); }
  };
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0;
  const editable = el => el?.matches?.('input,textarea,select,[contenteditable="true"]');
  function hasEdits() {
    for (const el of dirty) if (!el.isConnected) dirty.delete(el);
    return dirty.size > 0;
  }
  function protectedWork() {
    return busy > 0 || hasEdits() || (visible(document.activeElement) && editable(document.activeElement)) ||
      [...document.querySelectorAll('dialog[open],[role="dialog"],#remodelQuoter,form:not(#loginForm)')].some(visible) ||
      [...document.querySelectorAll('button:disabled')].some(el => visible(el) && /saving|sending|uploading|building|generating|processing/i.test(el.textContent));
  }
  const notice = document.createElement('aside');
  notice.id = 'fieldopsUpdateNotice'; notice.hidden = true; notice.setAttribute('role', 'status');
  notice.style.cssText = 'position:fixed;z-index:20000;left:12px;right:12px;bottom:max(16px,env(safe-area-inset-bottom));max-width:640px;margin:auto;padding:16px 18px;border:1px solid #bba282;border-radius:18px;background:#fffaf1;color:#382923;box-shadow:0 10px 40px #38292333;font:16px/1.45 system-ui;';
  const message = document.createElement('p'); message.style.margin = '0 0 10px';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Update now';
  button.style.cssText = 'background:#382923;color:#fffaf1;border:0;border-radius:10px;padding:12px 18px;min-height:44px;font:600 15px system-ui;';
  notice.append(message, button); document.body.append(notice);
  const tools = document.createElement('div'); tools.id = 'fieldopsUpdateTools';
  tools.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:14px 18px 28px;color:#75665a;font:13px/1.4 system-ui;';
  const status = document.createElement('span'); status.textContent = 'Automatic updates · v' + current.split('-')[0]; status.setAttribute('role','status');
  const checkButton = document.createElement('button'); checkButton.type = 'button'; checkButton.textContent = 'Check for updates';
  checkButton.style.cssText = 'border:0;background:transparent;color:#604d3c;text-decoration:underline;padding:10px;min-height:44px;font:inherit;cursor:pointer';
  tools.append(status,checkButton); document.body.append(tools);
  checkButton.onclick = async () => {
    checkButton.disabled = true; status.textContent = 'Checking for updates…';
    const result = await check(true);
    status.textContent = result === 'current' ? 'FieldOps is up to date.' : result === 'available' ? 'Update ready above.' : result === 'offline' ? 'Connect to the internet to check.' : 'Unable to check right now. Try again shortly.';
    checkButton.disabled = false;
  };
  function show() {
    notice.hidden = !pending;
    if (pending) message.textContent = protectedWork() ? 'A FieldOps update is ready. Save your work first, then update when you’re ready.' : 'A FieldOps update is ready. Updating shortly…';
  }
  function reload() {
    if (reloading || !pending || !navigator.onLine || document.visibilityState !== 'visible') return;
    const target = pending.id;
    try {
      if (new URL(location.href).searchParams.get('app-build') === target || sessionStorage.getItem('a1_last_update_attempt') === target) {
        message.textContent = 'The update is still arriving. Close and reopen FieldOps when convenient.'; return;
      }
      sessionStorage.setItem('a1_last_update_attempt', target);
    } catch { /* A denied storage API must not break the app. */ }
    reloading = true;
    registration?.waiting?.postMessage({type: 'ACTIVATE_UPDATE'});
    const url = new URL(location.href); url.searchParams.delete('release'); url.searchParams.set('app-build', target);
    location.replace(url.href);
  }
  button.onclick = () => {
    if (!navigator.onLine) { message.textContent = 'Reconnect to the internet to finish updating FieldOps.'; return; }
    if (busy) { message.textContent = 'Please wait for the current save or upload to finish.'; return; }
    if (protectedWork() && !confirm('Save any unfinished work before updating. Reload FieldOps now?')) return;
    reload();
  };
  function idleUpdate() {
    if (!pending || document.visibilityState !== 'visible' || !navigator.onLine) return;
    show();
    if (!protectedWork() && Date.now() - touched >= 5000) reload();
  }
  async function check(force = false) {
    if (!navigator.onLine) return 'offline';
    if (checking || document.visibilityState !== 'visible' || (!force && Date.now() - lastCheck < 15000)) return 'unavailable';
    checking = true; lastCheck = Date.now();
    try {
      const response = await nativeFetch('/release.json', {cache:'no-store', signal:AbortSignal.timeout(12000)});
      if (!response.ok) return 'unavailable';
      const release = await response.json();
      if (typeof release.id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(release.id)) return 'unavailable';
      if (release.id !== current) { pending = release; show(); idleUpdate(); }
      else {
        pending = null; notice.hidden = true;
        try { sessionStorage.removeItem('a1_last_update_attempt'); } catch {}
      }
      if (registration) {
        await registration.update();
        if (registration.waiting && !protectedWork()) registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
      }
      return pending ? 'available' : 'current';
    } catch { return 'unavailable'; /* Retain the current working app. */ }
    finally { checking = false; }
  }
  for (const type of ['pointerdown','keydown']) document.addEventListener(type, () => { touched = Date.now(); }, true);
  for (const type of ['input','change']) document.addEventListener(type, e => {
    touched = Date.now();
    if (editable(e.target) && e.target.type !== 'password' && e.target.type !== 'search' && !e.target.closest('.filters')) dirty.add(e.target);
    show();
  }, true);
  document.addEventListener('reset', e => { for (const el of dirty) if (e.target.contains(el)) dirty.delete(el); }, true);
  document.addEventListener('fieldops:saved', e => { for (const el of dirty) if (e.target === document || e.target.contains(el)) dirty.delete(el); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('pageshow', () => check()); window.addEventListener('online', () => check(true));
  window.addEventListener('focus', () => check());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', {scope:'/', updateViaCache:'none'}).then(r => {
      registration = r;
      r.addEventListener('updatefound', () => {
        r.installing?.addEventListener('statechange', () => { if (r.waiting && !protectedWork()) r.waiting.postMessage({type:'ACTIVATE_UPDATE'}); });
      });
      check(true);
    }).catch(() => check(true));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (pending) idleUpdate(); });
  }
  setInterval(() => check(), 5 * 60 * 1000); setInterval(idleUpdate, 2000); check(true);
})();
