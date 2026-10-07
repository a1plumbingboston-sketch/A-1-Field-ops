import {authorized} from '../lib/db.js';
import {serviceInput,serviceSchema,serviceInstructions,calculateServiceQuote,retrievedSourceUrls} from '../lib/service-quote.js';
async function within(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Authentication timed out')),ms);})]);}finally{clearTimeout(timer);}}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('Service quote deadline exceeded','TimeoutError')),240000);
 const cancel=()=>{if(!res.writableEnded)controller.abort(new DOMException('Client disconnected','AbortError'));};res.once?.('close',cancel);
 try{
  if(!await within(authorized(req),15000))return res.status(401).json({error:'Authentication required'});
  if(controller.signal.aborted)return;
  let input;try{input=serviceInput(req.body);}catch(e){return res.status(400).json({error:e.message});}
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Service quote AI is not connected. Your draft is unchanged.'});
  const model=process.env.OPENAI_ESTIMATE_MODEL||'gpt-6-astra';
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,reasoning:{effort:'high'},max_output_tokens:6500,instructions:serviceInstructions,input:JSON.stringify({job:input}),tools:[{type:'web_search'}],include:['web_search_call.action.sources'],text:{format:{type:'json_schema',name:'service_quote',strict:true,schema:serviceSchema}}})});
  if(!response.ok){console.warn('[service-quote] provider failure',response.status,response.headers.get('x-request-id'));return res.status(502).json({error:response.status===429?'AI usage limit reached. Your draft is unchanged. Try again later.':'Service quote AI could not respond. Your draft is unchanged.'});}
  const data=await response.json();
  if(data.status!=='completed')return res.status(502).json({error:'AI did not complete the service scope. Your draft is unchanged.'});
  const text=(data.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  let analysis;try{analysis=calculateServiceQuote(JSON.parse(text),input,retrievedSourceUrls(data));}catch(e){console.warn('[service-quote] invalid output',data.id);return res.status(502).json({error:e instanceof SyntaxError?'AI returned unreadable service guidance. Your draft is unchanged.':e.message});}
  return res.json({analysis,model,usage:data.usage,request_id:data.id});
 }catch(e){if(controller.signal.reason?.name==='AbortError')return;return res.status(503).json({error:controller.signal.aborted?'Service quote request timed out or was canceled. Your draft is unchanged.':'Service quote AI is temporarily unavailable. Your draft is unchanged.'});}
 finally{clearTimeout(timer);res.off?.('close',cancel);}
}
