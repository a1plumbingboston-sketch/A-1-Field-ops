import {createHash} from 'node:crypto';
export const digest = s => createHash('sha256').update(s).digest('hex');
export const codeOK = s => /^[a-f0-9]{64}$/.test(s);
// Reads the raw employee access code from the HttpOnly cookie set at login.
// Returns '' if absent or malformed — callers treat that as "no employee identified".
export function employeeCode(req) {
  const raw = String(req.headers.cookie || '').split(';').map(x => x.trim())
    .find(x => x.startsWith('fieldops_employee='))?.slice(18) || '';
  return codeOK(raw) ? raw : '';
}
// SHA-256 digest of the current request's employee code, or null if none present.
// This is what gets passed as p_hash to fieldops_team / fieldops_audit — the DB
// only ever sees the digest, never the raw code, matching the existing pattern.
export function employeeHash(req) {
  const code = employeeCode(req);
  return code ? digest(code) : null;
}
