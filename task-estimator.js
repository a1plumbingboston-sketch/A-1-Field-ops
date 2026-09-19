// Remodel / new-construction estimator. The owner establishes the contract
// price; AI only organizes the written walkthrough scope into customer-facing
// fixed-price line items. Server reconciliation guarantees the returned lines
// add up to the exact owner-entered price.
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
const STORAGE_KEY='a1_construction_estimator_v1';

const box=document.createElement('section');
box.id='taskEstimator';box.hidden=true;box.className='remodel-quoter';
box.innerHTML=`<div class="remodel-heading"><div><p class="eyebrow">PROJECT ESTIMATOR</p><h2>Remodel / New Construction</h2><p>Write the complete walkthrough scope and set your project price. AI will itemize that exact price without repricing the job.</p></div><button type="button" id="closeTaskEstimator">Close</button></div>
<form id="taskEstimatorForm">
 <fieldset><legend>01 · Project</legend><div class="remodel-grid"><label>Project title<input name="project" required maxlength="300" placeholder="e.g. Two-bathroom and kitchen remodel"></label><label>Job location<input name="location" maxlength="240" placeholder="Address, city, rooms or floors"></label></div></fieldset>
 <fieldset><legend>02 · Walkthrough scope</legend><label>Complete scope of work — one task per line<textarea name="scope" required minlength="20" maxlength="16000" placeholder="1. Basement — replace main shutoff and repipe mechanical room\n2. First-floor kitchen — new sink, dishwasher and refrigerator connections\n3. Primary bath — rough and finish plumbing for shower, toilet and double vanity\n4. Hall bath — tub, toilet and vanity\n\nKeep adding every room, phase and fixture included in the whole-house job."></textarea></label><p class="meta">Use as many numbered or bulleted lines as needed. AI reads the entire walkthrough, keeps every included plumbing task, and groups related work into clear priced lines.</p><div class="remodel-grid"><label>Site conditions / access<textarea name="conditions" maxlength="2400" placeholder="Occupied building, stairs, parking, open walls, existing conditions, protection"></textarea></label><label>Responsibilities / exclusions<textarea name="exclusions" maxlength="2400" placeholder="Work by GC or other trades, customer-supplied fixtures, finish repair, excluded work"></textarea></label></div></fieldset>
 <fieldset><legend>03 · Price to allocate</legend><label>Total project price ($)<input name="total" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" required placeholder="e.g. 28500"></label><p class="meta">This is the price you chose. AI may divide it by room, phase, fixture group, labor or material category, but it cannot raise or lower the total. No separate contingency or service-call line is added.</p></fieldset>
 <div class="remodel-actions"><button class="convert" type="submit" id="buildTaskEstimate">✦ Allocate project price</button><button type="button" id="clearTaskEstimator">Clear intake</button></div><p id="taskStatus" role="status" class="meta"></p>
</form><div id="taskResult" aria-live="polite"></div>`;
$('#estimateForm').before(box);
const open=document.createElement('button');open.id='newTaskEstimatorBtn';open.type='button';open.textContent='✦ Remodel / Construction Estimator';$('#newEstimateBtn').after(open);
const form=$('#taskEstimatorForm');let result=null,inputSnapshot='';
const inputs=()=>Object.fromEntries(new FormData(form));
const combinedScope=x=>[x.scope,x.location?`Job location: ${x.location}`:'',x.conditions?`Site conditions and access: ${x.conditions}`:'',x.exclusions?`Responsibilities and exclusions: ${x.exclusions}`:''].filter(Boolean).join('\n\n');
function resetResult(){result=null;$('#taskResult').innerHTML='';}
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(inputs()));$('#taskStatus').textContent='Walkthrough saved on this device. Nothing has been sent.';}catch{$('#taskStatus').textContent='Recovery storage is unavailable. Keep this page open.';}}
try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved)for(const el of form.elements)if(el.name&&saved[el.name]!==undefined)el.value=saved[el.name];}catch{}
open.onclick=()=>{box.hidden=false;box.scrollIntoView({behavior:'smooth',block:'start'});};
$('#closeTaskEstimator').onclick=()=>{box.hidden=true;open.focus();};
$('#clearTaskEstimator').onclick=()=>{if(!confirm('Clear this walkthrough? Saved quotes stay unchanged.'))return;form.reset();resetResult();localStorage.removeItem(STORAGE_KEY);$('#taskStatus').textContent='';};
form.addEventListener('input',()=>{resetResult();save();});form.addEventListener('change',()=>{resetResult();save();});

