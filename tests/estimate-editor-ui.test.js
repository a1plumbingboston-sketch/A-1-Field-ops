import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const laborPath=new URL('../estimate-labor.js',import.meta.url);
const laborSource=readFileSync(existsSync(laborPath)?laborPath:new URL('../../../tmp/latest-editor-complete/estimate-labor.js',import.meta.url),'utf8').replace(/^export /gm,'');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,`Missing UI boundary ${start}`);return html.slice(a,b);};
const editorCode=part('function appendQuoteDiscount(', 'window.archiveDocument=');
const saveCode=part("$('#estimateForm').onsubmit=async",'window.openEstimate=async');
const recoveryCode=part("const quoteDraftStorageKey=",'window.addEventListener(\'pagehide\'');
const fields=['estQuoteMode','estCustomerId','estJobId','estTitle','estDescription','estPricingMode','estZip','estLaborHours','estLaborRate','estMaterialCost','estMarkup','estContingency','estDiscount','estDescriptionQuestion8'];
const fixture=(id='estimate-one')=>({doc:{id,customer_id:'client-one',job_id:'completed-job',title:'Replace sample fixtures',description:'Previously agreed work',tax:22},revision:'server-revision-one',locked:false,context_available:true,estimator_context:{version:1,fields:{estQuoteMode:'service',estPricingMode:'per_task',estZip:'01960',estLaborHours:'0',estMaterialCost:'',estMarkup:'0',estContingency:'0',estLaborRate:'215',estDescriptionQuestion8:'Moderate — some access or condition challenges'},construction:null},items:[{description:'Agreed fixture labor',quantity:2,unit_price:132.45},{description:'Agreed materials',quantity:1,unit_price:111.11},{description:'Discount',quantity:1,unit_price:-21.11}]});
const plain=v=>JSON.parse(JSON.stringify(v));
function harness({load=fixture(),recovery=null,onLoadCustomers,onLoadJobs,onRequest,onRangeLoad,rateRanges={service:{min:220,max:280},construction:{min:230,max:310}}}={}){
 const nodes=new Map(),store=new Map(recovery?[['a1_fieldops_quote_draft_v1',JSON.stringify(recovery)]]:[]),requests=[],messages=[],opened=[];let rows=[],construction=null,serial=0;const taskControls=['project','location','scope','conditions','exclusions','total'].map(name=>({name,value:'',disabled:false}));
 const defaults={estQuoteMode:'service',estPricingMode:'per_task',estLaborRate:'200',estMarkup:'25',estContingency:'10',estDiscount:'0'};
 function element(id){if(!nodes.has(id)){
  const e={id:id.slice(1),value:defaults[id.slice(1)]??'',style:{display:''},dataset:{},hidden:false,disabled:false,textContent:'',options:[],listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},focus(){},add(option){this.options.push(option);},querySelector(selector){if(selector==='[type="submit"]')return element('#saveEstimateButton');return null;},querySelectorAll(){return fields.map(f=>element('#'+f)).concat(element('#saveEstimateButton'));},setAttribute(){},removeAttribute(){}};
  let markup='';Object.defineProperty(e,'innerHTML',{get:()=>markup,set(v){markup=v;if(id==='#estimateItems')rows=[];}});
  nodes.set(id,e);
 }return nodes.get(id);}
 fields.forEach(f=>element('#'+f));const form=element('#estimateForm');form.style.display='none';form.elements=fields.map(f=>element('#'+f));form.reset=()=>{for(const f of fields)element('#'+f).value=defaults[f]??'';for(const fn of form.listeners.reset||[])fn();};
 element('#estDescriptionQuestion8').options=['','Standard — straightforward access','Moderate — some access or condition challenges','Difficult — restricted access or extensive preparation','Specialist assessment needed'].map(value=>({value}));
 const makeRow=(description,quantity,unit_price)=>{const x={description:{value:String(description)},quantity:{value:String(quantity)},unit_price:{value:String(unit_price)}};return {raw:x,querySelector:s=>s==='.item-desc'?x.description:s==='.item-qty'?x.quantity:x.unit_price};};
 const document={querySelectorAll:s=>s.includes('#taskEstimatorForm')?taskControls:s.includes('.item-desc')?rows.map(r=>r.raw.description):s.includes('.estimate-item')?rows:fields.map(f=>element('#'+f)),addEventListener(){},getElementById:id=>element('#'+id)};
 let ctx;
 const base={$:element,document,crypto:{randomUUID:()=>`fixture-request-${++serial}`},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},queueMicrotask,Option:class{constructor(text,value){this.text=text;this.value=value;}},confirm:()=>true,setTimeout,clearTimeout,console,aiQuoteSuggestions:[],aiQuoteContext:null,setSection(){},getAccessKey:()=> 'fixture-key',showBanner:(...args)=>messages.push(args),money:n=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'}),loadEstimates:async()=>{},openEstimate:async id=>opened.push(id),openBrandedDocument:async(kind,id)=>opened.push(kind+':'+id),customerById:id=>id?{id}:null,syncEstimateCustomers:id=>{element('#estCustomerId').value=id||'';},loadCustomers:async()=>{if(onLoadCustomers)await onLoadCustomers();},loadEstimateJobs:async()=>{element('#estJobId').options=[{value:''}];element('#estJobId').value='';if(onLoadJobs)await onLoadJobs();},addEstimateItem:(description='',quantity=1,unit_price=0)=>{rows.push(makeRow(description,quantity,unit_price));ctx.calcEstimateTotal();},fetch:async(url,options)=>{if(url==='/api/documents?feature=labor-rate-settings'){if(onRangeLoad)await onRangeLoad();return {ok:true,json:async()=>rateRanges};}assert.equal(url,'/api/update-invoice');const payload=JSON.parse(options.body);requests.push(payload);if(onRequest){const response=await onRequest(payload);if(response)return response;}return {ok:true,json:async()=>payload.action==='load_estimate'?structuredClone(load):{id:payload.estimate_id||'new-estimate'}};}};
 ctx=vm.createContext(base);ctx.window=ctx;vm.runInContext(laborSource,ctx);
 ctx.A1TaskEstimator={capture:()=>construction,restore:x=>{construction=x;for(const control of taskControls)control.value=x?.[control.name]??'';},reset:()=>{construction=null;}};
 vm.runInContext(editorCode+saveCode+recoveryCode+'\n;globalThis.editorState=()=>({editor:estimateEditor,requestId:quoteSaveRequestId});',ctx);
 return {ctx,element,form,store,requests,messages,opened,taskControls,rows:()=>rows.map(r=>({description:r.raw.description.value,quantity:Number(r.raw.quantity.value),unit_price:Number(r.raw.unit_price.value)})),submit:()=>form.onsubmit({preventDefault(){},target:form,currentTarget:form}),recover:()=>element('#restoreQuoteDraft').onclick()};
}

