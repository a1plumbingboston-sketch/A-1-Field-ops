import {laborRateForDifficulty} from './estimate-labor.js';
export const PHASES = ['Preparation & protection', 'Rough-in plumbing', 'Fixture installation & testing', 'Coordination & return visits'];
const text = (v, max=2400) => String(v ?? '').trim().slice(0,max);
function amount(v, name, max, optional=false) {
  if(optional && (v==='' || v===null || v===undefined)) return null;
  if(typeof v==='boolean' || (typeof v!=='number' && typeof v!=='string')) throw Error(`Enter a valid ${name}.`);
  const n=Number(v); if(!Number.isFinite(n)||n<0||n>max) throw Error(`Enter ${name} between 0 and ${max}.`);
  return n;
}
export function remodelInput(v={}) {
  if(!v || typeof v!=='object') throw Error('Complete the remodel details.');
  const x={};
  for(const key of ['project','scope','location','fixtures','layout','conditions','responsibilities','permits','schedule','exclusions']) x[key]=text(v[key]);
  if(x.scope.length<15) throw Error('Describe the remodel scope, including the rooms and fixtures.');
  Object.assign(x,laborRateForDifficulty(v.difficulty));
  x.markup=amount(v.markup,'material markup',100);
  x.fees=amount(v.fees,'permit and outside costs',100000,true);
  x.phases=PHASES.map((name,i)=>({name,hours:amount(v.phases?.[i]?.hours,`${name} hours`,1000,true),materials:amount(v.phases?.[i]?.materials,`${name} material cost`,100000,true)}));
  return x;
}
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
export function priceRemodel(input, draft) {
  const x=remodelInput(input);
  if(!draft || !Array.isArray(draft.phases)||draft.phases.length!==4 || !text(draft.summary)) throw Error('The remodel draft is incomplete. Generate it again.');
  const checks=[];
  if(x.provisional) checks.push('Confirm the job difficulty on site.');
  for(const key of ['location','fixtures','layout','conditions','responsibilities','permits']) if(!x[key]) checks.push(`Confirm ${key}.`);
  const phases=x.phases.map((phase,i)=>{
    const ai=draft.phases[i];
    const suggested=amount(ai.hours,'AI labor hours',1000);
    const hours=phase.hours ?? suggested;
    if(phase.hours===null) checks.push(`Confirm ${phase.name.toLowerCase()}: ${hours} AI-estimated hours.`);
    if(phase.materials===null) checks.push(`Price materials for ${phase.name.toLowerCase()} (currently excluded).`);
    const labor=money(hours*x.rate), materials=money((phase.materials??0)*(1+x.markup/100));
    return {...phase,hours,labor,materials,total:money(labor+materials),description:text(ai.description,300)||phase.name,reason:text(ai.reason,600)};
  });
  if(x.fees===null) checks.push('Confirm permit and outside costs (currently excluded).');
  checks.push(...(Array.isArray(draft.questions)?draft.questions:[]).map(q=>text(q,400)).filter(Boolean));
  const items=phases.filter(p=>p.total>0).map(p=>({description:p.description,quantity:1,unit_price:p.total}));
  if(x.fees>0)items.push({description:'Permit and outside costs — allowance',quantity:1,unit_price:money(x.fees)});
  const total=money(items.reduce((n,i)=>n+i.unit_price,0));
  if(total<=0) throw Error('Add labor hours or material costs before creating a quote.');
  const exclusions=[x.exclusions,...(Array.isArray(draft.exclusions)?draft.exclusions:[])].map(s=>text(s,600)).filter(Boolean);
  const isBudget=checks.length>0;
  const description=[`Remodel ${isBudget?'budget estimate':'proposed scope'}: ${text(draft.summary,800)}`,isBudget?'Budget only; unresolved scope and allowances require confirmation before a fixed-price agreement.':'',exclusions.length?'Exclusions: '+[...new Set(exclusions)].join('; '):'','Changes to scope or concealed conditions require a separately priced change order approved before additional work.'].filter(Boolean).join('\n\n');
  return {phases,items,total,rate:x.rate,checks:[...new Set(checks)],description,isBudget};
}
