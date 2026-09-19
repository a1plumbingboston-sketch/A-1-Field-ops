import {createHash} from 'node:crypto';
import {authorized,db,rpc,uuid} from './db.js';
import {validTwilioSignature} from './twilio-webhook.js';

const sidOK=v=>/^(SM|MM)[0-9a-f]{32}$/i.test(String(v||''));
const phoneOK=v=>/^\+1\d{10}$/.test(String(v||''));
const states=new Set(['accepted','queued','sending','sent','delivered','undelivered','failed','canceled']);
const fail=(code,message)=>Object.assign(new Error(message),{code});
function configuredUrl(value,kind){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.searchParams.get('webhook')===kind?u:null;}catch{return null;}}
export function messagingStatus(){
 const e=process.env,credentials=!!(e.TWILIO_ACCOUNT_SID&&e.TWILIO_AUTH_TOKEN&&/^\+[1-9]\d{6,14}$/.test(e.TWILIO_PHONE_NUMBER||''));
 const inbound=credentials&&!!configuredUrl(e.TWILIO_SMS_WEBHOOK_URL,'twilio-sms');
 const outbound=inbound&&e.TWILIO_SMS_ENABLED==='true'&&!!e.TWILIO_MESSAGING_SERVICE_SID&&!!configuredUrl(e.TWILIO_SMS_STATUS_WEBHOOK_URL,'twilio-status');
 return {inbound_ready:inbound,outbound_ready:outbound,business_number:e.TWILIO_PHONE_NUMBER||'',disabled_reason:outbound?'':inbound?'Sending is disabled until business texting registration and setup are complete.':'Business texting is not connected yet.'};
}
function statusUrl(requestId){const url=configuredUrl(process.env.TWILIO_SMS_STATUS_WEBHOOK_URL,'twilio-status');if(!url)throw fail('SETUP_PENDING','Text delivery tracking is not configured.');url.searchParams.set('request_id',requestId);return url.toString();}
const token=row=>Buffer.from(JSON.stringify(row)).toString('base64url');
function cursor(value,thread=false){
 if(!value)return {};
 try{if(typeof value!=='string'||value.length>500)throw Error();const data=JSON.parse(Buffer.from(value,'base64url').toString());if(!data.at||!Number.isFinite(Date.parse(data.at))||(thread?!(sidOK(data.id)||uuid(data.id)):!phoneOK(data.phone)))throw Error();return data;}catch{throw fail('INVALID_INPUT','The message page has expired. Refresh the inbox.');}
}
function publicMessage(row){return {id:row.request_id,sid:row.message_sid||null,request_id:row.request_id,direction:'outbound',body:row.body,at:row.created_at,status:row.status,error_code:row.error_code||null,error:row.error_detail||null,media_count:0};}
function responseError(res,error){
 const known=['SETUP_PENDING','CONSENT_REQUIRED','INVALID_INPUT','OPTED_OUT','REPLY_REQUIRED','REQUEST_CONFLICT','RATE_LIMITED','AUTH_REQUIRED','MESSAGE_NOT_FOUND','MEDIA_UNAVAILABLE'];
 const code=error.code||known.find(c=>String(error.message).includes(c+':'))||'MESSAGING_UNAVAILABLE';
 const status={SETUP_PENDING:503,CONSENT_REQUIRED:400,INVALID_INPUT:400,OPTED_OUT:409,REPLY_REQUIRED:409,REQUEST_CONFLICT:409,RATE_LIMITED:429,AUTH_REQUIRED:401,MESSAGE_NOT_FOUND:404,MEDIA_UNAVAILABLE:415}[code]||503;
 const detail=code==='MESSAGING_UNAVAILABLE'?'Messages could not be confirmed. Refresh the conversation before trying again.':String(error.message||'Request failed').replace(new RegExp('^'+code+':\\s*'),'');
 return res.status(status).json({error:detail,code});
}
function basicAuth(){return 'Basic '+Buffer.from(process.env.TWILIO_ACCOUNT_SID+':'+process.env.TWILIO_AUTH_TOKEN).toString('base64');}
async function sendReply(b){
 if(b.consent_confirmed!==true)throw fail('CONSENT_REQUIRED','Confirm that this reply addresses the customer’s service inquiry.');
 const body=typeof b.body==='string'?b.body.trim():'';
 if(!uuid(b.request_id)||!phoneOK(b.phone)||!sidOK(b.reply_to_sid)||!body||body.length>1600||body.includes('\0'))throw fail('INVALID_INPUT','Choose an incoming conversation and enter a reply of up to 1,600 characters.');
 const prior=(await db(`fieldops_sms_outbox?request_id=eq.${b.request_id}&limit=1`))[0];
 if(prior){
  if(prior.phone!==b.phone||prior.body!==body||prior.reply_to_sid!==b.reply_to_sid)throw fail('REQUEST_CONFLICT','This send request already belongs to different content.');
  return {message:publicMessage(prior),duplicate:true,unconfirmed:['submitting','unconfirmed'].includes(prior.status)};
 }
 const setup=messagingStatus();if(!setup.outbound_ready)throw fail('SETUP_PENDING',setup.disabled_reason);
 const claim=await rpc('fieldops_sms_claim',{p_request_id:b.request_id,p_phone:b.phone,p_business_number:setup.business_number,p_body:body,p_reply_to_sid:b.reply_to_sid,p_actor_hash:b.actor_hash});
 if(!claim.claimed)return {message:publicMessage(claim.message),duplicate:true,unconfirmed:['submitting','unconfirmed'].includes(claim.message.status)};
 let result;
 try{
  // A durable claim exists before the only provider POST. Network ambiguity never retries it.
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:basicAuth(),'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({To:b.phone,From:setup.business_number,MessagingServiceSid:process.env.TWILIO_MESSAGING_SERVICE_SID,Body:body,StatusCallback:statusUrl(b.request_id)}).toString()
  });
  const j=await r.json().catch(()=>null);
  if(r.status>=500||r.status===408)throw Error('Provider outcome is uncertain');
  if(!r.ok){const code=j?.code==null?String(r.status):String(j.code);result=await rpc('fieldops_sms_result',{p_request_id:b.request_id,p_message_sid:null,p_status:'failed',p_error_code:code,p_error_detail:'Twilio rejected this reply (code '+code+'). Review the conversation before composing another reply.'});}
  else if(!sidOK(j?.sid))throw Error('Provider confirmation was incomplete');
  else result=await rpc('fieldops_sms_result',{p_request_id:b.request_id,p_message_sid:j.sid,p_status:states.has(j.status)?j.status:'queued',p_error_code:j.error_code==null?null:String(j.error_code),p_error_detail:null});
 }catch{
  try{result=await rpc('fieldops_sms_result',{p_request_id:b.request_id,p_message_sid:null,p_status:'unconfirmed',p_error_code:null,p_error_detail:'Sending could not be confirmed. Do not send it again; refresh this conversation for the delivery update.'});}
  catch{return {message:publicMessage({...claim.message,status:'unconfirmed',error_detail:'Sending could not be confirmed. Refresh this conversation before sending another reply.'}),duplicate:false,unconfirmed:true};}
 }
 return {message:publicMessage(result),duplicate:false,unconfirmed:['submitting','unconfirmed'].includes(result.status)};
}

