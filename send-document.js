import crypto from 'crypto';
const SUPABASE_URL=process.env.SUPABASE_URL||'https://dddthwakdrxxmjbfowpl.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_f3QAMeX2YKuyeOI3WMkhng_9LdWdL7O';
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY=process.env.RESEND_API_KEY;
const FROM_EMAIL=process.env.FIELDOPS_FROM_EMAIL;
const REPLY_TO=process.env.FIELDOPS_REPLY_TO||'a1plumbingboston@gmail.com';
const PUBLIC_URL=process.env.FIELDOPS_PUBLIC_URL||'';
const clean=(v,n=500)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);
const money=v=>`$${Number(v||0).toFixed(2)}`;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function verifyFieldOpsKey(key){
  if(!key)return false;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/fieldops_key_status`,{method:'POST',headers:{apikey:PUBLISHABLE_KEY,'Content-Type':'application/json','x-fieldops-key':key},body:'{}'});
  return r.ok&&(await r.json().catch(()=>false))===true;
}
async function sb(path){
  if(!SERVICE_KEY)throw new Error('Server database access is not configured');
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}});
  const j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||'Could not load FieldOps document');
  return j;
}
async function sbWrite(path,{method='POST',body,prefer='return=representation'}={}){
  if(!SERVICE_KEY)throw new Error('Server database access is not configured');
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json',Prefer:prefer},body:JSON.stringify(body)});
  const t=await r.text();const j=t?JSON.parse(t):null;
  if(!r.ok)throw new Error(j?.message||'Could not update FieldOps document');
  return j;
}
function wrap(text,max=76){
  const words=clean(text,2400).split(/\s+/).filter(Boolean), lines=[];let line='';
  for(const w of words){const n=line?line+' '+w:w;if(n.length>max){if(line)lines.push(line);line=w}else line=n;}if(line)lines.push(line);return lines;
}
function pdfEscape(s){return String(s??'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[^\x20-\x7E]/g,'');}
function buildPdf({kind,doc,customer,items,payments}){
  const isEstimate=kind==='estimate';
  const num=isEstimate?doc.estimate_number:doc.invoice_number;
  const title=isEstimate?'ESTIMATE':'INVOICE';
  const total=Number(doc.total||0);const paid=(payments||[]).filter(p=>String(p.status||'').toLowerCase()!=='failed').reduce((a,p)=>a+Number(p.amount||0),0);const balance=Math.max(0,total-paid);
  const lines=[];let y=750;
  const text=(x,yy,size,txt,bold=false)=>lines.push(`BT /F${bold?2:1} ${size} Tf ${x} ${yy} Td (${pdfEscape(txt)}) Tj ET`);
  const rule=(yy)=>lines.push(`0.85 0.10 0.14 RG 42 ${yy} m 570 ${yy} l S`);
  text(42,y,19,'A-1 Plumbing & Heating Co.',true); y-=22;text(42,y,9,'Licensed & Insured - Residential + Commercial - Plumbing, Heating & HVAC'); y-=28;rule(y);y-=34;
  text(42,y,24,title,true);text(470,y,12,`#${num||''}`,true);y-=20;text(42,y,9,new Date(doc.created_at||Date.now()).toLocaleDateString('en-US'));y-=28;
  text(42,y,10,'CUSTOMER',true);y-=16;text(42,y,10,clean(customer.name||''));y-=14;if(customer.address){text(42,y,9,clean(customer.address));y-=13;}const csz=[customer.city,customer.state,customer.zip].filter(Boolean).join(', ').replace(', ,',',');if(csz){text(42,y,9,clean(csz));y-=13;}if(customer.email){text(42,y,9,clean(customer.email));y-=13;}y-=14;
  text(42,y,10,isEstimate?'SCOPE OF WORK':'WORK DESCRIPTION',true);y-=17;for(const ln of wrap(doc.description||doc.title||'',88).slice(0,7)){text(42,y,9,ln);y-=13;}y-=15;
  text(42,y,9,'DESCRIPTION',true);text(390,y,9,'QTY',true);text(450,y,9,'UNIT PRICE',true);text(535,y,9,'AMOUNT',true);y-=10;lines.push(`0.2 G 42 ${y} m 570 ${y} l S`);y-=16;
  for(const it of items.slice(0,18)){
    const desc=wrap(it.description||'',54);text(42,y,9,desc[0]||'');text(395,y,9,String(Number(it.quantity||1)));text(450,y,9,money(it.unit_price));text(525,y,9,money(it.line_total??(Number(it.quantity||1)*Number(it.unit_price||0))));y-=14;
    for(const extra of desc.slice(1,2)){text(42,y,8,extra);y-=12;}if(y<170)break;
  }
  y-=12;lines.push(`0.2 G 350 ${y} m 570 ${y} l S`);y-=22;text(390,y,10,'Subtotal');text(515,y,10,money(doc.subtotal||total),true);y-=18;if(Number(doc.tax||0)){text(390,y,10,'Tax');text(515,y,10,money(doc.tax),true);y-=18;}text(390,y,13,'Total',true);text(505,y,13,money(total),true);y-=20;
  if(!isEstimate){text(390,y,10,'Paid');text(515,y,10,money(paid));y-=16;text(390,y,11,'Balance',true);text(515,y,11,money(balance),true);y-=18;}
  y=Math.max(70,y-18);lines.push(`0.75 G 42 ${y} m 570 ${y} l S`);y-=20;text(42,y,8,isEstimate?'Estimate valid for 30 days unless otherwise noted.':'Thank you for choosing A-1 Plumbing & Heating Co.');y-=13;text(42,y,8,'339-224-4517  |  a1plumbingboston@gmail.com  |  a1plumbing.boston');
  const content=lines.join('\n');
  const objs=[];const push=o=>{objs.push(o);return objs.length;};
  const catalog=push('<< /Type /Catalog /Pages 2 0 R >>');
  const pages=push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const page=push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>');
  const stream=push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  const f1=push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2=push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objs.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objs[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offsets.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'binary');
}
function htmlEmail({kind,doc,customer,items,payments,signingUrl,logoUrl}){
  const isEstimate=kind==='estimate', num=isEstimate?doc.estimate_number:doc.invoice_number,total=Number(doc.total||0);const paid=(payments||[]).filter(p=>String(p.status||'').toLowerCase()!=='failed').reduce((a,p)=>a+Number(p.amount||0),0),bal=Math.max(0,total-paid);
  const itemRows=items.map(i=>`<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${esc(i.description)}</td><td style="padding:10px 8px;text-align:center;border-bottom:1px solid #eee">${Number(i.quantity||1)}</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #eee">${money(i.line_total??Number(i.quantity||1)*Number(i.unit_price||0))}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#111"><div style="max-width:680px;margin:0 auto;padding:24px"><div style="background:#07090c;border-bottom:6px solid #d7192d;padding:18px 22px;color:white"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="width:190px;vertical-align:middle">${logoUrl?`<img src="${esc(logoUrl)}" alt="A-1 Plumbing & Heating" width="180" style="display:block;width:180px;max-width:100%;height:auto">`:``}</td><td style="vertical-align:middle;padding-left:18px"><div style="font-size:20px;font-weight:800">A-1 Plumbing & Heating Co.</div><div style="color:#c9c9c9;margin-top:5px;font-size:12px;letter-spacing:.04em">LICENSED & INSURED &nbsp;•&nbsp; RESIDENTIAL + COMMERCIAL</div><div style="color:#c9c9c9;margin-top:5px;font-size:11px">PLUMBING &nbsp;|&nbsp; HEATING &nbsp;|&nbsp; WATER FILTRATION</div></td><td style="text-align:right;vertical-align:middle;color:#e02134;font-weight:800;font-size:14px">BUILT ON TRUST.</td></tr></table><div style="font-size:30px;color:#e02134;font-weight:900;margin-top:18px">${isEstimate?'ESTIMATE':'INVOICE'} #${esc(num)}</div></div><div style="background:white;padding:28px"><p style="font-size:17px">Hi ${esc((customer.name||'').split(' ')[0]||customer.name||'there')},</p><p>${isEstimate?'Thank you for the opportunity to provide this estimate. The full branded quote is attached as a PDF for your records.':'Attached is your invoice from A-1 Plumbing & Heating Co. for the work shown below.'}</p>${doc.description?`<div style="border-left:4px solid #d7192d;background:#f7f7f7;padding:14px 16px;margin:22px 0"><strong>${isEstimate?'Scope of work':'Work description'}</strong><div style="margin-top:6px;line-height:1.5">${esc(doc.description)}</div></div>`:''}<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding-bottom:8px">Description</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${itemRows}</tbody></table><div style="text-align:right;margin-top:24px;font-size:22px"><strong>Total: ${money(total)}</strong></div>${!isEstimate?`<div style="text-align:right;margin-top:8px">Paid: ${money(paid)} &nbsp; | &nbsp; Balance: <strong>${money(bal)}</strong></div>${signingUrl?`<div style="margin:28px 0;text-align:center"><a href="${esc(signingUrl)}" style="display:inline-block;background:#d7192d;color:white;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:8px">Review & Sign Invoice</a><div style="font-size:12px;color:#666;margin-top:9px">Works on phone, tablet, or computer. Customers can review and sign but cannot edit the invoice.</div></div>`:''}`:''}<p style="margin-top:30px">Please reply to this email or call <strong>339-224-4517</strong> with any questions.</p><p>Thank you,<br><strong>A-1 Plumbing & Heating Co.</strong><br>339-224-4517<br>a1plumbingboston@gmail.com</p></div></div></body></html>`;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try{
    if(!(await verifyFieldOpsKey(String(req.headers['x-fieldops-key']||''))))return res.status(401).json({error:'Authentication required'});
    if(!RESEND_API_KEY)return res.status(503).json({error:'Customer email sending is not connected yet. Add RESEND_API_KEY in Vercel.'});
    if(!FROM_EMAIL)return res.status(503).json({error:'Add FIELDOPS_FROM_EMAIL in Vercel, for example quotes@a1plumbing.boston after verifying the domain with your email provider.'});
    const kind=String(req.body?.kind||'').toLowerCase();const id=clean(req.body?.id,80);
    if(!['estimate','invoice'].includes(kind)||!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'Invalid document'});
    const table=kind==='estimate'?'estimates':'invoices';const itemTable=kind==='estimate'?'estimate_items':'invoice_items';const fk=kind==='estimate'?'estimate_id':'invoice_id';
    const docs=await sb(`${table}?id=eq.${encodeURIComponent(id)}&select=*`);const doc=docs?.[0];if(!doc)return res.status(404).json({error:'Document not found'});
    const customers=await sb(`customers?id=eq.${encodeURIComponent(doc.customer_id)}&select=*`);const customer=customers?.[0];if(!customer?.email)return res.status(400).json({error:'Customer email is missing'});
    const items=await sb(`${itemTable}?${fk}=eq.${encodeURIComponent(id)}&select=*&order=sort_order.asc,created_at.asc`);
    const payments=kind==='invoice'?await sb(`payments?invoice_id=eq.${encodeURIComponent(id)}&select=*`):[];
    const num=kind==='estimate'?doc.estimate_number:doc.invoice_number;const label=kind==='estimate'?'Quote':'Invoice';
    let signingUrl=null;
    if(kind==='invoice'){
      let prior=[];try{prior=await sb(`invoice_signatures?invoice_id=eq.${encodeURIComponent(id)}&select=revision,signed_at,superseded_at&order=revision.desc,created_at.desc`);}catch(e){throw new Error('E-signature setup is not installed. Run supabase-v29-esign.sql in Supabase first.');}
      const signedRevisions=(prior||[]).filter(x=>x.signed_at).map(x=>Number(x.revision||0));const revision=(signedRevisions.length?Math.max(...signedRevisions):0)+1;const now=new Date().toISOString();
      await sbWrite(`invoice_signatures?invoice_id=eq.${encodeURIComponent(id)}&signed_at=is.null&superseded_at=is.null`,{method:'PATCH',body:{superseded_at:now},prefer:'return=minimal'}).catch(()=>{});
      const token=crypto.randomBytes(32).toString('base64url');const expires=new Date(Date.now()+30*24*60*60*1000).toISOString();
      const snapshot={doc:{id:doc.id,invoice_number:doc.invoice_number,title:doc.title,description:doc.description,notes:doc.notes,subtotal:doc.subtotal,tax:doc.tax,total:doc.total,created_at:doc.created_at,due_at:doc.due_at},customer:{name:customer.name,email:customer.email,phone:customer.phone,address:customer.address,city:customer.city,state:customer.state,zip:customer.zip},items:(items||[]).map(x=>({description:x.description,quantity:Number(x.quantity||1),unit_price:Number(x.unit_price||0),line_total:Number(x.line_total??Number(x.quantity||1)*Number(x.unit_price||0))}))};
      await sbWrite('invoice_signatures',{body:{invoice_id:id,revision,token,customer_email:customer.email,sent_at:now,expires_at:expires,snapshot}});
      const origin=PUBLIC_URL||`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`;signingUrl=`${origin.replace(/\/$/,'')}/customer-sign.html?token=${encodeURIComponent(token)}`;
    }
    const pdf=buildPdf({kind,doc,customer,items,payments});
    const payload={from:FROM_EMAIL,to:[customer.email],reply_to:REPLY_TO,subject:`A-1 Plumbing & Heating - ${label} #${num}`,html:htmlEmail({kind,doc,customer,items,payments,signingUrl,logoUrl:`${(PUBLIC_URL||`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`).replace(/\/$/,'')}/a1-logo.png`}),attachments:[{filename:`A1-${label}-${num}.pdf`,content:pdf.toString('base64')} ]};
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json().catch(()=>({}));if(!r.ok)return res.status(r.status).json({error:j?.message||'Email provider rejected the send'});
    const now=new Date().toISOString();await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'sent',sent_at:now,updated_at:now})});
    return res.status(200).json({sent:true,email_id:j.id||null,to:customer.email});
  }catch(e){return res.status(500).json({error:e?.message||'Could not send document'});}
}
