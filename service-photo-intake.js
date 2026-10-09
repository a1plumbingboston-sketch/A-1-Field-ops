// Session-only photos: deliberately excluded from draft storage and customer PDFs.
const field=document.getElementById('estDescription');
const tools=document.getElementById('serviceEstimateTools');
if(field&&tools){
 let photos=[],revision=0;
 const box=document.createElement('div');box.className='ai-panel';
 box.innerHTML='<label>Job photos (up to 3)<input id="estPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="meta">Add equipment and access photos, then describe the requested work. For spoken notes, use your phone keyboard’s microphone in Work to be quoted. Photos go to AI when you request an estimate; they are not attached to the customer quote.</p><button type="button" id="clearServicePhotos">Remove photos</button><p id="servicePhotoStatus" role="status"></p>';
 tools.prepend(box);
 const input=box.querySelector('input'),status=box.querySelector('[role="status"]');
 const changed=()=>input.dispatchEvent(new Event('input',{bubbles:true}));
 async function compress(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20000000)throw Error('Choose JPEG, PNG or WebP photos under 20 MB each.');
  const bitmap=await createImageBitmap(file);
  try{const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',0.75);if(data.length>700000)throw Error('This photo is too detailed. Choose a smaller photo.');return data;}finally{bitmap.close();}
 }
 input.addEventListener('change',async()=>{
  const generation=++revision;photos=[];changed();const files=[...input.files];
  if(files.length>3){input.value='';status.textContent='Choose up to three photos.';return;}
  status.textContent='Preparing photos…';input.disabled=true;
  try{const prepared=await Promise.all(files.map(compress));if(generation!==revision)return;photos=prepared;status.textContent=photos.length+' photos ready for AI review.';changed();}
  catch(e){if(generation===revision){input.value='';status.textContent=e.message;}}
  finally{if(generation===revision)input.disabled=false;}
 });
 function reset(){revision++;photos=[];input.value='';input.disabled=false;status.textContent='';changed();}
 box.querySelector('button').onclick=reset;
 document.getElementById('estimateForm').addEventListener('reset',reset);
 // Clearing on draft switches prevents another customer's photos leaking into a quote.
 for(const id of ['estCustomerId','estJobId','estQuoteMode'])document.getElementById(id)?.addEventListener('change',reset);
 for(const id of ['newEstimateBtn'])document.getElementById(id)?.addEventListener('click',reset);
 window.A1ServicePhotos=Object.freeze({capture:()=>[...photos],ready:()=>!input.disabled,reset});
}
