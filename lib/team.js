import {createHash,randomBytes} from 'node:crypto';
import {authorized,rpc} from './db.js';
const digest=s=>createHash('sha256').update(s).digest('hex');
const codeOK=s=>/^[a-f0-9]{64}$/.test(s);
export async function teamHandler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'POST required'});
 const origin=req.headers.origin;
 if(origin){try{if(new URL(origin).host!==req.headers.host)return res.status(403).json({error:'Origin not allowed'});}catch{return res.status(403).json({error:'Origin not allowed'});}}
 if(!String(req.headers['content-type']).includes('application/json'))return res.status(415).json({error:'JSON required'});
 const b=req.body||{},action=b.team_action;
 const secure=process.env.NODE_ENV==='production'?'; Secure':'';
 const cookie=v=>res.setHeader('Set-Cookie',`fieldops_employee=${v}; Path=/api; HttpOnly; SameSite=Strict${secure}; Max-Age=${v?2592000:0}`);
 try{
  if(action==='logout'){cookie('');return res.status(200).json({signed_out:true});}
  if(action==='login'){
   const code=String(b.code||'').trim();if(!codeOK(code))return res.status(401).json({error:'Invalid employee access code'});
   const result=await rpc('fieldops_team',{p_owner:false,p_hash:digest(code),p_action:'session',p_data:{}});
   cookie(code);return res.status(200).json(result);
  }
  const owner=await authorized(req);
  const code=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fieldops_employee='))?.slice(18)||'';
  if(!owner&&!codeOK(code))return res.status(401).json({error:'Sign in with your employee access code'});
  let data={...b.data},accessCode;
  if(action==='staff_save'){
   if(!owner)return res.status(403).json({error:'Owner access required'});
   delete data.hash;
   if(!data.id||data.rotate){accessCode=randomBytes(32).toString('hex');data.hash=digest(accessCode);}
  }
  if(action==='list'){
   const start=Date.parse(data.from),end=Date.parse(data.to);
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>370*86400000)return res.status(400).json({error:'Choose a date range under one year'});
  }
  const allowed=['session','list','detail','photo_read','staff_save','schedule','message','photo','status'];
  if(!allowed.includes(action))return res.status(400).json({error:'Unknown action'});
  const result=await rpc('fieldops_team',{p_owner:owner,p_hash:owner?'':digest(code),p_action:action,p_data:data});
  return res.status(200).json({...result,...(accessCode?{access_code:accessCode}:{})});
 }catch(e){const msg=e.message||'';const auth=/Authentication/.test(msg);if(auth)cookie('');return res.status(auth?401:/Not permitted/.test(msg)?403:409).json({error:auth?'Access expired or disabled. Ask your owner for a new code.':/fieldops_team|does not exist|database access/i.test(msg)?'Employee workspace is not configured yet.':msg});}
}
