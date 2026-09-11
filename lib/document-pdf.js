import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import '../document-system.js';
const D=globalThis.A1Documents;
const logo=fs.readFileSync(new URL('../a1-logo.png',import.meta.url));
export async function buildPdf(snapshot,signature,{signingUrl}={}){
 const m=D.model(snapshot),{d,c,job,items,kind,total,paid}=m;
 const pdf=new PDFDocument({size:'LETTER',margin:28,bufferPages:true,info:{Title:`A-1 ${D.labels[kind]} #${m.number}`,Author:'A-1 Plumbing & Heating Co.'}}),chunks=[];
 const finished=new Promise((resolve,reject)=>{pdf.on('data',c=>chunks.push(c));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);});
 let y=28;const left=28,width=556,bottom=738;
 function txt(t,x,yy,w,size=9,bold=false){pdf.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor('#161616').text(String(t??''),x,yy,{width:w,lineGap:1});return pdf.y;}
 function height(t,w,size=9,bold=false){pdf.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);return pdf.heightOfString(String(t??''),{width:w,lineGap:1});}
 function rule(yy,color='#cccccc'){pdf.moveTo(left,yy).lineTo(584,yy).lineWidth(.6).strokeColor(color).stroke();}
 function header(continued=false){pdf.image(snapshot.logo?Buffer.from(snapshot.logo.split(',')[1],'base64'):logo,left,24,{fit:[100,55]});txt('A-1 Plumbing & Heating Co.',138,28,275,12,true);txt('339-224-4517 | a1plumbingboston@gmail.com',138,44,270,8);txt('Plumbing & HVAC | 24/7 Emergency Service | 12 Years of Experience',138,56,270,7);txt('BUILT ON TRUST.',138,69,260,7,true);txt(D.labels[kind],415,28,169,kind==='completion'?12:16,true);txt(`#${m.number||''}${continued?' / continued':''}`,415,51,165,9);txt(d.created_at?new Date(d.created_at).toLocaleDateString('en-US'):'',415,65,165,8);rule(85,'#c9202f');y=96;}
 function ensure(h){if(y+h>bottom){pdf.addPage();header(true);}}
 header();
 const customer=[c.name,c.phone,c.email].filter(Boolean).join('\n'), location=job.address||[c.address,c.city,c.state,c.zip].filter(Boolean).join(', ');
 txt('CUSTOMER',left,y,260,8,true);txt('JOB / SERVICE LOCATION',314,y,270,8,true);y+=13;
 const right=[location,d.title,kind==='estimate'?`Valid through: ${d.valid_until||'30 days from issue'}`:`Payment terms: ${d.payment_terms|| (d.due_at?new Date(d.due_at).toLocaleDateString('en-US'):'Due upon receipt, subject to applicable law')}`].filter(Boolean).join('\n');
 y=Math.max(txt(customer,left,y,264,9),txt(right,314,y,270,9))+9;
 if(kind==='change_order'){const change=`Original ${d.parent_kind} #${d.parent_number} | Current approved total ${D.money(d.base_total)} | Adjustment ${D.money(total)} | New approved total if accepted ${D.money(Number(d.base_total)+total)}`;ensure(height(change,width)+12);y=txt(change,left,y,width,9,true)+10;}
 const tableHeader=()=>{pdf.rect(left,y,width,19).fill('#171717');pdf.fillColor('white').font('Helvetica-Bold').fontSize(8);for(const [t,x,w]of[['Description',34,310],['Qty',353,35],['Unit price',401,76],['Amount',493,85]])pdf.text(t,x,y+5,{width:w});y+=22;};
 if(kind==='change_order'){ensure(18);y=txt('REVISED FULL SCOPE AND PRICING (REFERENCE)',left,y,width,8,true)+7;}tableHeader();for(const item of items){const h=Math.max(height(item.description,312,9),14)+8;if(y+h>bottom){pdf.addPage();header(true);tableHeader();}txt(item.description,34,y,312);txt(item.quantity,353,y,35);txt(D.money(item.unit_price),401,y,76);txt(D.money(item.line_total??item.quantity*item.unit_price),493,y,85);y+=h;rule(y-4);}
 y+=8;const scope=[d.description||d.title||'As itemized above.',d.notes?'Notes / Exclusions: '+d.notes:''].filter(Boolean).join('\n');
 // Flow long scope text without cutting content. PDFKit paginates paragraphs automatically.
 ensure(70);txt(kind==='change_order'?'CHANGE IN SCOPE':'SCOPE OF WORK',left,y,310,8,true);y+=12;
 if(height(scope,310)>120){y=txt(scope,left,y,width,9)+10;ensure(90);}else {const end=txt(scope,left,y,310);let ty=y;for(const [label,value]of[...(kind==='change_order'?[['Previous approved',d.base_total],['Revised full price',Number(d.base_total)+total]]:[['Subtotal',d.subtotal??total],['Tax',d.tax||0]]),[kind==='change_order'?'Adjustment':'Total',total],...(['invoice','receipt','completion'].includes(kind)?[['Payments recorded',paid],['Approved credits',Number(d.credit_amount||0)],['Balance due',total-Number(d.credit_amount||0)-paid]]:[])]){txt(label,373,ty,115,9,label==='Total');txt(D.money(value),493,ty,85,9,true);ty+=15;}y=Math.max(end,ty)+8;}
 if(height(scope,310)>120){for(const [label,value]of[...(kind==='change_order'?[['Previous approved',d.base_total],['Revised full price',Number(d.base_total)+total]]:[['Subtotal',d.subtotal??total],['Tax',d.tax||0]]),[kind==='change_order'?'Adjustment':'Total',total],...(['invoice','receipt','completion'].includes(kind)?[['Payments recorded',paid],['Approved credits',Number(d.credit_amount||0)],['Balance due',total-Number(d.credit_amount||0)-paid]]:[])]){txt(label,373,y,115,9);txt(D.money(value),493,y,85,9,true);y+=15;}}
 if(kind==='receipt'){ensure(25);txt('PAYMENT RECORD',left,y,width,8,true);y+=14;for(const p of m.payments.filter(p=>['paid','succeeded','completed'].includes(p.status))){ensure(18);y=txt(`${new Date(p.created_at).toLocaleDateString('en-US')} | ${p.method} | ${D.money(p.amount)}`,left,y,width,9)+4;}}
 const paragraphs=m.terms.map(([h,t])=>`${h}. ${t}`),colWidth=268;
 const sizes=paragraphs.map(t=>height(t,colWidth,8)+5);let split=1,best=Infinity;for(let i=1;i<paragraphs.length;i++){const h=Math.max(sizes.slice(0,i).reduce((a,b)=>a+b,0),sizes.slice(i).reduce((a,b)=>a+b,0));if(h<best){best=h;split=i;}}
 ensure(best+27);rule(y);y+=8;txt('SERVICE AGREEMENT & TERMS AND CONDITIONS',left,y,width,8,true);y+=15;let ends=[];for(const [start,end,x] of [[0,split,left],[split,paragraphs.length,314]]){let cy=y;for(let i=start;i<end;i++)cy=txt(paragraphs[i],x,cy,colWidth,8)+5;ends.push(cy);}y=Math.max(...ends)+5;
 const ah=height(m.authorization,width,8)+ (signature?107:signingUrl?105:60);ensure(ah);rule(y);y+=8;txt(kind==='receipt'?'PAYMENT ACKNOWLEDGMENT':'CUSTOMER AUTHORIZATION / E-SIGNATURE',left,y,width,8,true);y+=13;y=txt(m.authorization,left,y,width,8)+7;
 if(signature){pdf.image(Buffer.from(signature.signature_data.split(',')[1],'base64'),left,y,{fit:[180,60]});y+=63;y=txt(`${signature.customer_name} | Signed ${new Date(signature.signed_at).toISOString()}`,left,y,width,8)+5;if(signature.exceptions)y=txt('Completion exceptions: '+signature.exceptions,left,y,width,8)+5;}else if(kind!=='receipt'){
  if(signingUrl){
   pdf.rect(left,y,width,36).lineWidth(1).strokeColor('#c9202f').stroke();txt('TAP HERE TO REVIEW & SIGN',left+10,y+10,width-20,11,true);pdf.link(left,y,width,36,signingUrl+'#signature-slot');y+=42;
   y=txt('Sign in the designated box on the A-1 page using your finger or mouse. A signed PDF is saved for you. If this link does not open, use Review & Sign in your email. No Google Docs or printing needed.',left,y,width,8)+7;
  }else y=txt('Customer signature ______________________________    Date ______________',left,y+14,width,9)+8;
 }
 const range=pdf.bufferedPageRange();for(let i=0;i<range.count;i++){pdf.switchToPage(i);pdf.font('Helvetica').fontSize(7).fillColor('#555').text(`A-1 Plumbing & Heating Co. | Built on Trust.                                              ${i+1} / ${range.count}`,left,750,{width, lineBreak:false});}
 pdf.end();return finished;
}
