// Database-backed storage for the owner-configurable labor rate ranges.
// The rate math itself (DEFAULT_RANGES, rateForDifficulty) lives in the
// shared root file so the browser and server always compute the same
// number from the same range; this file is only concerned with reading and
// writing WHERE that range comes from.
import {DEFAULT_RANGES} from '../estimate-labor.js';
import {db, authorized, audit, clean} from './db.js';

export const PROFILES = ['service', 'construction'];

let cache = null, cachedAt = 0;
const CACHE_MS = 60000;

// Fails open to the defaults on any database error — a settings outage
// should never block estimating or invoicing.
export async function getLaborRateRanges() {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_MS) return cache;
  try {
    const rows = await db('fieldops_labor_rate_settings?select=profile,min_rate,max_rate');
    const ranges = {...DEFAULT_RANGES};
    for (const row of Array.isArray(rows) ? rows : []) {
      const min = Number(row.min_rate), max = Number(row.max_rate);
      if (PROFILES.includes(row.profile) && Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
        ranges[row.profile] = {min, max};
      }
    }
    cache = ranges;
    cachedAt = now;
    return ranges;
  } catch (e) {
    console.error('labor rate settings unavailable, using defaults:', e && e.message);
    return {...DEFAULT_RANGES};
  }
}

export function invalidateLaborRateCache() {
  cache = null;
}

// GET: current ranges for both profiles. POST: update one profile's range.
// Both are owner-key gated — the rate an owner charges isn't something an
// unauthenticated caller should be able to read or change.
export async function laborRateSettingsHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await authorized(req))) return res.status(401).json({error: 'Authentication required'});
  if (req.method === 'GET') {
    return res.status(200).json(await getLaborRateRanges());
  }
  if (req.method !== 'POST') return res.status(405).json({error: 'GET or POST only'});
  const {profile, min, max} = req.body || {};
  if (!PROFILES.includes(profile)) return res.status(400).json({error: 'Choose a service or construction rate to update.'});
  const minN = Number(min), maxN = Number(max);
  if (!Number.isFinite(minN) || !Number.isFinite(maxN) || minN <= 0 || minN > 1000 || maxN < minN || maxN > 1000) {
    return res.status(400).json({error: 'Enter a valid $1\u2013$1000 range, with the low end at or below the high end.'});
  }
  try {
    await db(`fieldops_labor_rate_settings?profile=eq.${profile}`, {
      method: 'PATCH',
      body: {min_rate: minN, max_rate: maxN, updated_at: new Date().toISOString(), updated_by: clean(req.headers['x-fieldops-key'] ? 'office key' : '', 40)}
    });
  } catch (e) {
    return res.status(502).json({error: 'Could not save the rate settings. Try again.'});
  }
  invalidateLaborRateCache();
  await audit('labor_rate_updated', 'settings', profile, null, {profile, min: minN, max: maxN});
  return res.status(200).json(await getLaborRateRanges());
}
