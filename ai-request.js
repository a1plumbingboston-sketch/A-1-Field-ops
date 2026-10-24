import { withinDeadline } from './request-deadline.js';
// Shared by quote wording and construction allocation. Never retry a paid request.
export async function requestAi(url, options={}, {timeoutMs=120000}={}) {
 const controller=new AbortController(),external=options.signal;
 let timer,abort;
 const canceled=new Promise((_,reject)=>{
  abort=()=>{const reason=external?.reason||new DOMException('Canceled','AbortError');controller.abort(reason);reject(reason);};
  if(external?.aborted)abort();else external?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{const reason=new DOMException('AI took too long to respond. Your draft is unchanged. Please try again.','TimeoutError');controller.abort(reason);reject(reason);},timeoutMs);
 });
 try {
  return await Promise.race([canceled,(async()=>{
   if(controller.signal.aborted)throw controller.signal.reason;
   const response=await fetch(url,{...options,signal:controller.signal});
   let data;try{data=await response.json();}catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw new Error('The AI connection ended before a complete result arrived. Your draft is unchanged. Please try again.');}
   if(controller.signal.aborted)throw controller.signal.reason;
   return {ok:response.ok,status:response.status,json:async()=>data};
  })()]);
 } finally {clearTimeout(timer);external?.removeEventListener('abort',abort);}
}
if(typeof window!=='undefined'){window.A1AiRequest=requestAi;window.A1WithinDeadline=withinDeadline;}
