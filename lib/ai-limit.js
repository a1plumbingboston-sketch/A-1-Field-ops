import {db} from './db.js';

const positiveInteger=(value,fallback)=>{
 const parsed=Number.parseInt(String(value??''),10);
 return Number.isFinite(parsed)&&parsed>0?parsed:fallback;
};

// Reserve an AI request before contacting the provider. The insert makes the
// limit visible across devices and serverless instances; a local counter would
// not. If usage storage is unavailable we fail closed so an outage cannot cause
// an unbounded API bill.
export async function checkAiRateLimit(feature='ai'){
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.AI_HOURLY_LIMIT)return;
 const limit=positiveInteger(process.env.AI_HOURLY_LIMIT,30);
 const since=new Date(Date.now()-60*60*1000).toISOString();
 const rows=await db(`fieldops_ai_usage?created_at=gte.${encodeURIComponent(since)}&select=id&limit=${limit}`);
 if(Array.isArray(rows)&&rows.length>=limit)throw new Error(`AI usage limit reached (${limit} requests per hour). Try again later.`);
 await db('fieldops_ai_usage',{method:'POST',body:{feature:String(feature).slice(0,80)}});
}