form.onsubmit=async e=>{
 e.preventDefault();const btn=$('#buildTaskEstimate');if(btn.disabled)return;
 resetResult();const x=inputs(),total=Number(x.total),description=combinedScope(x);
 if(description.trim().length<20){$('#taskStatus').textContent='Write the walkthrough scope before allocating the price.';return;}
 if(!Number.isFinite(total)||total<=0){$('#taskStatus').textContent='Enter the total project price you want itemized.';return;}
 inputSnapshot=JSON.stringify(inputs());btn.disabled=true;$('#taskStatus').textContent='Organizing the scope into fixed-price line items…';
 try{
  const r=await fetch('/api/invoice-assist',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':window.A1RemodelBridge.key()},body:JSON.stringify({mode:'allocate',document_type:'estimate',profile:'construction',title:x.project,description,total})});
  const j=await r.json();if(!r.ok)throw Error(j.error||'Could not allocate this project price.');
  if(inputSnapshot!==JSON.stringify(inputs()))throw Error('The walkthrough changed while AI was working. Build again with the latest scope.');
  const sum=(j.items||[]).reduce((n,i)=>n+Number(i.quantity)*Number(i.unit_price),0);
  if(Math.round(sum*100)!==Math.round(total*100))throw Error('The itemized prices did not match your total. Nothing was applied.');
  result=j;render(x,j);$('#taskStatus').textContent='Price allocation ready for review. Nothing has been saved or sent.';
 }catch(err){$('#taskStatus').textContent=err.message;}finally{btn.disabled=false;}
};

function render(x,j){
 const scope=combinedScope(x),total=Number(x.total);
 $('#taskResult').innerHTML=`<div class="remodel-proposal"><p class="eyebrow">OWNER-PRICED · REVIEW REQUIRED</p><div class="remodel-heading"><h3>${esc(x.project)}</h3><strong class="remodel-total">${money(total)}</strong></div><p class="meta">AI allocated your exact price; it did not research or change the project total.</p>${j.items.map(i=>`<div class="remodel-price-row"><div><b>${esc(i.description)}</b></div><b>${money(i.unit_price)}</b></div>`).join('')}<div class="detail-total"><span>Allocated total</span><b>${money(j.items.reduce((n,i)=>n+i.unit_price,0))}</b></div>${j.reasoning?`<details><summary>Internal allocation note</summary><p>${esc(j.reasoning)}</p></details>`:''}<label class="remodel-approval"><input id="reviewTaskEstimate" type="checkbox"> I reviewed the scope, each line price, and the exact total.</label><button type="button" id="applyTaskEstimate" class="convert" disabled>Use in draft quote</button><p class="meta">Next choose the client and job, edit anything needed, then save the draft. This does not send the quote.</p></div>`;
 $('#reviewTaskEstimate').onchange=e=>$('#applyTaskEstimate').disabled=!e.target.checked;
 $('#applyTaskEstimate').onclick=async()=>{
  if(inputSnapshot!==JSON.stringify(inputs())||!$('#reviewTaskEstimate').checked||!result)return;
  const btn=$('#applyTaskEstimate');btn.disabled=true;
  try{const applied=await window.A1RemodelBridge.apply({title:x.project,description:scope,items:result.items,profile:'construction'});if(applied){box.hidden=true;$('#estimateForm').scrollIntoView({behavior:'smooth',block:'start'});}}
  catch(err){$('#taskStatus').textContent=err.message;}finally{btn.disabled=false;}
 };
}