test('full editor preserves original line prices, quantities, discount and existing tax',async()=>{
 const h=harness();assert.equal(await h.ctx.openEstimateEditor('estimate-one'),true);
 assert.deepEqual(h.rows(),fixture().items.slice(0,2));assert.equal(h.element('#estDiscount').value,'21.11');assert.equal(h.ctx.calcEstimateTotal(),376.9);assert.match(h.element('#estimateTaxNote').textContent,/22\.00/);assert.equal(h.element('#estJobId').value,'completed-job');assert.ok(h.element('#estJobId').options.some(o=>o.value==='completed-job'));assert.equal(h.rows().some(i=>i.description==='Truck fee'),false);
});

test('saved context preserves explicit zero, blanks and a manual rate without repricing rows',async()=>{
 const h=harness();await h.ctx.openEstimateEditor('estimate-one');const fields=h.ctx.captureEstimateContext().fields;
 assert.equal(fields.estLaborHours,'0');assert.equal(fields.estMaterialCost,'');assert.equal(fields.estMarkup,'0');assert.equal(fields.estContingency,'0');assert.equal(fields.estDescriptionQuestion8,'Moderate — some access or condition challenges');assert.equal(fields.estLaborRate,'215');assert.equal(h.element('#estLaborRate').value,'215');assert.equal(h.element('#estLaborRate').min,'215');assert.equal(h.rows()[0].unit_price,132.45);
});

test('older quotes retain prices while missing estimation inputs remain unknown',async()=>{
 const data=fixture();data.context_available=false;data.estimator_context=null;const h=harness({load:data});await h.ctx.openEstimateEditor(data.doc.id);
 assert.equal(h.element('#estLaborHours').value,'');assert.equal(h.element('#estMaterialCost').value,'');assert.equal(h.element('#estMarkup').value,'');assert.equal(h.element('#estContingency').value,'');assert.deepEqual(h.rows(),data.items.slice(0,2));assert.match(h.element('#estimateEditNotice').textContent,/original estimating inputs were not saved/);
});

