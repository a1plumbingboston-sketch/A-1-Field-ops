// A hard deadline also settles when a network adapter ignores AbortSignal.
export async function withinDeadline(promise, ms, message='AI request timed out. Your draft is unchanged. Please try again.') {
 let timer;
 try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new DOMException(message,'TimeoutError')),ms);})]); }
 finally { clearTimeout(timer); }
}
