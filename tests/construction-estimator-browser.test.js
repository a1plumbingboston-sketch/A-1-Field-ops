import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startServer} from './dev-server.js';

test('whole-house scope is allocated to the exact owner price and applied to the quote',async()=>{
 const app=await startServer(),browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),requests=[];
  await page.route('**/api/invoice-assist',async route=>{
   requests.push(JSON.parse(route.request().postData()||'{}'));
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[
    {description:'Kitchen plumbing rough and finish',quantity:1,unit_price:9000},
    {description:'Primary and hall bathroom plumbing',quantity:1,unit_price:12000},
    {description:'Basement mechanical-room repipe',quantity:1,unit_price:9000}
   ],reasoning:'Allocated by room and phase.'})});
  });
  await page.goto(app.origin);
  await page.locator('#accessKey').fill('test-key');
  await page.getByRole('button',{name:'Unlock FieldOps'}).click();
  await page.getByRole('button',{name:'Estimates',exact:true}).click();
  await page.getByRole('button',{name:/Remodel \/ Construction Estimator/}).click();
  await page.locator('[name="project"]').fill('Whole-house remodel');
  await page.locator('[name="scope"]').fill('Kitchen — new sink, dishwasher and refrigerator connections\nPrimary bath — shower, toilet and double vanity\nHall bath — tub, toilet and vanity\nBasement — replace main shutoff and repipe mechanical room');
  await page.locator('[name="total"]').fill('30000');
  await page.getByRole('button',{name:/Allocate project price/}).click();
  await page.getByText('Allocated total').waitFor();
  assert.deepEqual(requests[0],{mode:'allocate',document_type:'estimate',profile:'construction',title:'Whole-house remodel',description:'Kitchen — new sink, dishwasher and refrigerator connections\nPrimary bath — shower, toilet and double vanity\nHall bath — tub, toilet and vanity\nBasement — replace main shutoff and repipe mechanical room',total:30000});
  assert.equal(await page.locator('.remodel-price-row').count(),3);
  assert.match(await page.locator('#taskResult').textContent(),/\$30,000\.00/);
  await page.getByLabel('I reviewed the scope, each line price, and the exact total.').check();
  await page.getByRole('button',{name:'Use in draft quote',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#estimateItems .estimate-item').length===3);
  assert.equal(await page.locator('#estimateItems .estimate-item').count(),3);
  assert.equal(await page.locator('#estTitle').inputValue(),'Whole-house remodel');
  const prices=await page.locator('#estimateItems .item-unit').evaluateAll(nodes=>nodes.map(n=>Number(n.value)));
  assert.equal(prices.reduce((sum,n)=>sum+n,0),30000);
 }finally{await browser.close();await app.close();}
});
