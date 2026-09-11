import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startServer} from './dev-server.js';
test('private price book, customer history, photos, and live delivery status',async()=>{
 const app=await startServer();try{
 const call=async(op,body={},key='test-key')=>{const r=await fetch(app.origin+'/api/documents',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':key},body:JSON.stringify({action:'tools',op,...body})});return {status:r.status,data:await r.json()};};
 assert.equal((await call('prices',{},'')).status,401);
 const price=(await call('price-save',{name:'Faucet service',description:'Replace faucet',category:'Plumbing',quantity:2,unit_price:125})).data[0];assert.ok(price.id);
 assert.equal((await call('prices')).data[0].name,'Faucet service');
 await call('price-save',{id:price.id,name:'Faucet service',description:'Revised scope',quantity:1,unit_price:175});assert.equal(Number((await call('prices')).data[0].unit_price),175);
 assert.notEqual((await call('price-save',{name:'Bad',quantity:-1,unit_price:1})).status,200);
 await call('price-archive',{id:price.id});assert.equal((await call('prices')).data.length,0);
 const photo={id:randomUUID(),job_id:app.job,caption:'Before fixture',phase:'before',image_data:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='};
 assert.equal((await call('photo-save',photo)).status,200);assert.equal((await call('photo-save',photo)).status,200);assert.equal((await call('photos',{job_id:app.job})).data.length,1);
 assert.equal((await call('photo',{id:photo.id})).data.caption,'Before fixture');
 assert.notEqual((await call('photo-save',{...photo,id:randomUUID(),image_data:'data:image/svg+xml;base64,PHN2Zz4='})).status,200);
 assert.equal((await call('photos',{job_id:randomUUID()})).data.length,0);
 await app.q("update jobs set archived_at=now(),status='completed' where id=$1",[app.job]);
 const h=(await call('history',{customer_id:app.customer})).data;assert.equal(h.jobs.length,1);assert.ok(h.jobs[0].archived_at);assert.equal((await call('history',{customer_id:randomUUID()})).data.jobs.length,0);
 await call('photo-remove',{id:photo.id});assert.equal((await call('photos',{job_id:app.job})).data.length,0);assert.equal((await call('photo',{id:photo.id})).data,null);
 const send=await fetch(app.origin+'/api/send-document',{method:'POST',headers:{'Content-Type':'application/json','x-fieldops-key':'test-key'},body:JSON.stringify({kind:'estimate',id:app.estimate})});assert.equal(send.status,200);
 const activity=(await call('deliveries',{kind:'estimate',id:app.estimate,refresh:true})).data;assert.equal(activity.rows[0].status,'delivered');assert.ok(activity.rows[0].checked_at);
 for(const table of ['fieldops_pricebook','fieldops_job_photos','fieldops_deliveries'])assert.equal((await app.q("select has_table_privilege('anon',$1,'SELECT') as allowed",[table]))[0].allowed,false);
 }finally{await app.close();}
});
