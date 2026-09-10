const allowedSources = new Set(['instagram','facebook','tiktok','whatsapp','social','metricool','mailopoly']);
function clean(v,n=2000){return String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n)}
function source(v){const s=clean(v,40).toLowerCase();return allowedSources.has(s)?s:'social'}
function bearer(req){const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')?h.slice(7):''}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  const secret=process.env.SOCIAL_LEAD_WEBHOOK_SECRET||process.env.SOCIAL_WEBHOOK_SECRET;
  if(!secret || bearer(req)!==secret) return res.status(401).json({error:'Unauthorized'});
  const supabaseUrl=process.env.SUPABASE_URL||'https://dddthwakdrxxmjbfowpl.supabase.co';
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey) return res.status(503).json({error:'Lead intake is not configured'});
  const b=req.body||{};
  const platform=source(b.source||b.platform||b.network);
  const name=clean(b.name||b.sender_name||b.contact_name,140)||'Social lead';
  const message=clean(b.message||b.text||b.body,3000);
  const email=clean(b.email,200);
  const phone=clean(b.phone,50);
  const externalId=clean(b.external_id||b.message_id||b.thread_id,200);
  const profileUrl=clean(b.profile_url||b.url,500);
  if(!message && !email && !phone) return res.status(400).json({error:'Message or contact detail required'});
  const internal=[`source:${platform}`,externalId&&`external_id:${externalId}`,profileUrl&&`profile:${profileUrl}`].filter(Boolean).join(' | ');
  const lead={name,email:email||null,phone:phone||null,message:message||`Inbound ${platform} inquiry`,source:platform,status:'new',internal_notes:internal||null};
  const r=await fetch(`${supabaseUrl}/rest/v1/leads`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(lead)});
  const text=await r.text(); let data=null; try{data=text?JSON.parse(text):null}catch{}
  if(!r.ok) return res.status(r.status).json({error:data?.message||'Lead insert failed'});
  const id=Array.isArray(data)?data[0]?.id:data?.id;
  // Automatically draft a reply for every new social lead unless explicitly disabled.
  // This prepares the reply but does not send it to the customer.
  if(id && process.env.OPENAI_API_KEY && process.env.AI_AUTO_DRAFTS!=='off'){
    try{
      const model=process.env.OPENAI_REPLY_MODEL||'gpt-5.6-luna';
      const lower=(message||'').toLowerCase();
      let risk='routine', reason='Routine service inquiry';
      if(/gas smell|smell gas|carbon monoxide|\bco\b alarm|fire|sparking|electrical shock/.test(lower)){risk='emergency';reason='Potential immediate safety issue';}
      else if(/flooding|burst pipe|water everywhere|ceiling.*water|active leak/.test(lower)){risk='urgent';reason='Potential active property damage';}
      else if(/price|cost|quote|estimate|how much/.test(lower)){risk='approval';reason='Pricing request';}
      else if(/appointment|available|today|tomorrow|what time|schedule/.test(lower)){risk='approval';reason='Scheduling or availability request';}
      else if(/refund|complaint|lawyer|lawsuit|fraud|terrible/.test(lower)){risk='approval';reason='Sensitive customer issue';}
      const prompt=`Draft a concise customer-facing reply for A-1 Plumbing & Heating. Customer: ${name}. Message: ${message||`Inbound ${platform} inquiry`}. Do not invent availability, prices, reviews, ratings, licensing, certifications, Mass Save participation, or service areas. Do not confirm an appointment. Ask at most one useful follow-up question. If there is a safety emergency, give safety-first guidance rather than troubleshooting. Return only the reply text.`;
      const ar=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:prompt,max_output_tokens:260})});
      const aj=await ar.json(); let draft='';
      for(const o of (aj.output||[])) if(o.type==='message') for(const c of (o.content||[])) if(c.type==='output_text') draft+=c.text||'';
      if(ar.ok && draft.trim()){
        await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({ai_reply_draft:draft.trim(),ai_reply_status:risk==='routine'?'draft_ready':'needs_approval',ai_reply_risk:risk,ai_reply_reason:reason,ai_reply_generated_at:new Date().toISOString(),external_message_id:externalId||null})});
      }
    }catch(_){}
  }
  return res.status(201).json({ok:true,id,source:platform});
}
