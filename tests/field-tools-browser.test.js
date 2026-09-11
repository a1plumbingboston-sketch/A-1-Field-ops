import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startServer} from './dev-server.js';
test('field tools: mobile price book, real photo upload, customer history and email activity',async()=>{
 await mkdir('test-results',{recursive:true});
 const app=await startServer(),browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.origin);await page.locator('#accessKey').fill('test-key');await page.getByRole('button',{name:'Unlock FieldOps'}).click();
 await page.getByRole('button',{name:'Estimates',exact:true}).click();await page.getByRole('button',{name:'New Estimate',exact:true}).click();await page.getByRole('button',{name:'Price book',exact:true}).click();
 await page.getByLabel('Service name',{exact:true}).fill('Faucet installation');await page.getByLabel('Scope / description').fill('Install supplied faucet');await page.locator('#bookPrice').fill('295');await page.getByRole('button',{name:'Save service',exact:true}).click();await page.getByRole('button',{name:'Add to quote',exact:true}).click();
 await page.locator('#closeFieldTools').click();assert.equal(await page.locator('#estimateItems .estimate-item').count(),1);assert.equal(await page.locator('#estimateItems .item-unit').inputValue(),'295.00');
 await page.getByRole('button',{name:'Customers',exact:true}).click();await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:'Job photos',exact:true}).click();
 const png=await page.screenshot();await page.locator('#jobPhotoFile').setInputFiles({name:'job.png',mimeType:'image/png',buffer:png});await page.getByLabel('Caption',{exact:true}).fill('Before repair');await page.getByRole('button',{name:'Upload photo',exact:true}).click();await page.getByRole('button',{name:'View photo',exact:true}).waitFor();await page.getByRole('button',{name:'View photo',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#jobPhotosList img')?.naturalWidth>0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/mobile-job-photo.png',fullPage:true});
 await page.getByRole('button',{name:'Back to customer history',exact:true}).click();await page.locator('#fieldToolsBody').getByRole('button',{name:'Review quote',exact:true}).click();await page.getByRole('button',{name:'Send Quote',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#appMsg')?.textContent.includes('Email accepted'));
 await page.getByRole('button',{name:'Email activity',exact:true}).click();assert.equal(await page.locator('#refreshDelivery').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'delivery refresh must be above quote modal');await page.getByRole('button',{name:'Refresh delivery status',exact:true}).click();await page.locator('#fieldToolsBody').getByText('Delivered',{exact:true}).waitFor();assert.equal(app.mails.length,1);
 await page.setViewportSize({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();await app.close();}
});
