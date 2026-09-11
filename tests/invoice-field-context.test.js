import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/invoice-assist.js';
test('invoice AI reads manager job notes and approved technician facts through actual invoice relation',async()=>{
 const original=global.fetch,previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only';let prompt='',appointmentQuery='';
 const invoice='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',appointment='33333333-3333-4333-8333-333333333333';
 global.fetch=async(url,options={})=>{const u=String(url);
 if(u.includes('fieldops_key_status'))return Response.json(true);
 if(u.includes('/invoices?'))return Response.json([{job_id:job}]);
 if(u.includes('/jobs?'))return Response.json([{title:'Valve repair',notes:'Manager: customer supplied the valve.'}]);
 if(u.includes('/fieldops_appointments?')){appointmentQuery=u;return Response.json([{id:appointment}]);}
 if(u.includes('/fieldops_team_events?'))return Response.json([{text:'completed: Approved'},{text:'review: Work location: Private basement\nWork performed: Replaced valve\nChecks performed and results: Not performed\nOutcome and outstanding work: Testing pending'}]);
 if(u==='https://api.openai.com/v1/responses'){prompt=JSON.parse(options.body).input;return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({brief_description:'Replaced the customer-supplied valve. Testing remains pending.',line_items:[],customer_message:''})}]}]});}
 throw Error('Unexpected URL '+u);
 };
 const oldService=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
 try{const res={setHeader(){},status(s){this.code=s;return this;},json(j){this.body=j;return this;}};
 await handler({method:'POST',headers:{'x-fieldops-key':'test-key'},body:{invoice_id:invoice,title:'Valve repair',description:'Manager invoice description',items:[],total:75}},res);
 assert.equal(res.code,200);assert.equal(res.body.field_report_used,true);assert.match(appointmentQuery,/status=eq.completed/);assert.match(prompt,/Manager: customer supplied the valve/);assert.match(prompt,/Checks performed and results: Not performed/);assert.match(prompt,/Manager invoice description/);assert.ok(!prompt.includes('Private basement'));assert.match(prompt,/If facts conflict, do not guess/);
 }finally{global.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;if(oldService===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldService;}
});