test('saving an edit addresses its existing ID and revision with unchanged customer prices',async()=>{
 const h=harness();await h.ctx.openEstimateEditor('estimate-one');h.element('#estTitle').value='Updated project name';await h.submit();const payload=h.requests.at(-1);
 assert.equal(payload.action,'save_estimate');assert.equal(payload.estimate_id,'estimate-one');assert.equal(payload.expected_revision,'server-revision-one');assert.equal(payload.title,'Updated project name');assert.deepEqual(payload.items,fixture().items);assert.equal(payload.estimator_context.fields.estMaterialCost,'');assert.equal(h.opened.at(-1),'estimate-one');
});

test('copy as new clears the update target and uses a new request identity',async()=>{
 const h=harness();await h.ctx.openEstimateEditor('estimate-one');const old=h.ctx.editorState().requestId;h.element('#copyEstimateAsNew').onclick();assert.notEqual(h.ctx.editorState().requestId,old);await h.submit();const payload=h.requests.at(-1);assert.equal(payload.estimate_id,null);assert.equal(payload.expected_revision,null);assert.equal(payload.action,'save_estimate');assert.equal(h.opened.at(-1),'new-estimate');
});

test('recovered edits keep their original update target, request identity and stale-revision protection',async()=>{
 const first=harness();await first.ctx.openEstimateEditor('estimate-one');first.element('#estTitle').value='Recovered unsaved title';first.element('#estMaterialCost').value='0';first.ctx.persistQuoteDraft();const saved=JSON.parse(first.store.get('a1_fieldops_quote_draft_v1'));
 const newest=fixture();newest.revision='new-server-revision';const h=harness({load:newest,recovery:saved});await h.recover();assert.equal(h.ctx.editorState().editor.id,'estimate-one');assert.equal(h.ctx.editorState().editor.revision,'server-revision-one');assert.equal(h.ctx.editorState().requestId,saved.requestId);assert.equal(h.element('#estTitle').value,'Recovered unsaved title');assert.equal(h.element('#estMaterialCost').value,'0');assert.deepEqual(h.rows(),first.rows());await h.submit();const payload=h.requests.at(-1);assert.equal(payload.estimate_id,'estimate-one');assert.equal(payload.expected_revision,'server-revision-one');assert.equal(payload.request_id,saved.requestId);
});

test('locked quotes retain their client and job controls and present a change-order action',async()=>{
 const data=fixture();data.locked=true;const h=harness({load:data});await h.ctx.openEstimateEditor('estimate-one');assert.equal(h.element('#estCustomerId').disabled,true);assert.equal(h.element('#estJobId').disabled,true);assert.equal(h.element('#saveEstimateButton').textContent,'Create change order');assert.equal(h.element('#estimateNewClient').hidden,true);
});

test('loading another quote hides incomplete data and cannot overwrite the previous recovery copy',async()=>{
 let calls=0,release,entered;const blocked=new Promise(r=>{entered=r;});
 const h=harness({onLoadJobs:async()=>{if(++calls===2){entered();await new Promise(r=>{release=r;});}}});await h.ctx.openEstimateEditor('estimate-one');h.element('#estTitle').value='Keep these unsaved edits';h.ctx.persistQuoteDraft();const before=h.store.get('a1_fieldops_quote_draft_v1');
 const loading=h.ctx.openEstimateEditor('estimate-two');await blocked;
 try{assert.ok(h.form.style.display==='none'||h.element('#saveEstimateButton').disabled);h.ctx.persistQuoteDraft();assert.equal(h.store.get('a1_fieldops_quote_draft_v1'),before);await h.submit();assert.equal(h.requests.filter(p=>p.action==='save_estimate').length,0);}finally{release();await loading;}
});

test('a recovery awaiting its job list cannot overwrite a subsequently opened different estimate',async()=>{
 const first=harness();await first.ctx.openEstimateEditor('estimate-one');first.element('#estTitle').value='Recovered first quote';first.ctx.persistQuoteDraft();const recovery=JSON.parse(first.store.get('a1_fieldops_quote_draft_v1'));
 let calls=0,release,entered;const blocked=new Promise(r=>{entered=r;});
 const second=fixture('estimate-two');second.doc.title='Second quote';second.items=[{description:'Second quote line',quantity:1,unit_price:999}];
 const h=harness({recovery,onRequest:async payload=>payload.action==='load_estimate'?{ok:true,json:async()=>structuredClone(payload.id==='estimate-two'?second:fixture())}:null,onLoadJobs:async()=>{if(++calls===2){entered();await new Promise(r=>{release=r;});}}});
 const pending=h.recover();await blocked;await h.ctx.openEstimateEditor('estimate-two');release();await pending;
 assert.equal(h.ctx.editorState().editor.id,'estimate-two');assert.equal(h.element('#estTitle').value,'Second quote');assert.deepEqual(h.rows(),second.items);
});

