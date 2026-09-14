import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {digest,codeOK,employeeCode,employeeHash} from '../lib/actor.js';

const validCode='a'.repeat(64);

test('digest matches sha256 hex, mirroring what fieldops_staff.access_hash stores',()=>{
  assert.equal(digest('secret'),createHash('sha256').update('secret').digest('hex'));
});

test('codeOK only accepts exactly 64 lowercase hex characters',()=>{
  assert.equal(codeOK(validCode),true);
  assert.equal(codeOK(validCode.toUpperCase()),false);
  assert.equal(codeOK(validCode.slice(0,63)),false);
  assert.equal(codeOK(validCode+'a'),false);
  assert.equal(codeOK(''),false);
  assert.equal(codeOK('not-hex-at-all-'.repeat(5)),false);
});

test('employeeCode reads the fieldops_employee cookie and rejects malformed values',()=>{
  assert.equal(employeeCode({headers:{}}),'');
  assert.equal(employeeCode({headers:{cookie:`other=1; fieldops_employee=${validCode}; more=2`}}),validCode);
  assert.equal(employeeCode({headers:{cookie:'fieldops_employee=not-a-valid-code'}}),'');
});

test('employeeHash returns the digest of the cookie code, or null when no employee is identified',()=>{
  assert.equal(employeeHash({headers:{}}),null);
  assert.equal(employeeHash({headers:{cookie:`fieldops_employee=${validCode}`}}),digest(validCode));
});