const mediaTypes=new Map([['image/jpeg','jpg'],['image/png','png'],['image/gif','gif'],['image/webp','webp']]);
async function media(req,res,b){
 if(!sidOK(b.sid)||!Number.isInteger(b.index)||b.index<0||b.index>9)throw fail('INVALID_INPUT','Choose a valid message attachment.');
 const row=(await db(`fieldops_text_messages?message_sid=eq.${b.sid}&to_number=eq.${encodeURIComponent(process.env.TWILIO_PHONE_NUMBER||'')}&select=message_sid,media&limit=1`))[0],item=row?.media?.[b.index];
 if(!item)throw fail('MESSAGE_NOT_FOUND','This message attachment is unavailable.');
 const source=new URL(item.url),path=new RegExp('^/2010-04-01/Accounts/'+process.env.TWILIO_ACCOUNT_SID+'/Messages/'+b.sid+'/Media/ME[0-9a-f]{32}$','i');
 if(source.protocol!=='https:'||source.hostname!=='api.twilio.com'||source.port||source.username||source.password||source.search||source.hash||!path.test(source.pathname))throw fail('MEDIA_UNAVAILABLE','This attachment cannot be opened securely.');
 const signal=AbortSignal.timeout(15000);let r=await fetch(source,{redirect:'manual',signal,headers:{Authorization:basicAuth()}});
 if([301,302,303,307,308].includes(r.status)){
  const target=new URL(r.headers.get('location')||'',source);
  if(target.protocol!=='https:'||target.port||target.username||target.password||!['mms.twiliocdn.com','s3-external-1.amazonaws.com'].includes(target.hostname))throw fail('MEDIA_UNAVAILABLE','This attachment’s download address could not be verified.');
  // Never forward Twilio credentials to the temporary media CDN.
  r=await fetch(target,{redirect:'error',signal});
 }
 const type=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),max=4*1024*1024;
 if(!r.ok||!mediaTypes.has(type)||Number(r.headers.get('content-length')||0)>max)throw fail('MEDIA_UNAVAILABLE','Only photos up to 4 MB can be viewed here.');
 const chunks=[];let size=0;for await(const part of r.body){size+=part.length;if(size>max)throw fail('MEDIA_UNAVAILABLE','This photo exceeds the 4 MB viewing limit.');chunks.push(Buffer.from(part));}
 const bytes=Buffer.concat(chunks),magic=type==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/gif'?/^GIF8[79]a/.test(bytes.subarray(0,6).toString()):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!magic)throw fail('MEDIA_UNAVAILABLE','The attachment is not a supported photo.');
 res.setHeader('Content-Type',type);res.setHeader('Content-Disposition',`inline; filename="customer-photo-${b.index+1}.${mediaTypes.get(type)}"`);res.setHeader('X-Content-Type-Options','nosniff');return res.status(200).send(bytes);
}

