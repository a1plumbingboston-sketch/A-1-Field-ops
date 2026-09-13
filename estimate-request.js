export async function requestEstimate(input,{accessKey='',signal,onProgress=()=>{}}={}){
 const controller=new AbortController(),started=Date.now();
 const cancel=()=>controller.abort(signal?.reason||new DOMException('Canceled','AbortError'));
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 const timeout=setTimeout(()=>controller.abort(new DOMException('Estimate connection timed out','TimeoutError')),280000);
 const progress=()=>onProgress(Math.floor((Date.now()-started)/1000));
 const interval=setInterval(progress,10000);
 try{
  progress();
  const response=await fetch('/api/estimate-assist',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-fieldops-key':accessKey},body:JSON.stringify(input)});
  let data;
  try{data=await response.json();}catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw new Error('The estimate connection ended before a complete result arrived. Your draft is unchanged.');}
  if(controller.signal.aborted)throw controller.signal.reason;
  if(!response.ok)throw new Error(data.error||'AI estimator unavailable. Your draft is unchanged.');
  if(!data.analysis)throw new Error('No complete estimate was returned. Your draft is unchanged.');
  return data;
 }catch(error){
  if(controller.signal.aborted)throw new Error(controller.signal.reason?.name==='TimeoutError'?'The connection timed out. Your draft is unchanged; try again when your connection is stable.':'AI research canceled. Your draft is unchanged.');
  throw error;
 }finally{clearTimeout(timeout);clearInterval(interval);signal?.removeEventListener('abort',cancel);}
}
if(typeof window!=='undefined')window.A1EstimateRequest=requestEstimate;
