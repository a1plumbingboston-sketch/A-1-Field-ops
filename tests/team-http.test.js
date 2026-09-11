import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from './dev-server.js';
import {randomUUID} from 'node:crypto';
test('owner creates employee, employee logs in with secure cookie and posts to assigned job',async()=>{
 const s=await startServer();try{
 const request=async(action,data={},headers={})=>{const r=await fetch(s.origin+'/api/documents',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({action:'team',team_action:action,...(action==='login'?{code:data.code}:{data})})});return {r,j:await r.json()};};
 const owner={'x-fieldops-key':'test-key'};
 const staff=await request('staff_save',{name:'Pilot Technician',email:'pilot@example.test',color:'#2563eb'},owner);assert.equal(staff.r.status,200);assert.match(staff.j.access_code,/^[a-f0-9]{64}$/);
 const login=await request('login',{code:staff.j.access_code});assert.equal(login.r.status,200);assert.match(login.r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 const employee={cookie:login.r.headers.get('set-cookie').split(';')[0]};
 const ap=await request('schedule',{job_id:s.job,staff_id:staff.j.id,starts_at:'2026-10-01T13:00:00Z',ends_at:'2026-10-01T14:00:00Z'},owner);assert.equal(ap.r.status,200);
 const list=await request('list',{from:'2026-10-01',to:'2026-10-02'},employee);assert.equal(list.j.appointments.length,1);assert.equal(list.j.owner,false);
 const message=await request('message',{appointment_id:ap.j.id,request_id:randomUUID(),text:'Arrived'},employee);assert.equal(message.r.status,200);
 const deniedReview=await request('status',{appointment_id:ap.j.id,request_id:randomUUID(),status:'review',text:'Done'},employee);assert.equal(deniedReview.r.status,409);
 const reviewed=await request('status',{appointment_id:ap.j.id,request_id:randomUUID(),status:'review',completion:{location:'Basement',performed:'Replaced valve',materials:'One owner-supplied valve',checks:'Not performed',outcome:'Return visit needed for testing'}},employee);assert.equal(reviewed.r.status,200);
 const attention=await request('attention',{},owner);assert.equal(attention.j.appointments.length,1);assert.equal((await request('attention',{},employee)).r.status,403);
 assert.equal((await request('staff_save',{name:'Fake owner'},employee)).r.status,403);
 const ownerApi=await fetch(s.origin+'/api/documents?kind=invoice&id='+randomUUID(),{headers:employee});assert.equal(ownerApi.status,401);
 await request('staff_save',{id:staff.j.id,name:'Pilot Technician',email:'pilot@example.test',color:'#2563eb',active:false},owner);
 assert.equal((await request('detail',{appointment_id:ap.j.id},employee)).r.status,401);
 }finally{await s.close();}
});