export async function customerMessagingHandler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  if(req.method!=='POST')return res.status(405).json({error:'POST required',code:'INVALID_INPUT'});
  if(!await authorized(req))throw fail('AUTH_REQUIRED','Owner sign-in is required.');
  if(!String(req.headers['content-type']||'').includes('application/json'))return res.status(415).json({error:'JSON required',code:'INVALID_INPUT'});
  if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{throw fail('INVALID_INPUT','Invalid request origin.');}if(origin.host!==req.headers.host)return res.status(403).json({error:'Origin not allowed',code:'AUTH_REQUIRED'});}
  const b=req.body||{},setup=messagingStatus();
  if(b.operation==='status')return res.json(setup);
  if(b.operation==='send')return res.json(await sendReply({...b,actor_hash:createHash('sha256').update(String(req.headers['x-fieldops-key'])).digest('hex')}));
  if(b.operation==='media')return await media(req,res,b);
  if(b.operation==='list'){
   if(!setup.business_number)return res.json({...setup,threads:[],next_cursor:null});
   const c=cursor(b.cursor),rows=await rpc('fieldops_sms_list',{p_business_number:setup.business_number,p_before_at:c.at||null,p_before_phone:c.phone||null}),page=rows.slice(0,50),last=page.at(-1);
   return res.json({...setup,threads:page,next_cursor:rows.length>50?token({at:last.last_at,phone:last.phone}):null});
  }
  if(!phoneOK(b.phone))throw fail('INVALID_INPUT','Choose a valid customer conversation.');
  if(b.operation==='thread'){
   const c=cursor(b.before,true),data=await rpc('fieldops_sms_thread',{p_phone:b.phone,p_business_number:setup.business_number,p_before_at:c.at||null,p_before_id:c.id||null});
   const rows=data.messages||[],page=rows.slice(0,50),last=page.at(-1),state=data.state||{};
   return res.json({...setup,phone:b.phone,customer:data.customer||null,messages:page.reverse(),next_cursor:rows.length>50?token({at:last.at,id:last.id}):null,...state,can_reply:setup.outbound_ready&&!state.blocked&&!!state.reply_to_sid});
  }
  if(b.operation==='mark-read'){
   if(!sidOK(b.through_sid))throw fail('INVALID_INPUT','Choose the incoming message you viewed.');
   return res.json(await rpc('fieldops_sms_mark_read',{p_phone:b.phone,p_business_number:setup.business_number,p_through_sid:b.through_sid}));
  }
  throw fail('INVALID_INPUT','Unknown messaging action.');
 }catch(e){return responseError(res,e);}
}

export async function twilioStatusWebhook(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))return res.status(415).json({error:'Form body required'});
  const requestId=req.query?.request_id;if(!uuid(requestId))return res.status(400).json({error:'Invalid callback request'});
  if(!process.env.TWILIO_AUTH_TOKEN||!process.env.TWILIO_ACCOUNT_SID)return res.status(503).json({error:'Texting is not configured'});
  let b=req.body;if(typeof b==='string'){const pairs=[...new URLSearchParams(b)];if(new Set(pairs.map(x=>x[0])).size!==pairs.length)return res.status(400).json({error:'Duplicate parameter'});b=Object.fromEntries(pairs);}
  if(!validTwilioSignature(process.env.TWILIO_AUTH_TOKEN,statusUrl(requestId),b,req.headers['x-twilio-signature']))return res.status(403).json({error:'Invalid signature'});
  if(b.AccountSid!==process.env.TWILIO_ACCOUNT_SID||!sidOK(b.MessageSid)||!states.has(b.MessageStatus))return res.status(400).json({error:'Invalid delivery status'});
  const row=(await db(`fieldops_sms_outbox?request_id=eq.${requestId}&limit=1`))[0];if(!row)return res.status(404).json({error:'Send request unavailable'});
  if((b.To&&b.To!==row.phone)||(b.From&&b.From!==row.business_number)||(row.message_sid&&row.message_sid!==b.MessageSid))return res.status(403).json({error:'Unexpected message or recipient'});
  await rpc('fieldops_sms_result',{p_request_id:requestId,p_message_sid:b.MessageSid,p_status:b.MessageStatus,p_error_code:b.ErrorCode||null,p_error_detail:b.ErrorCode?'Message could not be delivered (Twilio code '+String(b.ErrorCode).slice(0,40)+').':null});
  return res.status(204).send('');
 }catch{return res.status(503).json({error:'Delivery status could not be saved; retry later'});}
}
