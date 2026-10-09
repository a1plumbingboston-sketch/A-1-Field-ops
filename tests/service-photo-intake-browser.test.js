import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
test('job photo compression, removal and customer switch clear session-only images',async()=>{
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.setContent('<form id="estimateForm"><textarea id="estDescription"></textarea><div id="serviceEstimateTools"></div><select id="estCustomerId"><option>A</option><option>B</option></select><select id="estJobId"></select><select id="estQuoteMode"></select><button type="button" id="newEstimateBtn">New</button></form>');
 await page.addScriptTag({content:await fs.readFile(new URL('../service-photo-intake.js',import.meta.url),'utf8')});
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2000;c.height=1000;c.getContext('2d').fillRect(0,0,2000,1000);return c.toDataURL('image/png').split(',')[1];});
 const file={name:'equipment.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')};
 await page.locator('#estPhotos').setInputFiles(file);await page.waitForFunction(()=>window.A1ServicePhotos.capture().length===1);
 const size=await page.evaluate(async()=>{const p=window.A1ServicePhotos.capture()[0],b=await createImageBitmap(await(await fetch(p)).blob());return [b.width,b.height,p.length];});assert.deepEqual(size.slice(0,2),[1280,640]);assert.ok(size[2]<700000);
 await page.locator('#estCustomerId').selectOption({label:'B'});assert.equal(await page.evaluate(()=>window.A1ServicePhotos.capture().length),0);
 await page.locator('#estPhotos').setInputFiles([file,file,file,file]);assert.match(await page.locator('#servicePhotoStatus').textContent(),/up to three/);assert.equal(await page.evaluate(()=>window.A1ServicePhotos.capture().length),0);
 await page.locator('#estPhotos').setInputFiles(file);await page.waitForFunction(()=>window.A1ServicePhotos.capture().length===1);await page.locator('#clearServicePhotos').click();assert.equal(await page.evaluate(()=>window.A1ServicePhotos.capture().length),0);
 }finally{await browser.close();}
});

test('mobile service photos → clarification → itemized review → saved quote',async()=>{
 const {startServer}=await import('./dev-server.js');
 const app=await startServer(),browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),errors=[],requests=[];
  await context.route('https://*.supabase.co/**',async route=>{const req=route.request(),r=await fetch(app.origin+'/__rest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:req.url(),options:{method:req.method(),headers:req.headers(),body:req.postData()}})});await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/estimate-assist',async route=>{
   const req=route.request(),body=JSON.parse(req.postData());requests.push(body);
   if(requests.length===1){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({analysis:{needs_clarification:true,clarifying_questions:['Will the customer supply the new faucet?'],recommended_line_items:[]}})});return;}
   const r=await fetch(app.origin+'/api/estimate-assist',{method:'POST',headers:req.headers(),body:req.postData()});await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()});
  });
  await page.goto(app.origin);await page.locator('#accessKey').fill('test-key');await page.getByRole('button',{name:'Unlock FieldOps'}).click();await page.getByRole('button',{name:'Estimates',exact:true}).click();
  await page.locator('#newEstimateBtn').click();await page.locator('#estimateForm').waitFor({state:'visible'});await page.locator('#estCustomerId').selectOption(app.customer);
  await page.locator('#estTitle').fill('Kitchen faucet replacement');await page.locator('#estDescription').fill('Replace existing kitchen faucet. Supply responsibility unknown.');
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=20;c.getContext('2d').fillRect(0,0,20,20);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#estPhotos').setInputFiles({name:'faucet.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.waitForFunction(()=>window.A1ServicePhotos.capture().length===1);
  await page.locator('#aiEstimateBtn').click();await page.getByText('A few details before pricing').waitFor();assert.equal(await page.locator('#applyAiQuoteButton').count(),0);
  await page.locator('#estDescription').fill('Replace existing kitchen faucet. Customer supplies faucet. Accessible shutoffs and drain, no repiping.');await page.locator('#aiEstimateBtn').click();await page.locator('#applyAiQuoteButton').waitFor();
  assert.equal(requests.length,2);assert.match(requests[1].photos[0],/^data:image\/jpeg;base64,/);await page.locator('#applyAiQuoteButton').click();
  assert.equal(await page.locator('#estimateItems .estimate-item').count(),3);assert.match(await page.locator('#estimateTotal').textContent(),/375/);
  await page.locator('#saveEstimateButton').click();await page.waitForFunction(()=>document.querySelector('#estimateForm').style.display==='none');
  const saved=(await app.q("select * from estimates where title='Kitchen faucet replacement'"))[0];assert.ok(saved);assert.equal(Number(saved.total),375);
  const items=await app.q('select description,unit_price from estimate_items where estimate_id=$1',[saved.id]);assert.equal(items.filter(i=>i.description==='Truck fee').length,1);assert.equal(await page.evaluate(()=>window.A1ServicePhotos.capture().length),0);
  assert.ok(!JSON.stringify(saved).includes('data:image/'));assert.deepEqual(errors,[]);
 }finally{await browser.close();await app.close();}
});
