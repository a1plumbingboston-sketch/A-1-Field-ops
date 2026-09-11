export function completionNotes(value){
 const fields=[['location','Work location',200],['performed','Work performed',1000],['materials','Materials / quantities / who supplied them',700],['checks','Checks performed and results',700],['outcome','Outcome and outstanding work',500]];
 if(!value||typeof value!=='object')throw Error('Complete the work checklist before submitting.');
 return fields.map(([key,label,max])=>{const text=String(value[key]??'').trim();if(!text)throw Error(`${label} is required. Use “None” or “Not performed” where appropriate.`);if(text.length>max)throw Error(`${label} is too long (maximum ${max} characters).`);return `${label}: ${text}`;}).join('\n');
}

// Owner-approved reports only, looked up through the saved invoice's job relation.
export async function reviewedInvoiceWork(invoiceId){
 const {db,uuid}=await import('./db.js');
 if(!uuid(invoiceId))return {manager_notes:'',technician_reports:''};
 const invoices=await db(`invoices?id=eq.${invoiceId}&select=job_id&limit=1`);
 if(!uuid(invoices[0]?.job_id))return {manager_notes:'',technician_reports:''};
 const jobs=await db(`jobs?id=eq.${invoices[0].job_id}&select=title,notes&limit=1`);
 const appointments=await db(`fieldops_appointments?job_id=eq.${invoices[0].job_id}&status=eq.completed&select=id&order=starts_at.desc&limit=10`);
 const notes=[];
 for(const a of appointments){const events=await db(`fieldops_team_events?appointment_id=eq.${a.id}&kind=eq.status&select=text,created_at&order=created_at.desc&limit=30`);const review=events.find(e=>e.text.startsWith('review:'));if(review)notes.push(review.text.replace(/^review:\s*Work location:[^\n]*\n/,'').slice(0,3800));}
 return {manager_notes:[jobs[0]?.title,jobs[0]?.notes].filter(Boolean).join('\n').slice(0,3000),technician_reports:notes.join('\n\n').slice(0,12000)};
}
