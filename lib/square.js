import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {db,rpc,uuid,tokenOK,authorized} from './db.js';
const api=()=>process.env.SQUARE_ENVIRONMENT==='sandbox'?'https://connect.squareupsandbox.com':'https://connect.squareup.com';
export const squareReady=()=>!!(process.env.SQUARE_ACCESS_TOKEN&&process.env.SQUARE_LOCATION_ID&&process.env.SQUARE_APPLICATION_ID&&process.env.SQUARE_WEBHOOK_SIGNATURE_KEY);
async function square(path,body){
 const r=await fetch(api()+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+process.env.SQUARE_ACCESS_TOKEN,'Square-Version':'2026-08-19','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const j=await r.json();if(!r.ok){const e=new Error('Square could not confirm payment. Retry this same payment link; do not pay again elsewhere yet.');e.definitive=r.status===400&&j.errors?.every(x=>['PAYMENT_METHOD_ERROR','INVALID_REQUEST_ERROR'].includes(x.category));throw e;}return j;
}
export async function checkSquare(){
 if(!squareReady())throw new Error('Square setup is incomplete');
 const {location}=await square('/v2/locations/'+encodeURIComponent(process.env.SQUARE_LOCATION_ID));
 if(location?.status!=='ACTIVE'||location.currency!=='USD'||!location.capabilities?.includes('CREDIT_CARD_PROCESSING'))throw new Error('Square has not enabled card processing for this location');
 const {subscriptions=[]}=await square('/v2/webhooks/subscriptions');
 const subscription=subscriptions.find(x=>x.enabled&&x.notification_url===process.env.SQUARE_WEBHOOK_URL);
 if(!subscription||!['payment.created','payment.updated','refund.created','refund.updated'].every(x=>subscription.event_types.includes(x)))throw new Error('Square webhook settings do not match. Check the signature key and payment/refund events.');
 const {subscription_test_result}=await square('/v2/webhooks/subscriptions/'+encodeURIComponent(subscription.id)+'/test',{event_type:'payment.created'});
 if(subscription_test_result?.status_code!==200)throw new Error('Square webhook verification failed. Check the saved signature key and redeploy after changing it.');
 return {connected:true,location:location.name};
}
export async function squareLink(id,amount){
 await checkSquare();
 const inv=(await db(`invoices?id=eq.${id}`))[0];if(!inv||inv.status==='void')throw new Error('Invoice is unavailable');
 const pays=await db(`payments?invoice_id=eq.${id}`);const balance=Math.round((Number(inv.total)-Number(inv.credit_amount||0)-pays.filter(p=>['paid','completed','succeeded'].includes(p.status)).reduce((s,p)=>s+Number(p.amount),0))*100)/100;
 const sum=amount===undefined?balance:Number(amount);if(!Number.isFinite(sum)||sum<=0||sum>balance||Math.abs(Math.round(sum*100)-sum*100)>0.000001)throw new Error('Invalid payment amount');
 const token=randomBytes(32).toString('hex');await db('fieldops_square_checkouts',{method:'POST',body:{token,invoice_id:id,amount:sum}});
 return {payment_url:process.env.FIELDOPS_PUBLIC_URL.replace(/\/$/,'')+'/pay.html?token='+token,amount:sum};
}
async function record(payment){
 if(!payment||payment.location_id!==process.env.SQUARE_LOCATION_ID||!uuid(payment.reference_id))return false;
 const c=(await db(`fieldops_square_checkouts?id=eq.${payment.reference_id}`))[0];if(!c)return false;
 if(payment.amount_money?.currency!=='USD'||Number(payment.amount_money.amount)!==Math.round(Number(c.amount)*100))throw new Error('Square payment amount conflict');
 if(payment.status==='COMPLETED')await rpc('fieldops_square_record',{p_checkout:c.id,p_payment:payment.id,p_event:'payment:'+payment.id,p_amount:Number(c.amount)});
 else if(['FAILED','CANCELED'].includes(payment.status))await db(`fieldops_square_checkouts?id=eq.${c.id}&status=eq.processing`,{method:'PATCH',body:{status:'failed',source_id:null}});
 return true;
}
async function webhook(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 const key=process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,url=process.env.SQUARE_WEBHOOK_URL;
 if(!key||!url)return res.status(503).json({error:'Square webhook is not configured'});
 const raw=req.rawBody;if(typeof raw!=='string')return res.status(400).json({error:'Raw body required'});
 const expected=createHmac('sha256',key).update(url+raw).digest('base64'),given=String(req.headers['x-square-hmacsha256-signature']||'');
 if(given.length!==expected.length||!timingSafeEqual(Buffer.from(given),Buffer.from(expected)))return res.status(401).json({error:'Invalid signature'});
 const event=JSON.parse(raw);
 if(['payment.created','payment.updated'].includes(event.type)){
 const id=event.data?.object?.payment?.id;if(id&&uuid(event.data?.object?.payment?.reference_id)){const {payment}=await square('/v2/payments/'+encodeURIComponent(id));await record(payment);}
 }else if(['refund.created','refund.updated'].includes(event.type)){
 const id=event.data?.object?.refund?.id;if(id){const {refund}=await square('/v2/refunds/'+encodeURIComponent(id));if(refund?.status==='COMPLETED'){
 const {payment}=await square('/v2/payments/'+encodeURIComponent(refund.payment_id));if(await record(payment)){
 if(refund.amount_money?.currency!=='USD')throw new Error('Refund currency conflict');
 await rpc('fieldops_square_record',{p_checkout:payment.reference_id,p_payment:payment.id,p_event:'refund:'+refund.id,p_amount:-Number(refund.amount_money.amount)/100});
 }}}
 }
 return res.json({received:true});
}
export async function squareHandler(req,res){
 if(req.query?.webhook==='square')return webhook(req,res);
 const b=req.body||{};
 if(b.action==='square-status'){if(!await authorized(req))return res.status(401).json({error:'Authentication required'});return res.json(await checkSquare());}
 if(b.action==='square-link'){
 if(!await authorized(req))return res.status(401).json({error:'Authentication required'});
 if(!uuid(b.id))return res.status(400).json({error:'Invalid invoice'});return res.json(await squareLink(b.id,b.amount));
 }
 if(!squareReady())return res.status(503).json({error:'Online payments are not enabled yet. Please contact A-1.'});
 const token=req.method==='GET'?req.query.token:b.token;
 if(!tokenOK(token))return res.status(400).json({error:'Invalid payment link'});
 const c=(await db(`fieldops_square_checkouts?token=eq.${encodeURIComponent(token)}`))[0];if(!c)return res.status(404).json({error:'Payment link not found'});
 if(req.method==='GET'){
 const inv=(await db(`invoices?id=eq.${c.invoice_id}`))[0];
 return res.json({amount:Number(c.amount),title:inv?.invoice_number||'A-1 Invoice',status:c.status,expired:Date.parse(c.expires_at)<Date.now(),application_id:process.env.SQUARE_APPLICATION_ID,location_id:process.env.SQUARE_LOCATION_ID,sandbox:process.env.SQUARE_ENVIRONMENT==='sandbox'});
 }
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(c.status==='open'&&(typeof b.source_id!=='string'||b.source_id.length<5||b.source_id.length>300))return res.status(400).json({error:'Invalid payment token'});
 await checkSquare();
 const attempt=await rpc('fieldops_square_begin',{p_token:token,p_source:JSON.stringify({source_id:String(b.source_id||''),verification_token:b.verification_token?String(b.verification_token):undefined})});
 if(attempt.status==='paid')return res.json({status:'COMPLETED'});
 let result;const source=attempt.source_id?.startsWith('{')?JSON.parse(attempt.source_id):{source_id:attempt.source_id};
 try{result=await square('/v2/payments',{source_id:source.source_id,verification_token:source.verification_token,idempotency_key:attempt.id,amount_money:{amount:Math.round(Number(attempt.amount)*100),currency:'USD'},location_id:process.env.SQUARE_LOCATION_ID,reference_id:attempt.id,autocomplete:true,note:'FieldOps invoice '+attempt.invoice_id});}
 catch(e){if(e.definitive){await db(`fieldops_square_checkouts?id=eq.${attempt.id}&status=eq.processing`,{method:'PATCH',body:{status:'failed',source_id:null}});throw new Error('Square declined this payment request. Contact A-1 for a new link before trying again.');}throw e;}
 await record(result.payment);return res.json({status:result.payment.status});
}