test('a new remodel proposal cannot replace an existing quote opened while its draft initializes',async()=>{
 let calls=0,release,entered;const blocked=new Promise(r=>{entered=r;});
 const second=fixture('estimate-two');second.doc.title='Second quote';second.items=[{description:'Second quote line',quantity:1,unit_price:999}];
 const h=harness({load:second,onLoadJobs:async()=>{if(++calls===1){entered();await new Promise(r=>{release=r;});}}});h.element('#estCustomerId').value='client-one';
 const pending=h.ctx.A1RemodelBridge.apply({title:'Remodel — New bathroom',description:'Unrelated remodel proposal',items:[{description:'Unrelated remodel line',quantity:1,unit_price:5000}],profile:'construction',difficulty:'moderate',intake:{scope:'Unrelated remodel intake'}});
 await blocked;await h.ctx.openEstimateEditor('estimate-two');release();const applied=await pending;
 assert.equal(applied,false);assert.equal(h.ctx.editorState().editor.id,'estimate-two');assert.equal(h.element('#estTitle').value,'Second quote');assert.deepEqual(h.rows(),second.items);
});

test('recovering a new draft cannot displace an existing editor opened while customers load',async()=>{
 const first=harness();await first.ctx.prefillEstimate('client-one');first.element('#estTitle').value='Unfinished new quote';first.ctx.addEstimateItem('New draft line',1,400);first.ctx.persistQuoteDraft();const recovery=JSON.parse(first.store.get('a1_fieldops_quote_draft_v1'));
 let calls=0,release,entered;const blocked=new Promise(r=>{entered=r;});const second=fixture('estimate-two');second.doc.title='Second quote';second.items=[{description:'Second quote line',quantity:1,unit_price:999}];
 const h=harness({load:second,recovery,onLoadCustomers:async()=>{if(++calls===1){entered();await new Promise(r=>{release=r;});}}});
 const pending=h.recover();await blocked;await h.ctx.openEstimateEditor('estimate-two');release();await pending;
 assert.equal(h.ctx.editorState().editor.id,'estimate-two');assert.equal(h.element('#estTitle').value,'Second quote');assert.deepEqual(h.rows(),second.items);
});


test('historical auto rate stays exact after current rate guidance changes and queued reset sync runs',async()=>{
 const data=fixture();data.estimator_context.fields.estLaborRate='200';const h=harness({load:data});await h.ctx.openEstimateEditor('estimate-one');await Promise.resolve();
 assert.equal(h.element('#estLaborRate').value,'200');assert.equal(h.ctx.A1EstimateLabor.currentLaborRateRanges().service.min,220);assert.equal(h.ctx.captureEstimateContext().fields.estLaborRate,'200');assert.equal(h.rows()[0].unit_price,132.45);
});

test('zero and blank raw labor rates are preserved instead of replaced with pricing guidance',async()=>{
 for(const value of ['0','']){const data=fixture();data.estimator_context.fields.estLaborRate=value;const h=harness({load:data});await h.ctx.openEstimateEditor('estimate-one');await Promise.resolve();assert.equal(h.element('#estLaborRate').value,value);assert.equal(h.ctx.captureEstimateContext().fields.estLaborRate,value);assert.equal(h.rows()[0].unit_price,132.45);}
});

