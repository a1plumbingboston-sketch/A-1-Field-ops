export const URL=process.env.SUPABASE_URL||'https://dddthwakdrxxmjbfowpl.supabase.co';
const publicKey='sb_publishable_f3QAMeX2YKuyeOI3WMkhng_9LdWdL7O';
export async function authorized(req){const key=String(req.headers['x-fieldops-key']||'');if(!key)return false;const r=await fetch(`${URL}/rest/v1/rpc/fieldops_key_status`,{method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json','x-fieldops-key':key},body:'{}'});return r.ok&&(await r.json())===true;}
export async function db(path,{method='GET',body}={}){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error('Server database access is not configured');const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||`Database request failed (${r.status})`);return j;}
export const rpc=(name,body)=>db('rpc/'+name,{method:'POST',body});
// Best-effort: an audit-log write must never block or fail the action it's
// recording. Failures are logged server-side (Vercel function logs) and swallowed.
export async function audit(action,targetKind,targetId,hash,detail){
  try{await rpc('fieldops_audit',{p_action:action,p_target_kind:targetKind??null,p_target_id:targetId??null,p_hash:hash??null,p_detail:detail??{}});}
  catch(e){console.error('audit log failed:',action,e && e.message);}
}
export const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
export const tokenOK=v=>/^[A-Za-z0-9_-]{32,200}$/.test(String(v||''));
export const clean=(v,max=2400)=>String(v??'').trim().slice(0,max);
export function error(res,e){return res.status(/signed|changed|pending|expired|replaced|conflict/i.test(e.message)?409:500).json({error:e.message||'Request failed'});}
