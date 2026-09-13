const CACHE='a1-fieldops-31.8.6';
const ASSETS=['/','/index.html','/employee.html','/app-updates.js','/manifest.webmanifest','/employee.webmanifest','/a1-logo.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>event.waitUntil((async()=>{await Promise.all((await caches.keys()).filter(key=>key.startsWith('a1-fieldops-')&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.includes('customer-sign')||url.pathname.includes('/pay')||url.pathname==='/release.json')return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=()=>cache.match(req).then(hit=>hit||(req.mode==='navigate'?cache.match(url.pathname.startsWith('/employee')?'/employee.html':'/index.html'):undefined));
  try{const response=await fetch(req,{cache:'no-cache'});if(response.status>=500)return await cached()||response;return response;}
  catch{return await cached()||Response.error();}
 })());
});
