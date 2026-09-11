import {db,uuid,clean} from './db.js';
import {businessReview} from './business-review.js';
const valid=(condition,message)=>{if(!condition)throw new Error(message);};
// Called only after the existing business access-key authorization in documents.js.
export async function fieldTools(req,res){
 const b=req.body||{};valid(req.method==='POST','POST required');
 switch(b.op){
 case 'business-review':return res.json(await businessReview(b.with_ai===true));
 case 'lead-delete':valid(uuid(b.id)&&b.confirmed===true,'Confirm the lead to delete');await db('leads?id=eq.'+b.id,{method:'DELETE'});return res.json({deleted:true});
 case 'history':valid(uuid(b.customer_id),'Invalid customer');return res.json({jobs:await db(`jobs?customer_id=eq.${b.customer_id}&order=created_at.desc&limit=200`),estimates:await db(`estimates?customer_id=eq.${b.customer_id}&order=created_at.desc&limit=100`),invoices:await db(`invoices?customer_id=eq.${b.customer_id}&order=created_at.desc&limit=100`)});
 case 'prices': return res.json(await db('fieldops_pricebook?archived_at=is.null&order=category.asc,name.asc&limit=1000'));
 case 'price-save': {
  const name=clean(b.name,160),description=clean(b.description,2400),category=clean(b.category,100),quantity=Number(b.quantity),unit_price=Number(b.unit_price);
  valid(name&&Number.isFinite(quantity)&&quantity>0&&quantity<=1000000&&Number.isFinite(unit_price)&&unit_price>=0&&unit_price<=1000000000,'Enter a name, positive quantity, and valid price');
  if(b.id)valid(uuid(b.id),'Invalid price book item');
  return res.json(await db('fieldops_pricebook'+(b.id?'?id=eq.'+b.id:''),{method:b.id?'PATCH':'POST',body:{name,description,category,quantity,unit_price:Math.round(unit_price*100)/100}}));
 }
 case 'price-archive':valid(uuid(b.id),'Invalid price book item');return res.json(await db('fieldops_pricebook?id=eq.'+b.id,{method:'PATCH',body:{archived_at:new Date().toISOString()}}));
 case 'photos':valid(uuid(b.job_id),'Invalid job');return res.json(await db(`fieldops_job_photos?job_id=eq.${b.job_id}&deleted_at=is.null&select=id,caption,phase,created_at&order=created_at.desc&limit=200`));
 case 'photo':valid(uuid(b.id),'Invalid photo');return res.json((await db(`fieldops_job_photos?id=eq.${b.id}&deleted_at=is.null`))[0]||null);
 case 'photo-save': {
  valid(uuid(b.id)&&uuid(b.job_id),'Invalid photo or job');
  valid(['before','during','after'].includes(b.phase),'Choose a photo category');
  const data=String(b.image_data||'');valid(data.length<=1400000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(data),'Photo must be a JPEG under 1 MB');
  const bytes=Buffer.from(data.split(',')[1],'base64');valid(bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'Invalid JPEG photo');
  valid((await db('jobs?id=eq.'+b.job_id+'&select=id')).length,'Job not found');
  const existing=await db('fieldops_job_photos?id=eq.'+b.id+'&select=id,job_id');if(existing.length){valid(existing[0].job_id===b.job_id,'Photo belongs to a different job');return res.json(existing);}
  return res.json(await db('fieldops_job_photos',{method:'POST',body:{id:b.id,job_id:b.job_id,caption:clean(b.caption,1000),phase:b.phase,image_data:data}}));
 }
 case 'photo-remove':valid(uuid(b.id),'Invalid photo');return res.json(await db('fieldops_job_photos?id=eq.'+b.id,{method:'PATCH',body:{deleted_at:new Date().toISOString()}}));
 case 'deliveries': {
  valid(uuid(b.id)&&['estimate','invoice','receipt','completion','change_order'].includes(b.kind),'Invalid document');
  const rows=await db(`fieldops_deliveries?kind=eq.${b.kind}&source_id=eq.${b.id}&order=created_at.desc&limit=20`);
  let warning='';
  if(b.refresh)for(const row of rows.slice(0,5)){
   if(!row.provider_id)continue;
   try{const r=await fetch('https://api.resend.com/emails/'+encodeURIComponent(row.provider_id),{headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY},signal:AbortSignal.timeout(8000)});const j=await r.json();if(!r.ok)throw new Error('Email provider status unavailable');
    const statuses=['sent','delivered','delivery_delayed','bounced','complained','opened','clicked','failed','suppressed','scheduled'];
    if(statuses.includes(j.last_event)){row.status=j.last_event;row.checked_at=new Date().toISOString();await db('fieldops_deliveries?id=eq.'+row.id,{method:'PATCH',body:{status:row.status,checked_at:row.checked_at}});}
   }catch{warning='Some delivery statuses could not refresh. Showing the last saved status.';}
  }
  return res.json({rows,warning});
 }
 default:return res.status(400).json({error:'Unknown tool action'});
 }
}
