import {laborRateForDifficulty} from '../estimate-labor.js';
const clean=(v,max)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);
export function estimateInput(raw={}){
 const x={title:clean(raw.title,300),description:clean(raw.description,6000),location:clean(raw.location||'Woburn, Massachusetts',160),pricing_mode:raw.pricing_mode==='hourly'?'hourly':'per_task',allocation_mode:raw.allocation_mode===true};
 if(!x.title&&!x.description)throw new Error('Describe the job before requesting AI guidance.');
 const manualLaborRate=raw.labor_rate!==undefined&&raw.labor_rate!==null&&String(raw.labor_rate).trim()!=='';
 for(const [key,max,fallback] of [['labor_hours',10000,0],['labor_rate',100000,0],['material_cost',10000000,0],['markup_pct',1000,25],['contingency_pct',100,0]]){
  const n=Number(raw[key]??fallback);if(!Number.isFinite(n)||n<0||n>max)throw new Error('Check the labor, material cost and markup inputs.');x[key]=n;
 }
 const labor=laborRateForDifficulty(raw.job_difficulty);x.job_difficulty=labor.difficulty;if(!manualLaborRate)x.labor_rate=labor.rate;x.labor_rate_provisional=!manualLaborRate;
 return x;
}
export function estimateLineItemTarget(input){
 const cents=n=>Math.round((Number(n)+Number.EPSILON)*100);
 const labor=cents(input.labor_hours*input.labor_rate),materials=cents(input.material_cost*(1+input.markup_pct/100));
 const fittings=cents(input.material_cost*input.contingency_pct/100*(1+input.markup_pct/100));
 return (labor+materials+fittings)/100;
}
export function reconcileEstimateTotal(analysis,target){
 const targetCents=Math.round(Number(target)*100);if(!Number.isFinite(targetCents)||targetCents<0)throw new Error('The target estimate total is invalid.');
 const items=analysis.recommended_line_items;if(!items.length)throw new Error('AI did not provide line items to organize.');
 const weights=items.map(i=>Math.max(0,Math.round(Number(i.price)*100))),weightTotal=weights.reduce((n,v)=>n+v,0)||items.length;
 const floors=weights.map(w=>Math.floor(targetCents*((weightTotal===items.length&&!weights.some(Boolean))?1:w)/weightTotal));
 let remaining=targetCents-floors.reduce((n,v)=>n+v,0);
 const order=items.map((_,i)=>i).sort((a,b)=>{
  const wa=(weightTotal===items.length&&!weights.some(Boolean))?1:weights[a],wb=(weightTotal===items.length&&!weights.some(Boolean))?1:weights[b];
  return (targetCents*wb/weightTotal-floors[b])-(targetCents*wa/weightTotal-floors[a]);
 });
 for(let i=0;i<remaining;i++)floors[order[i%order.length]]++;
 const recommended_line_items=items.map((item,i)=>({...item,quantity:1,unit_price:floors[i]/100,price:floors[i]/100,reason:clean(item.reason,650)}));
 return {...analysis,recommended_total:targetCents/100,recommended_line_items};
}
export function relevantPrices(rows,input){
 const ignored=new Set(['the','and','for','with','from','this','that','have','need','customer','supplied']);
 const words=new Set(((input.title+' '+input.description).toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(w=>!ignored.has(w)));
 return rows.map(r=>({r,score:[...words].filter(w=>(r.name+' '+r.description+' '+r.category).toLowerCase().includes(w)).length})).filter(x=>x.score>0&&Number.isFinite(Number(x.r.unit_price))&&Number(x.r.unit_price)>=0&&Number.isFinite(Number(x.r.quantity))&&Number(x.r.quantity)>0).sort((a,b)=>b.score-a.score).slice(0,15).map(({r})=>({name:clean(r.name,160),description:clean(r.description,500),quantity:Number(r.quantity),unit_price:Number(r.unit_price)}));
}
export function validateEstimate(a){
 if(!a||!Array.isArray(a.recommended_line_items)||!a.recommended_line_items.length||a.recommended_line_items.length>50)throw new Error('AI did not provide a usable itemized estimate. Please try again.');
 const items=a.recommended_line_items.map(i=>{
  if(!i||typeof i.description!=='string'||!i.description.trim()||typeof i.quantity!=='number'||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>1000000||typeof i.unit_price!=='number'||!Number.isFinite(i.unit_price)||i.unit_price<0||i.unit_price>10000000)throw new Error('AI returned invalid line-item pricing. Please try again.');
  if(/\b(truck\s*(fee|charge|roll)|dispatch\s*(fee|charge)|mobilization|service[- ]call\s*(fee|charge))\b/i.test(i.description))throw new Error('AI included a separate call fee. Please retry; FieldOps adds your $75 truck fee automatically.');
  const unit_price=Math.round(i.unit_price*100)/100;
  return {description:clean(i.description,500).replace(/\bcontingency(?:\s+fittings)?\b/gi,'Misc fittings'),quantity:i.quantity,unit_price,price:Math.round(i.quantity*unit_price*100)/100,reason:clean(i.reason,700)};
 });
 const sources=(Array.isArray(a.sources)?a.sources:[]).slice(0,8).flatMap(s=>{try{const u=new URL(s.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return [];return [{title:clean(s.title,200)||u.hostname,url:u.href}];}catch{return [];}});
 const market={};for(const k of ['market_low','market_typical','market_high'])market[k]=sources.length&&typeof a[k]==='number'&&Number.isFinite(a[k])&&a[k]>=0&&a[k]<=100000000?a[k]:null;
 if(market.market_low!==null&&market.market_high!==null&&market.market_low>market.market_high)for(const k in market)market[k]=null;
 return {...market,recommended_total:Math.round(items.reduce((n,i)=>n+i.price,0)*100)/100,summary:clean(a.summary,3000),risks:(Array.isArray(a.risks)?a.risks:[]).filter(x=>typeof x==='string').slice(0,12).map(x=>clean(x,500)),recommended_line_items:items,sources};
}
const price={type:['number','null']};
export const estimateSchema={type:'object',additionalProperties:false,properties:{market_low:price,market_typical:price,market_high:price,recommended_total:{type:'number'},summary:{type:'string'},risks:{type:'array',items:{type:'string'}},recommended_line_items:{type:'array',items:{type:'object',additionalProperties:false,properties:{description:{type:'string'},quantity:{type:'number'},unit_price:{type:'number'},price:{type:'number'},reason:{type:'string'}},required:['description','quantity','unit_price','price','reason']}},sources:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},url:{type:'string'}},required:['title','url']}}},required:['market_low','market_typical','market_high','recommended_total','summary','risks','recommended_line_items','sources']};
