export function validateDelivery(to){
 if(!process.env.RESEND_API_KEY||!process.env.FIELDOPS_FROM_EMAIL)throw new Error('Email delivery is not configured. Add the email key and verified sender in Vercel, then redeploy.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to||'').trim()))throw new Error('Add a valid customer email address before sending.');
}
export async function sendMail({to,subject,html,pdf,filename}){
 validateDelivery(to);
 let r;
 try{r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.FIELDOPS_FROM_EMAIL,to:[to.trim()],reply_to:process.env.FIELDOPS_REPLY_TO||'a1plumbingboston@gmail.com',subject,html,attachments:[{filename,content:pdf.toString('base64')}]})});}
 catch{throw new Error('Email confirmation could not be received. Check email activity before retrying to avoid a duplicate.');}
 const j=await r.json().catch(()=>null);
 if(!r.ok)throw new Error(r.status===401||r.status===403?'Email provider rejected the request. Check the email key and verified sender.':'Email provider could not accept the document. Check email activity before retrying.');
 if(!j?.id)throw new Error('Email confirmation is incomplete. Check email activity before retrying to avoid a duplicate.');
 return j;
}
