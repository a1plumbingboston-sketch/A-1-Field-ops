import {authorized,rpc,uuid,error} from '../lib/db.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 try{
  if(!await authorized(req))return res.status(401).json({error:'Authentication required'});
  const id=String(req.body?.lead_id||'').trim();
  if(!uuid(id))return res.status(400).json({error:'Invalid lead'});
  const owner=process.env.FIELDOPS_OWNER_ID||null;
  if(owner&&!uuid(owner))throw new Error('The configured FieldOps owner is invalid');
  const result=await rpc('fieldops_convert_lead',{p_lead_id:id,p_owner_id:owner});
  return res.status(200).json({ok:true,...result});
 }catch(e){return error(res,e);}
}
