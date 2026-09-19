import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pricingCode=html.slice(html.indexOf('function withTruckFee('),html.indexOf("$('#quickCalcBtn').onclick=quickEstimator;"));
const eventsCode=html.slice(html.indexOf('const aiEstimateInputIds='),html.indexOf('const quoteDraftStorageKey='));
const baseline=()=>({pricing_mode:'per_task',title:'Replace two fixtures',description:'Customer supplied fixtures, normal access.',location:'North Shore',labor_hours:2,labor_rate:225,job_difficulty:'moderate',material_cost:100,markup_pct:25,contingency_pct:10});
function harness(){
 const elements=new Map(),events=new Map();let rows=[{description:'Existing draft',quantity:1,unit_price:999}],saves=0;
 const element=id=>{if(!elements.has(id)){
  const e={value:'',style:{},textContent:'',addEventListener(type,callback){events.set(type,callback);}};
  let markup='';Object.defineProperty(e,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='#estimateItems')rows=[];}});elements.set(id,e);
 }return elements.get(id);};
 element('#estCustomerId').value='client-one';element('#estJobId').value='job-one';element('#estQuoteMode').value='service';
 const ctx=vm.createContext({$:element,document:{querySelectorAll(){return ctx.selected.map(value=>({value:String(value)}));},querySelector(){return ctx.selected.length?{}:null;}},quoteSaveRequestId:'draft-one',input:baseline(),selected:[0,1],estimatorInputs:()=>structuredClone(ctx.input),money:n=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'}),addEstimateItem:(description,quantity,unit_price)=>rows.push({description,quantity,unit_price}),calcEstimateTotal:()=>rows.reduce((sum,i)=>sum+Math.round(i.quantity*i.unit_price*100)/100,0),persistQuoteDraft:()=>{saves++;}});
 vm.runInContext(pricingCode+eventsCode+`\nfunction seed(){aiQuoteSuggestions=withTruckFee([{description:'Replace customer-supplied fixture',quantity:2,unit_price:225}]);aiQuoteContext=currentAiQuoteContext();}\n`,ctx);
 return {ctx,element,events,rows:()=>rows,saves:()=>saves,seed:()=>vm.runInContext('seed()',ctx)};
}

test('materials-only fittings allowance never raises labor-only prices at any difficulty',()=>{
 const {ctx}=harness();
 for(const rate of [200,225,250]){
  const result=ctx.estimatePricingBreakdown({...baseline(),labor_hours:1,labor_rate:rate,material_cost:0});
  assert.equal(result.fittingsSell,0);assert.equal(result.labor,rate);assert.equal(result.total,rate+75);
 }
});

test('raw materials and fittings are marked up once, with one truck fee and unchanged labor',()=>{
 const {ctx}=harness();
 const a=ctx.estimatePricingBreakdown({...baseline(),labor_rate:200});
 assert.equal(a.labor,400);assert.equal(a.materialSell,125);assert.equal(a.fittingsSell,12.5);assert.equal(a.total,612.5);
 const b=ctx.estimatePricingBreakdown({...baseline(),labor_rate:200,markup_pct:0});
 assert.equal(b.materialSell,100);assert.equal(b.fittingsSell,10);assert.equal(b.total,585);
 const c=ctx.estimatePricingBreakdown({...baseline(),labor_rate:200,contingency_pct:0});
 assert.equal(c.fittingsSell,0);assert.equal(c.total,600);
});

test('applying selected fixed tasks preserves per-unit prices, quantities and exactly one truck fee',()=>{
 const h=harness();h.seed();h.ctx.applyAiQuote();
 assert.deepEqual(h.rows(),[{description:'Replace customer-supplied fixture',quantity:2,unit_price:225},{description:'Truck fee',quantity:1,unit_price:75}]);
 assert.equal(h.ctx.calcEstimateTotal(),525);assert.equal(h.saves(),1);
 h.ctx.applyAiQuote();assert.equal(h.rows().filter(i=>i.description==='Truck fee').length,1);assert.equal(h.ctx.calcEstimateTotal(),525);
});

test('changing pricing mode, scope or cost inputs blocks applying an old recommendation',()=>{
 const patches=[{pricing_mode:'hourly'},{title:'Different project'},{description:'Added concealed piping repairs'},{location:'Another city'},{labor_hours:4},{labor_rate:250,job_difficulty:'difficult'},{material_cost:900},{markup_pct:40},{contingency_pct:0}];
 for(const patch of patches){const h=harness();h.seed();Object.assign(h.ctx.input,patch);h.ctx.applyAiQuote();assert.equal(h.rows()[0].description,'Existing draft');assert.equal(h.saves(),0);assert.match(h.element('#aiEstimatePanel').innerHTML,/changed/);}
});

test('switching client, job, quote kind or draft cannot receive another context’s AI lines',()=>{
 for(const id of ['#estCustomerId','#estJobId','#estQuoteMode','draft']){
  const h=harness();h.seed();if(id==='draft')h.ctx.quoteSaveRequestId='draft-two';else h.element(id).value='different';h.ctx.applyAiQuote();
  assert.equal(h.rows()[0].description,'Existing draft');assert.equal(h.saves(),0);
 }
});

test('all scope questions and selection changes invalidate visible AI results; discounts do not',()=>{
 const ids=['estQuoteMode','estCustomerId','estJobId','estTitle','estDescription','estPricingMode','estZip','estLaborHours','estLaborRate','estMaterialCost','estMarkup','estContingency','estDescriptionQuestion8'];
 for(const event of ['input','change'])for(const id of ids){
  const h=harness();h.seed();h.events.get(event)({target:{id}});h.ctx.applyAiQuote();assert.equal(h.saves(),0,`${event}: ${id}`);
 }
 const h=harness();h.seed();h.events.get('input')({target:{id:'estDiscount'}});h.ctx.applyAiQuote();assert.equal(h.saves(),1);
});

test('Quick Price Check shows the same itemized allowance and total as inline guidance',()=>{
 const h=harness();h.ctx.quickEstimator();const panel=h.element('#aiEstimatePanel').innerHTML;
 assert.match(panel,/Misc\. fittings allowance/);assert.match(panel,/\$12\.50/);assert.match(panel,/\$662\.50/);
 h.events.get('change')({target:{id:'estMaterialCost'}});assert.match(h.element('#estimateMargin').textContent,/\$662\.50/);
 h.ctx.input.labor_hours=0;h.ctx.input.material_cost=0;h.events.get('input')({target:{id:'estMaterialCost'}});assert.equal(h.element('#estimateMargin').textContent,'');
});
