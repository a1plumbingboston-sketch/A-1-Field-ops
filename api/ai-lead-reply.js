const SUPABASE_URL=process.env.SUPABASE_URL||'https://dddthwakdrxxmjbfowpl.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_f3QAMeX2YKuyeOI3WMkhng_9LdWdL7O';
const MODEL=process.env.OPENAI_REPLY_MODEL||'gpt-5.6-luna';
const clean=(v,n=2200)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);
async function verifyFieldOpsKey(key){
  if(!key) return false;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/fieldops_key_status`,{method:'POST',headers:{apikey:PUBLISHABLE_KEY,'Content-Type':'application/json','x-fieldops-key':key},body:'{}'});
  return r.ok && (await r.json().catch(()=>false))===true;
}
function localRisk(message=''){
  const s=String(message).toLowerCase();
  if(/gas smell|smell gas|carbon monoxide|\bco\b alarm|fire|sparking|electrical shock/.test(s)) return ['emergency','Potential immediate safety issue'];
  if(/flooding|burst pipe|water everywhere|ceiling.*water|active leak/.test(s)) return ['urgent','Potential active property damage'];
  if(/price|cost|quote|estimate|how much/.test(s)) return ['approval','Pricing request'];
  if(/appointment|available|today|tomorrow|what time|schedule/.test(s)) return ['approval','Scheduling or availability request'];
  if(/angry|lawsuit|lawyer|refund|complaint|terrible|fraud/.test(s)) return ['approval','Sensitive customer issue'];
  return ['routine','Routine service inquiry'];
}
async function generateReply(lead){
  const [risk,reason]=localRisk(lead.message);
  const prompt=`Draft a reply for A-1 Plumbing & Heating.\nCustomer: ${lead.name||'there'}\nService: ${lead.service_type||'plumbing'}\nMessage: ${lead.message||'(no message)'}\nLocation: ${[lead.city,lead.state].filter(Boolean).join(', ')||'(not provided)'}\n\nRules:\n- Warm, concise, professional, human.\n- Do not claim 24/7 service, certifications, Mass Save participation, service areas, ratings, reviews, license numbers, or availability unless explicitly supplied.\n- Do not confirm appointments or arrival times.\n- Do not quote or guarantee prices.\n- Ask at most one useful follow-up question.\n- For gas odor, fire, carbon monoxide, electrical danger, or other immediate danger, give safety-first emergency guidance and do not troubleshoot.\n- For active flooding, advise the customer to shut off water only if they can do so safely.\nReturn only the message text.`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,input:prompt,max_output_tokens:280})});
  const j=await r.json();
  if(!r.ok) throw new Error(j?.error?.message||'AI reply request failed');
  let text='';
  for(const out of (j.output||[])) if(out.type==='message') for(const c of (out.content||[])) if(c.type==='output_text') text+=c.text||'';
  return {reply:text.trim(),risk,reason};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    if(!(await verifyFieldOpsKey(String(req.headers['x-fieldops-key']||'')))) return res.status(401).json({error:'Authentication required'});
    if(!process.env.OPENAI_API_KEY) return res.status(503).json({error:'AI replies are not configured'});
    const x=req.body||{};
    const lead={id:clean(x.id,80),name:clean(x.name,120),source:clean(x.source,60),service_type:clean(x.service_type,120),message:clean(x.message,2200),city:clean(x.city,120),state:clean(x.state,40)};
    const out=await generateReply(lead);
    if(!out.reply) return res.status(502).json({error:'AI did not return a reply'});
    if(lead.id && process.env.SUPABASE_SERVICE_ROLE_KEY){
      const saved=await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}`,{method:'PATCH',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({ai_reply_draft:out.reply,ai_reply_status:out.risk==='routine'?'draft_ready':'needs_approval',ai_reply_risk:out.risk,ai_reply_reason:out.reason,ai_reply_generated_at:new Date().toISOString()})});
      const rows=await saved.json().catch(()=>null);
      if(!saved.ok||!Array.isArray(rows)||rows.length!==1)throw new Error('The AI reply could not be saved. Please try again.');
    }
    return res.status(200).json(out);
  }catch(err){return res.status(500).json({error:err?.message||'Could not create AI reply'});}
}