import {createHmac,timingSafeEqual} from 'node:crypto';
import {db} from './db.js';

// Use the exact public URL configured in Twilio; never trust forwarded Host headers.
export function validTwilioSignature(token,url,params,signature){
 if(!token||!url||!signature||!params||typeof params!=='object'||Array.isArray(params))return false;
 if(Object.values(params).some(v=>typeof v!=='string'))return false;
 const data=url+Object.keys(params).sort().map(k=>k+params[k]).join('');
 const expected=Buffer.from(createHmac('sha1',token).update(data).digest('base64'));
 const received=Buffer.from(String(signature));return expected.length===received.length&&timingSafeEqual(expected,received);
}
export async function twilioWebhook(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'POST required'});
 const {TWILIO_AUTH_TOKEN:token,TWILIO_SMS_WEBHOOK_URL:url,TWILIO_ACCOUNT_SID:account,TWILIO_PHONE_NUMBER:number}=process.env;
 if(!token||!url||!account||!number)return res.status(503).json({error:'Texting is not configured'});
 if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))return res.status(415).json({error:'Form body required'});
 let b=req.body;
 if(typeof b==='string'){const entries=[...new URLSearchParams(b)];if(new Set(entries.map(([k])=>k)).size!==entries.length)return res.status(400).json({error:'Duplicate parameter'});b=Object.fromEntries(entries);}
 if(!validTwilioSignature(token,url,b,req.headers['x-twilio-signature']))return res.status(403).json({error:'Invalid signature'});
 if(b.AccountSid!==account||b.To!==number)return res.status(403).json({error:'Unexpected account or recipient'});
 if(!/^SM[0-9a-f]{32}$/i.test(b.MessageSid||'')||!/^\+[1-9]\d{6,14}$/.test(b.From||'')||typeof b.Body!=='string'||b.Body.length>10000||!/^\d+$/.test(b.NumMedia||'0')||Number(b.NumMedia||0)>10)return res.status(400).json({error:'Invalid message'});
 const media=[];for(let i=0;i<Number(b.NumMedia||0);i++){if(!b['MediaUrl'+i]||!b['MediaContentType'+i])return res.status(400).json({error:'Invalid attachment'});media.push({url:b['MediaUrl'+i],content_type:b['MediaContentType'+i]});}
 try{
  // A unique SID makes provider retries harmless, including concurrent delivery.
  try{await db('fieldops_text_messages',{method:'POST',body:{message_sid:b.MessageSid,from_number:b.From,to_number:b.To,body:b.Body,media}});}
  catch(e){const saved=await db('fieldops_text_messages?message_sid=eq.'+b.MessageSid+'&select=message_sid');if(!saved.length)throw e;}
  res.setHeader('Content-Type','text/xml; charset=utf-8');return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
 }catch{return res.status(503).json({error:'Message could not be saved; retry later'});}
}
