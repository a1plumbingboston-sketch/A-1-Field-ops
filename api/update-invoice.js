import {authorized,rpc,uuid,clean,error} from '../lib/db.js';
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'POST only'});try{
 if(!await authorized(req))return res.status(401).json({error:'Authentication required'});
 const kind=req.body?.kind||'invoice',id=req.body?.invoice_id||req.body?.id,items=req.body?.items;
 if(!uuid(id)||!['estimate','invoice'].includes(kind))return res.status(400).json({error:'Invalid document'});
 if(!Array.isArray(items)||items.length<1||items.length>100||items.some(i=>!clean(i.description,500)||!Number.isFinite(Number(i.quantity))||!Number.isFinite(Number(i.unit_price))||Number(i.quantity)<=0||(Number(i.unit_price)<0&&(i.description!=='Discount'||Number(i.quantity)!==1))||Math.abs(Number(i.quantity)*Number(i.unit_price))>1e9))return res.status(400).json({error:'Enter 1–100 valid line items with positive quantities and valid prices (negative prices are only allowed for a Discount)'});
 const result=await rpc('fieldops_edit_document',{p_kind:kind,p_id:id,p_title:clean(req.body.title,300),p_description:clean(req.body.description),p_items:items.map(i=>({description:clean(i.description,500),quantity:Number(i.quantity),unit_price:Number(i.unit_price)}))});return res.status(200).json(result);
 }catch(e){return error(res,e);}}
