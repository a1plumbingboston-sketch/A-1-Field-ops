(function(root){
 const text=v=>String(v??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
 const stamp=v=>{const d=new Date(v);if(!Number.isFinite(d.getTime()))throw Error('This appointment needs a valid date and time.');return d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');};
 function fold(line){let result='',part='',bytes=0;for(const ch of line){const n=new TextEncoder().encode(ch).length;if(bytes+n>74){result+=part+'\r\n ';part='';bytes=1;}part+=ch;bytes+=n;}return result+part;}
 function build(a,c={},now=new Date()){
  if(!/^[a-f0-9-]{36}$/i.test(a.id||''))throw Error('Choose a saved appointment.');
  if(a.status==='cancelled')throw Error('This appointment was cancelled.');
  if(new Date(a.ends_at)<=new Date(a.starts_at))throw Error('End time must be after the start time.');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//A-1 Plumbing//FieldOps//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+a.id+'@fieldops.a1plumbing.boston','DTSTAMP:'+stamp(now),'DTSTART:'+stamp(a.starts_at),'DTEND:'+stamp(a.ends_at),'SUMMARY:'+text('A-1 · '+(c.title||'Service appointment')),'LOCATION:'+text(c.address||''),'DESCRIPTION:'+text('Copied from FieldOps. Changes do not sync automatically; check FieldOps for the current schedule.'),'STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
 }
 async function download(a,c){const contents=build(a,c),name='A1-appointment-'+a.id.slice(0,8)+'.ics',file=new File([contents],name,{type:'text/calendar;charset=utf-8'});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'A-1 appointment'});return;}catch(e){if(e.name==='AbortError')return;}}
  const url=window.URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>window.URL.revokeObjectURL(url),10000);
 }
 root.A1Calendar={build,download};
})(globalThis);
