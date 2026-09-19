const CACHE='a1-fieldops-31.9.0-17ca287f51b4';
const ASSETS=["/","/index.html","/employee.html","/manifest.webmanifest","/employee.webmanifest","/a1-logo.png","/actor.js","/actor.test.js","/api.test.js","/app-updates.js","/audit-log.test.js","/calendar-export.js","/complete-job.js","/convert-lead.js","/db.js","/dev-server.js","/discount-warning-browser.test.js","/document-system.css","/document-system.js","/documents.js","/employee.css","/employee.js","/estimate-labor.js","/estimate-labor.test.js","/estimate-request.js","/finance-charts.js","/finance-workspace.css","/finance-workspace.js","/hourly-cost.js","/jobs.test.js","/labor-rate-settings.js","/receipt-preferences.js","/remodel-assist.js","/remodel-pricing.js","/remodel-quoter.css","/remodel-quoter.js","/send-document.js","/send-document.test.js","/styles.css","/task-estimator.css","/task-estimator.js","/team.js","/update-invoice.js","/warm-premium.css","/app-updates.js?v=31.9.0-17ca287f51b4","/styles.css?v=31.9.0-17ca287f51b4","/document-system.css?v=31.9.0-17ca287f51b4","/document-system.js?v=31.9.0-17ca287f51b4","/warm-premium.css?v=31.9.0-17ca287f51b4","/finance-workspace.css?v=31.9.0-17ca287f51b4","/finance-workspace.js?v=31.9.0-17ca287f51b4","/estimate-labor.js?v=31.9.0-17ca287f51b4","/estimate-request.js?v=31.9.0-17ca287f51b4","/task-estimator.css?v=31.9.0-17ca287f51b4","/task-estimator.js?v=31.9.0-17ca287f51b4","/labor-rate-settings.js?v=31.9.0-17ca287f51b4","/receipt-preferences.js?v=31.9.0-17ca287f51b4","/employee.css?v=31.9.0-17ca287f51b4","/calendar-export.js?v=31.9.0-17ca287f51b4","/employee.js?v=31.9.0-17ca287f51b4"];
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
