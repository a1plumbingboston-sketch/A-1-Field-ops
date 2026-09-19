import {uuid,clean} from './db.js';

const numericFields={estLaborRate:100000,estLaborHours:10000,estMaterialCost:10000000,estMarkup:1000,estContingency:100};
const fieldsAllowed=new Set(['estQuoteMode','estPricingMode','estZip','estLaborRate',...Object.keys(numericFields),...Array.from({length:9},(_,i)=>'estDescriptionQuestion'+i)]);
const constructionLimits={project:300,location:240,scope:16000,conditions:2400,exclusions:2400,total:100};
function constructionContext(raw){
 if(raw==null)return null;
 if(typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid construction intake');
 const intake={};
 for(const [field,max]of Object.entries(constructionLimits)){
  const value=raw[field]??'';
  if(!['string','number'].includes(typeof value))throw new Error('Invalid construction intake field');
  const text=String(value).replace(/[\u0000]/g,'');
  if(text.length>max)throw new Error('Construction '+field+' is too long');
  if(field==='total'&&text!==''&&(!Number.isFinite(Number(text))||Number(text)<0||Number(text)>10000000))throw new Error('Enter a construction total between $0 and $10,000,000');
  intake[field]=text;
 }
 return intake;
}
function safeJson(value,depth=0){
 if(depth>8)throw new Error('Estimator details are too deeply nested');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='string'){if(value.length>8000)throw new Error('Estimator detail is too long');return value.replace(/[\u0000]/g,'');}
 if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Estimator details contain an invalid number');return value;}
 if(Array.isArray(value)){if(value.length>100)throw new Error('Too many estimator details');return value.map(v=>safeJson(v,depth+1));}
 if(value&&typeof value==='object'){
  if(Object.keys(value).length>150)throw new Error('Too many estimator details');
  return Object.fromEntries(Object.entries(value).map(([key,v])=>{if(['__proto__','prototype','constructor'].includes(key)||key.length>100)throw new Error('Invalid estimator detail');return [key,safeJson(v,depth+1)];}));
 }
 throw new Error('Invalid estimator details');
}
export function estimatorContext(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||!raw.fields||typeof raw.fields!=='object'||Array.isArray(raw.fields))throw new Error('Estimator details are missing. Reopen this quote before saving.');
 const fields={};
 for(const [key,value]of Object.entries(raw.fields)){
  if(!fieldsAllowed.has(key))continue;
  if(!['string','number'].includes(typeof value))throw new Error('Invalid estimator field');
  const text=String(value);if(text.length>800)throw new Error('Estimator field is too long');
  if(key in numericFields&&text!==''&&(!Number.isFinite(Number(text))||Number(text)<0||Number(text)>numericFields[key]))throw new Error('Check the labor, material cost and markup inputs.');
  fields[key]=text.replace(/[\u0000]/g,'');
 }
 if(fields.estQuoteMode&&!['service','remodel'].includes(fields.estQuoteMode))throw new Error('Choose Service or Remodel pricing');
 if(fields.estPricingMode&&!['per_task','hourly'].includes(fields.estPricingMode))throw new Error('Choose per-task or hourly pricing');
 // Preserve the owner's entered rate. Current profile settings guide new estimates,
 // but reopening or saving an existing quote must not replace its stored input.
 const context={version:1,fields,construction:constructionContext(raw.construction),remodel:raw.remodel==null?null:safeJson(raw.remodel)};
 if(context.remodel!==null&&(typeof context.remodel!=='object'||Array.isArray(context.remodel)))throw new Error('Invalid remodel intake');
 if(Buffer.byteLength(JSON.stringify(context),'utf8')>60000)throw new Error('Estimator details are too large');
 return context;
}
export function estimateSaveInput(raw={}){
 if(!uuid(raw.request_id)||!uuid(raw.customer_id)||(raw.estimate_id!=null&&!uuid(raw.estimate_id))||(raw.job_id!=null&&!uuid(raw.job_id)))throw new Error('Choose a valid customer and job');
 if(raw.estimate_id&&!/^[a-f0-9]{32}$/.test(String(raw.expected_revision||'')))throw new Error('Reopen this quote to load its current revision before saving.');
 const title=clean(raw.title,301);if(!title||title.length>300)throw new Error('Enter a quote title of 300 characters or less');
 if(String(raw.description||'').length>20000)throw new Error('Scope description is too long');
 if(raw.notes!==undefined&&String(raw.notes||'').length>12000)throw new Error('Notes are too long');
 if(!Array.isArray(raw.items)||raw.items.length<1||raw.items.length>100)throw new Error('Enter 1–100 valid line items');
 const items=raw.items.map(item=>{
  const description=clean(item?.description,501),quantity=Number(item?.quantity),unit_price=Number(item?.unit_price);
  if(!description||description.length>500||!Number.isFinite(quantity)||quantity<=0||quantity>1000000||!Number.isFinite(unit_price)||Math.abs(unit_price)>1000000000||(unit_price<0&&(description!=='Discount'||quantity!==1))||Math.abs(quantity*unit_price)>1000000000)throw new Error('Enter valid line-item descriptions, quantities and prices');
  return {description,quantity,unit_price};
 });
 return {p_estimate_id:raw.estimate_id||null,p_request_id:raw.request_id,p_expected_revision:raw.estimate_id?raw.expected_revision:null,p_customer_id:raw.customer_id,p_job_id:raw.job_id||null,p_title:title,p_description:String(raw.description||'').replace(/[\u0000]/g,''),p_notes:raw.notes===undefined?null:String(raw.notes||'').replace(/[\u0000]/g,''),p_items:items,p_estimator_context:estimatorContext(raw.estimator_context)};
}
