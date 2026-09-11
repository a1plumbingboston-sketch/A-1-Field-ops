import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completionNotes} from '../lib/work-summary.js';
test('completion report requires key facts without inventing successful checks',()=>{
 const facts={location:'Kitchen',performed:'Replaced faucet',materials:'One customer-supplied faucet',checks:'Not performed',outcome:'Return visit needed'};
 const s=completionNotes(facts);assert.match(s,/Checks performed and results: Not performed/);assert.match(s,/customer-supplied/);
 for(const key of Object.keys(facts))assert.throws(()=>completionNotes({...facts,[key]:''}),/required/);
 assert.throws(()=>completionNotes({...facts,performed:'a'.repeat(1001)}),/too long/);
});
