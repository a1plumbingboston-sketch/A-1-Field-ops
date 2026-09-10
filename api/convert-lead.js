const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dddthwakdrxxmjbfowpl.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_f3QAMeX2YKuyeOI3WMkhng_9LdWdL7O';

async function verifyFieldOpsKey(key){
  if(!key) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fieldops_key_status`,{
    method:'POST',
    headers:{apikey:PUBLISHABLE_KEY,'Content-Type':'application/json','x-fieldops-key':key},
    body:'{}'
  });
  if(!r.ok) return false;
  const data = await r.json().catch(()=>false);
  return data === true;
}

async function resolveSingleOwner(serviceKey){
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=2`,{
    headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}
  });
  if(!r.ok) throw new Error('Could not resolve FieldOps owner');
  const data = await r.json();
  const users = Array.isArray(data) ? data : (data.users || []);
  if(users.length !== 1) throw new Error(users.length===0 ? 'No FieldOps owner account exists yet' : 'Multiple owner accounts found; configure FIELDOPS_OWNER_ID');
  return users[0].id;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const accessKey=String(req.headers['x-fieldops-key']||'');
    if(!(await verifyFieldOpsKey(accessKey))) return res.status(401).json({error:'Authentication required'});
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!serviceKey) return res.status(503).json({error:'Server database access is not configured'});
    const leadId=String(req.body?.lead_id||'').trim();
    if(!/^[0-9a-f-]{36}$/i.test(leadId)) return res.status(400).json({error:'Invalid lead'});
    const ownerId=process.env.FIELDOPS_OWNER_ID || await resolveSingleOwner(serviceKey);
    const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/convert_lead_service`,{
      method:'POST',
      headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_lead_id:leadId,p_owner_id:ownerId})
    });
    const text=await r.text();
    let data=null; try{ data=text?JSON.parse(text):null; }catch{}
    if(!r.ok) return res.status(400).json({error:data?.message||'Could not convert lead'});
    return res.status(200).json({ok:true,...data});
  }catch(err){
    return res.status(500).json({error:err?.message||'Could not convert lead'});
  }
}
