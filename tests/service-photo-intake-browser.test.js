import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
test('job photo compression, removal and customer switch clear session-only images',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chromium'});
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
