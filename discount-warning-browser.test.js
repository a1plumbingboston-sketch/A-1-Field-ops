import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startServer} from './dev-server.js';

test('an over-large discount warns live in the estimate editor and is blocked from saving, not silently shown as a negative total',async()=>{
  await mkdir('test-results',{recursive:true});
  const app=await startServer(),browser=await chromium.launch({headless:true}),errors=[];
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.origin);
    await page.locator('#accessKey').fill('test-key');
    await page.getByRole('button',{name:'Unlock FieldOps'}).click();
    await page.getByRole('button',{name:'Estimates',exact:true}).click();
    await page.evaluate(id=>openEstimate(id),app.estimate);
    await page.getByRole('button',{name:'Edit / Change Order',exact:true}).click();
    await page.locator('#invoiceEditForm').waitFor();

    // Sample fixture estimate totals $2500 -- type a discount far larger than that.
    await page.locator('#editDiscount').fill('5000');
    await page.waitForFunction(()=>document.querySelector('#editDiscountWarning')?.textContent.includes('subtotal'));
    assert.match(await page.locator('#editDiscountWarning').textContent(),/can't exceed the \$2,500\.00 subtotal/);
    const redColor=await page.locator('#editDocumentTotal').evaluate(el=>getComputedStyle(el).color);
    assert.equal(redColor,'rgb(201, 32, 47)','total should render in the warning color while the discount is invalid');
    await page.screenshot({path:'test-results/discount-overrun-warning.png',fullPage:true});

    // Attempting to save while invalid must be rejected, not silently accepted.
    await page.getByRole('button',{name:'Save / Create Change Order',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#appMsg')?.textContent.includes('subtotal'));
    assert.match(await page.locator('#appMsg').textContent(),/Discount must be between \$0 and the quote subtotal/);

    // Fixing the discount clears the warning and shows the correct positive total.
    await page.locator('#editDiscount').fill('50');
    await page.waitForFunction(()=>!document.querySelector('#editDiscountWarning')?.textContent);
    assert.match(await page.locator('#editDocumentTotal').textContent(),/\$2,450\.00/);
    const normalColor=await page.locator('#editDocumentTotal').evaluate(el=>getComputedStyle(el).color);
    assert.notEqual(normalColor,'rgb(201, 32, 47)','total should return to its normal color once the discount is valid');

    assert.deepEqual(errors,[]);
  }finally{
    await browser.close();
    await app.close();
  }
});
