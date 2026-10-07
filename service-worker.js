const CACHE='a1-fieldops-31.10.0-ff750c80961d';
const ASSETS=["/","/index.html","/employee.html","/manifest.webmanifest","/employee.webmanifest","/a1-logo.png","/actor.js","/actor.test.js","/api.test.js","/app-updates.js","/audit-log.test.js","/calendar-export.js","/complete-job.js","/convert-lead.js","/customer-messaging.css","/customer-messaging.js","/db.js","/dev-server.js","/discount-warning-browser.test.js","/document-system.css","/document-system.js","/documents.js","/employee.css","/employee.js","/estimate-labor.js","/estimate-labor.test.js","/estimate-request.js","/finance-charts.js","/finance-workspace.css","/finance-workspace.js","/hourly-cost.js","/jobs.test.js","/labor-rate-settings.js","/receipt-preferences.js","/remodel-assist.js","/remodel-pricing.js","/remodel-quoter.css","/remodel-quoter.js","/send-document.js","/send-document.test.js","/styles.css","/task-estimator.css","/task-estimator.js","/team.js","/update-invoice.js","/warm-premium.css","/app-updates.js?v=31.10.0-ff750c80961d","/styles.css?v=31.10.0-ff750c80961d","/document-system.css?v=31.10.0-ff750c80961d","/document-system.js?v=31.10.0-ff750c80961d","/warm-premium.css?v=31.10.0-ff750c80961d","/finance-workspace.css?v=31.10.0-ff750c80961d","/finance-workspace.js?v=31.10.0-ff750c80961d","/estimate-labor.js?v=31.10.0-ff750c80961d","/estimate-request.js?v=31.10.0-ff750c80961d","/task-estimator.css?v=31.10.0-ff750c80961d","/task-estimator.js?v=31.10.0-ff750c80961d","/labor-rate-settings.js?v=31.10.0-ff750c80961d","/receipt-preferences.js?v=31.10.0-ff750c80961d","/customer-messaging.css?v=31.10.0-ff750c80961d","/customer-messaging.js?v=31.10.0-ff750c80961d","/employee.css?v=31.10.0-ff750c80961d","/calendar-export.js?v=31.10.0-ff750c80961d","/employee.js?v=31.10.0-ff750c80961d"];
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
