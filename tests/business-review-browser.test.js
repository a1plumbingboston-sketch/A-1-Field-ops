import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {startServer} from './dev-server.js';
test('Business Review works on desktop/mobile, opens business tools, and preserves facts when AI fails',async()=>{
 const app=await startServer(),browser=await chromium.launch({headless:true}),errors=[];
 try{
  await fs.mkdir('test-results',{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.origin);await page.locator('#accessKey').fill('test-key');await page.getByRole('button',{name:'Unlock FieldOps'}).click();
  await page.getByRole('button',{name:'Business Review',exact:true}).click();await page.getByRole('button',{name:'Get AI priorities',exact:true}).waitFor();
  assert.match(await page.locator('#fieldToolsBody').textContent(),/New leads1/);
  await page.getByRole('button',{name:'Get AI priorities',exact:true}).click();await page.getByRole('heading',{name:'AI priorities',exact:true}).waitFor();
  assert.match(await page.locator('#fieldToolsBody').textContent(),/Review each new lead/);
  await page.screenshot({path:'test-results/business-review-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.field-tools-card').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await page.screenshot({path:'test-results/business-review-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Review jobs',exact:true}).click();await page.getByRole('button',{name:'Google Calendar',exact:true}).waitFor();
  await page.getByRole('button',{name:'Business Review',exact:true}).click();await page.getByRole('button',{name:'Get AI priorities',exact:true}).waitFor();
  const key=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  try{await page.getByRole('button',{name:'Get AI priorities',exact:true}).click();await page.getByRole('status').filter({hasText:'AI is not connected'}).waitFor();assert.match(await page.locator('#fieldToolsBody').textContent(),/New leads1/);}finally{process.env.OPENAI_API_KEY=key;}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await app.close();}
});
