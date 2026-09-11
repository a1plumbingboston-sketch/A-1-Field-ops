// Deterministic arithmetic: AI explains these results, never calculates the rate.
export const fields={technicians:[0.1,1000],wage:[0,10000],paidHours:[1,8760],burden:[0,100],billableHours:[1,8760],overhead:[0,100000000],ownerPay:[0,100000000],debtPrincipal:[0,100000000],margin:[0,80],currentRate:[0,100000]};
export function hourlyCost(raw){
 const x={};for(const [key,[min,max]] of Object.entries(fields)){
  if(raw[key]===null||raw[key]===undefined||raw[key]===''||typeof raw[key]==='boolean')throw new Error('Complete every calculator field; enter 0 only when confirmed.');
  x[key]=Number(raw[key]);if(!Number.isFinite(x[key])||x[key]<min||x[key]>max)throw new Error('Check calculator value: '+key);
 }
 if(x.billableHours>x.paidHours)throw new Error('Billable hours cannot exceed paid hours per technician.');
 const annualLabor=x.technicians*x.wage*x.paidHours*(1+x.burden/100),annualOverhead=12*x.overhead,annualOwnerPay=12*x.ownerPay,annualHours=x.technicians*x.billableHours;
 const operatingCost=annualLabor+annualOverhead+annualOwnerPay,breakEven=operatingCost/annualHours;
 const targetRate=breakEven/(1-x.margin/100),cashCoverageRate=(operatingCost+12*x.debtPrincipal)/annualHours;
 return {inputs:x,annualLabor,annualOverhead,annualOwnerPay,annualHours,operatingCost,breakEven,targetRate,cashCoverageRate,currentRate:x.currentRate,utilization:100*x.billableHours/x.paidHours,annualRateGap:(x.currentRate-breakEven)*annualHours};
}
