export const PHASES = ['Preparation & protection', 'Rough-in plumbing', 'Fixture installation & testing', 'Coordination & return visits'];
const text = (v, max=4000) => String(v ?? '').trim().slice(0,max);
function amount(v, name, max, optional=false) {
  if(optional && (v==='' || v===null || v===undefined)) return null;
  if(typeof v==='boolean' || (typeof v!=='number' && typeof v!=='string')) throw Error(`Enter a valid ${name}.`);
  const n=Number(v); if(!Number.isFinite(n)||n<0||n>max) throw Error(`Enter ${name} between 0 and ${max}.`);
  return n;
}
export function remodelInput(v={}) {
  if(!v || typeof v!=='object') throw Error('Complete the remodel details.');
  const x={};
  for(const key of ['project','scope','location','contractorMaterials','customerMaterials','conditions','responsibilities','permits','schedule','exclusions']) x[key]=text(v[key]);
  if(x.scope.length<15) throw Error('Describe the remodel scope, including the rooms and work involved.');
  x.laborRate=amount(v.laborRate ?? v.rate,'hourly labor rate',5000);
  x.laborHours=amount(v.laborHours,'labor hours',5000);
  x.materialCost=amount(v.materialCost,'A-1 material cost',1000000,true);
  x.markup=amount(v.markup,'material markup',100);
  x.fees=amount(v.fees,'permit and outside costs',100000,true);
  return x;
}
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
export function priceRemodel(input, draft=null) {
  const x=remodelInput(input),checks=[];
  if(x.materialCost===null) checks.push('Confirm the cost of materials supplied by A-1 (currently excluded).');
  if(x.fees===null) checks.push('Confirm permit and outside costs (currently excluded).');
  const labor=money(x.laborHours*x.laborRate);
  const materials=money((x.materialCost??0)*(1+x.markup/100));
  const items=[];
  if(labor>0) items.push({description:`Labor — ${x.laborHours} hours at $${x.laborRate}/hour`,quantity:1,unit_price:labor});
  if(materials>0) items.push({description:'Materials supplied by A-1 (including markup)',quantity:1,unit_price:materials});
  if(x.fees>0) items.push({description:'Permit and outside costs — allowance',quantity:1,unit_price:money(x.fees)});
  const total=money(items.reduce((n,i)=>n+i.unit_price,0));
  if(total<=0) throw Error('Add labor hours or material costs before creating a quote.');
  const aiSummary=text(draft?.summary,800);
  const sections=[
    `Scope of Work — ${x.project||'Remodel'}`,
    aiSummary||x.scope,
    x.contractorMaterials?`Materials supplied by A-1:\n${x.contractorMaterials}`:'',
    x.customerMaterials?`Materials supplied by customer:\n${x.customerMaterials}`:'',
    x.responsibilities?`Responsibilities:\n${x.responsibilities}`:'',
    x.exclusions?`Exclusions:\n${x.exclusions}`:'',
    'Changes to scope or concealed conditions require a separately priced change order approved before additional work.'
  ].filter(Boolean);
  return {items,total,rate:x.laborRate,laborHours:x.laborHours,labor,materials,checks,description:sections.join('\n\n'),isBudget:checks.length>0};
}
