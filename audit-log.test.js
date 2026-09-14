import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audit} from '../lib/db.js';

async function withEnv(fn){
  const originalFetch=global.fetch,originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-role-key';
  try{await fn();}
  finally{
    global.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
  }
}

test('audit() posts the expected shape to the fieldops_audit RPC',async()=>{
  await withEnv(async()=>{
    let captured;
    global.fetch=async(url,opts)=>{
      if(String(url).includes('rpc/fieldops_audit')){captured=JSON.parse(opts.body);return new Response(JSON.stringify(null),{status:200});}
      throw Error('Unexpected request: '+url);
    };
    await audit('payment_recorded','invoice','11111111-1111-4111-8111-111111111111',null,{amount:100,method:'check'});
    assert.equal(captured.p_action,'payment_recorded');
    assert.equal(captured.p_target_kind,'invoice');
    assert.equal(captured.p_target_id,'11111111-1111-4111-8111-111111111111');
    assert.equal(captured.p_hash,null);
    assert.equal(captured.p_detail.amount,100);
  });
});

test('audit() never throws, even when the network request fails',async()=>{
  await withEnv(async()=>{
    global.fetch=async()=>{throw Error('network down');};
    await assert.doesNotReject(audit('payment_recorded','invoice','x',null,{}));
  });
});

test('audit() never throws even when SUPABASE_SERVICE_ROLE_KEY is missing',async()=>{
  const originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{await assert.doesNotReject(audit('payment_recorded','invoice','x',null,{}));}
  finally{if(originalKey!==undefined)process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;}
});
