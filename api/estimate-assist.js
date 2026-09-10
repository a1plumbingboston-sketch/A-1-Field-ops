const SUPABASE_URL=process.env.SUPABASE_URL||'https://dddthwakdrxxmjbfowpl.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_f3QAMeX2YKuyeOI3WMkhng_9LdWdL7O';
async function verifyFieldOpsKey(key){
  if(!key)return false;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/fieldops_key_status`,{method:'POST',headers:{apikey:PUBLISHABLE_KEY,'Content-Type':'application/json','x-fieldops-key':key},body:'{}'});
  return r.ok&&(await r.json().catch(()=>false))===true;
}
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  if(!(await verifyFieldOpsKey(String(req.headers['x-fieldops-key']||'')))) return res.status(401).json({error:'Authentication required'});
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) return res.status(503).json({error:'AI estimator is not connected yet. Add OPENAI_API_KEY in Vercel Environment Variables.'});
  const x=req.body||{};
  const location=x.location||'Woburn, Massachusetts';
  const prompt=`You are the estimating assistant for A-1, a licensed plumbing contractor in Massachusetts. Build decision-support pricing for this real plumbing job. Use current web search to research public pricing signals relevant to ${location}: local plumbing contractor/service pricing pages when available, current retail/material pricing, equipment pricing, permit/typical scope considerations, and Massachusetts-specific cost factors. Do not fabricate competitor quotes. Distinguish weak web estimates from concrete public prices.\n\nJob: ${x.title||''}\nScope notes: ${x.description||''}\nLocation: ${location}\nContractor inputs: labor hours=${x.labor_hours||0}; billable labor rate=$${x.labor_rate||0}/hr; expected material cost=$${x.material_cost||0}; material markup=${x.markup_pct||0}%; contingency=${x.contingency_pct||0}%.\n\nReturn ONLY valid JSON with keys: market_low, market_typical, market_high, recommended_total, summary, risks (array of strings), recommended_line_items (array of objects with description, quantity, unit_price, price, reason), sources (array of objects with title,url). Recommended price should protect contractor margin and should not blindly copy consumer cost-guide averages. Keep sources to the most useful public references.`;
  try{
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.6-terra',tools:[{type:'web_search'}],input:prompt})});
    const j=await r.json();
    if(!r.ok) return res.status(r.status).json({error:j?.error?.message||'OpenAI request failed'});
    let text='';
    for(const out of (j.output||[])) if(out.type==='message') for(const c of (out.content||[])) if(c.type==='output_text') text+=c.text||'';
    text=text.trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
    let analysis; try{analysis=JSON.parse(text)}catch{ return res.status(502).json({error:'AI returned an unreadable estimate. Try again with a more specific job description.'}); }
    return res.status(200).json({analysis,usage:j.usage||null,request_id:j.id||null});
  }catch(e){return res.status(500).json({error:e?.message||String(e)})}
}
