import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {teamHandler} from '../lib/team.js';
let db,job,staff,other,appointment;
const call=async(owner,hash,action,data={})=>(await db.query('select fieldops_team($1,$2,$3,$4) as result',[owner,hash,action,data])).rows[0].result;
const H='a'.repeat(64),H2='b'.repeat(64);
before(async()=>{db=new PGlite();await db.exec(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));await db.exec(await fs.readFile(new URL('../supabase/migrations/20260911211117_technician_workspace.sql',import.meta.url),'utf8'));job=(await db.query("insert into jobs(title) values('Test repair') returning id")).rows[0].id;staff=(await call(true,'','staff_save',{name:'Tech One',email:'one@example.test',color:'#2563eb',hash:H})).id;other=(await call(true,'','staff_save',{name:'Tech Two',email:'two@example.test',color:'#7c3aed',hash:H2})).id;});
after(()=>db.close());
test('employee identities are separate; no code hashes or unassigned jobs leak',async()=>{
 appointment=(await call(true,'','schedule',{job_id:job,staff_id:staff,starts_at:'2026-10-01T13:00:00Z',ends_at:'2026-10-01T15:00:00Z',instructions:'Replace fixture'})).id;
 const data={from:'2026-10-01',to:'2026-10-03'};
 const one=await call(false,H,'list',data),two=await call(false,H2,'list',data);
 assert.equal(one.appointments.length,1);assert.equal(two.appointments.length,0);assert.deepEqual(one.staff,[]);assert.deepEqual(one.jobs,[]);assert.ok(!JSON.stringify(one).includes(H));
 await assert.rejects(call(false,H2,'detail',{appointment_id:appointment}),/Not permitted/);
 await assert.rejects(call(false,H,'staff_save',{name:'Owner'}),/Not permitted/);
 await assert.rejects(call(false,H,'schedule',{}),/Not permitted/);
});
test('overlap blocked, adjacent visit allowed, stale schedule revision rejected',async()=>{
 await assert.rejects(call(true,'','schedule',{job_id:job,staff_id:staff,starts_at:'2026-10-01T14:00:00Z',ends_at:'2026-10-01T16:00:00Z'}),/conflict/);
 await call(true,'','schedule',{job_id:job,staff_id:staff,starts_at:'2026-10-01T15:00:00Z',ends_at:'2026-10-01T16:00:00Z'});
 await assert.rejects(call(true,'','schedule',{id:appointment,revision:0,job_id:job,staff_id:staff,starts_at:'2026-10-01T13:00:00Z',ends_at:'2026-10-01T15:00:00Z'}),/changed/);
});
test('messages and photos attributed server-side, retries idempotent, photos validated',async()=>{
 const data={appointment_id:appointment,request_id:randomUUID(),text:'Parts fitted',actor_name:'Owner',staff_id:other};
 await call(false,H,'message',data);await call(false,H,'message',data);
 const photo={appointment_id:appointment,request_id:randomUUID(),text:'After',image_data:'data:image/jpeg;base64,/9j/AA=='};
 await call(false,H,'photo',photo);await call(false,H,'photo',photo);
 await assert.rejects(call(false,H,'photo',{...photo,request_id:randomUUID(),image_data:'data:image/svg+xml,<svg/>'}),/JPEG/);
 const r=await call(false,H,'detail',{appointment_id:appointment});assert.equal(r.events.filter(e=>e.kind==='message').length,1);assert.equal(r.events.filter(e=>e.kind==='photo').length,1);assert.equal(r.events.find(e=>e.kind==='message').actor_name,'Tech One');
});
test('completion requires notes, employee cannot approve, no invoice created',async()=>{
 await assert.rejects(call(false,H,'status',{appointment_id:appointment,request_id:randomUUID(),status:'review'}),/Describe/);
 await assert.rejects(call(false,H,'status',{appointment_id:appointment,request_id:randomUUID(),status:'completed',text:'Done'}),/Not permitted/);
 await call(false,H,'status',{appointment_id:appointment,request_id:randomUUID(),status:'review',text:'Fixture replaced; no unresolved issues'});
 assert.equal((await db.query('select count(*) from invoices')).rows[0].count,0);
 assert.equal((await db.query('select status from jobs where id=$1',[job])).rows[0].status,'scheduled');
});
test('reassignment and disabled account immediately block reads and queued uploads',async()=>{
 await call(true,'','schedule',{id:appointment,revision:2,job_id:job,staff_id:other,starts_at:'2026-10-01T13:00:00Z',ends_at:'2026-10-01T15:00:00Z'});
 await assert.rejects(call(false,H,'message',{appointment_id:appointment,request_id:randomUUID(),text:'Queued before reassignment'}),/Not permitted/);
 await call(true,'','staff_save',{id:other,name:'Tech Two',email:'two@example.test',color:'#7c3aed',active:false});
 await assert.rejects(call(false,H2,'detail',{appointment_id:appointment}),/Authentication/);
});
test('public roles cannot read employee secrets or invoke workspace operations',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from fieldops_staff'),/permission denied/);await assert.rejects(call(true,'','list',{}),/permission denied/);await db.exec('reset role');}
});
test('HTTP boundary rejects cross-origin writes and missing credentials',async()=>{
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(b){this.body=b;return this;}});
 let res=response();await teamHandler({method:'POST',headers:{origin:'https://evil.test',host:'fieldops.test','content-type':'application/json'},body:{team_action:'schedule'}},res);assert.equal(res.code,403);
 res=response();await teamHandler({method:'POST',headers:{host:'fieldops.test','content-type':'application/json'},body:{team_action:'list'}},res);assert.equal(res.code,401);
});
test('work email is required and unique; new appointment retries do not duplicate unassigned work',async()=>{
 await assert.rejects(call(true,'','staff_save',{name:'No email',color:'#2563eb',hash:'c'.repeat(64)}),/email required/);
 await assert.rejects(call(true,'','staff_save',{name:'Duplicate',email:'ONE@EXAMPLE.TEST',color:'#2563eb',hash:'c'.repeat(64)}),/already uses/);
 const d={create_id:randomUUID(),job_id:job,starts_at:'2026-10-05T13:00:00Z',ends_at:'2026-10-05T14:00:00Z'};
 const a=await call(true,'','schedule',d),b=await call(true,'','schedule',d);assert.equal(a.id,b.id);assert.equal(b.already_saved,true);
});
test('photo payloads are loaded separately and recheck assignment',async()=>{
 // This appointment now belongs to the disabled second technician; owner can still review.
 const d=await call(true,'','detail',{appointment_id:appointment});const photo=d.events.find(e=>e.kind==='photo');assert.equal(photo.has_photo,true);assert.equal(photo.image_data,undefined);
 const img=await call(true,'','photo_read',{appointment_id:appointment,event_id:photo.id});assert.match(img.image_data,/^data:image\/jpeg/);
 await assert.rejects(call(false,H,'photo_read',{appointment_id:appointment,event_id:photo.id}),/Not permitted/);
});