test('discount warning and save guard compare with pre-tax subtotal',async()=>{
 const h=harness();await h.ctx.openEstimateEditor('estimate-one');h.element('#estDiscount').value='385';h.ctx.calcEstimateTotal();assert.match(h.element('#estDiscountWarning').textContent,/can't exceed/);assert.equal(h.element('#estimateTotal').style.color,'#c9202f');await h.submit();assert.equal(h.requests.filter(p=>p.action==='save_estimate').length,0);assert.ok(h.messages.some(m=>/Discount must be between/.test(m[0])));assert.equal(h.element('#saveEstimateButton').disabled,false);
 h.element('#estDiscount').value='21.11';h.ctx.calcEstimateTotal();assert.equal(h.element('#estDiscountWarning').textContent,'');assert.equal(h.ctx.calcEstimateTotal(),376.9);
});

const constructionIntake=()=>({project:'Whole-home remodel',location:'Kitchen and second floor',scope:'Replace kitchen and bathroom plumbing.',conditions:'Occupied home',exclusions:'Tile by others',total:'28500.00'});

test('construction editing restores all intake and saves it when both forms are disabled',async()=>{
 const data=fixture();data.estimator_context.fields.estQuoteMode='remodel';data.estimator_context.construction=constructionIntake();let allDisabled=false;
 const h=harness({load:data,onRequest:async payload=>{if(payload.action==='save_estimate')allDisabled=h.taskControls.every(el=>el.disabled);}});await h.ctx.openEstimateEditor('estimate-one');assert.deepEqual(plain(h.ctx.captureEstimateContext().construction),constructionIntake());await h.submit();const payload=h.requests.at(-1);assert.equal(allDisabled,true);assert.deepEqual(payload.estimator_context.construction,constructionIntake());assert.equal(payload.estimator_context.fields.estQuoteMode,'remodel');assert.equal(payload.estimate_id,'estimate-one');assert.deepEqual(payload.items,data.items);
});

test('construction recovery retains intake, manually chosen rate and the existing update target',async()=>{
 const data=fixture();data.estimator_context.fields.estQuoteMode='remodel';data.estimator_context.construction=constructionIntake();const first=harness({load:data});await first.ctx.openEstimateEditor('estimate-one');first.element('#estLaborRate').value='245';first.ctx.persistQuoteDraft();const saved=JSON.parse(first.store.get('a1_fieldops_quote_draft_v1'));
 const h=harness({load:data,recovery:saved});await h.recover();assert.deepEqual(plain(h.ctx.captureEstimateContext().construction),constructionIntake());assert.equal(h.element('#estLaborRate').value,'245');await h.submit();assert.equal(h.requests.at(-1).estimate_id,'estimate-one');assert.deepEqual(h.requests.at(-1).estimator_context.construction,constructionIntake());assert.equal(h.requests.at(-1).estimator_context.fields.estLaborRate,'245');
});

test('a late successful save cannot close or clear a newer existing estimate editor',async()=>{
 let release,entered;const blocked=new Promise(r=>{entered=r;});const second=fixture('estimate-two');second.doc.title='Second quote';second.items=[{description:'Second quote line',quantity:1,unit_price:999}];
 const h=harness({onRequest:async payload=>{if(payload.action==='save_estimate'){entered();await new Promise(r=>{release=r;});return {ok:true,json:async()=>({id:'estimate-one'})};}if(payload.action==='load_estimate')return {ok:true,json:async()=>structuredClone(payload.id==='estimate-two'?second:fixture())};}});
 await h.ctx.openEstimateEditor('estimate-one');const pending=h.submit();await blocked;await h.ctx.openEstimateEditor('estimate-two');release();await pending;assert.equal(h.ctx.editorState().editor.id,'estimate-two');assert.equal(h.element('#estTitle').value,'Second quote');assert.deepEqual(h.rows(),second.items);assert.equal(h.form.style.display,'grid');assert.equal(h.element('#saveEstimateButton').disabled,false);assert.equal(h.opened.length,0);
});


test('repeated labor sync keeps a historical manual rate inside native input bounds',async()=>{
 const h=harness();await h.ctx.openEstimateEditor('estimate-one');for(let i=0;i<3;i++){h.ctx.A1EstimateLabor.sync();assert.equal(h.element('#estLaborRate').value,'215');assert.ok(Number(h.element('#estLaborRate').min)<=215);assert.ok(Number(h.element('#estLaborRate').max)>=215);}
 h.element('#estLaborRate').value='320';h.ctx.A1EstimateLabor.sync();assert.equal(h.element('#estLaborRate').value,'320');assert.ok(Number(h.element('#estLaborRate').max)>=320);
});

test('a delayed rate-settings response does not make a restored rate invalid',async()=>{
 let release;const h=harness({onRangeLoad:()=>new Promise(r=>{release=r;})});await h.ctx.openEstimateEditor('estimate-one');assert.equal(h.element('#estLaborRate').value,'215');release();await new Promise(setImmediate);
 assert.equal(h.ctx.A1EstimateLabor.currentLaborRateRanges().service.min,220);assert.equal(h.element('#estLaborRate').value,'215');assert.ok(Number(h.element('#estLaborRate').min)<=215);assert.ok(Number(h.element('#estLaborRate').max)>=215);
});
