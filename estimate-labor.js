// Shared by the estimate form and server so hourly labor-rate guidance
// stays consistent. This is the single source of truth for the rate math —
// lib/labor-rate.js (server-only) imports rateForDifficulty/DEFAULT_RANGES
// from here rather than duplicating them, so the database-backed settings
// and the browser always agree on what a given difficulty is worth.
//
// Rates are configurable per work profile:
//   'service'      — day-to-day service calls
//   'construction' — remodels / builds (multi-task jobs)
// Each profile has an editable [min, max] range (Settings → Labor rates).
// standard/unassessed bill at the low end, difficult/specialist at the high
// end, moderate at the midpoint — same tiering as before, just rescaled to
// whatever range the owner has set instead of fixed $200/$225/$250.
export const DEFAULT_RANGES = {
  service: {min: 200, max: 250},
  construction: {min: 200, max: 250}
};

export function normalizeDifficulty(value) {
  const label = String(value ?? '').trim().toLowerCase();
  for (const key of ['standard', 'moderate', 'difficult', 'specialist']) {
    if (label === key || label.startsWith(key + ' ') || label.startsWith(key + '—')) return key;
  }
  return 'unassessed';
}

function validRange(range) {
  return range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min > 0 && range.max >= range.min;
}

// Pure: given a difficulty label and an explicit {min,max} range, returns
// the billable rate. Used directly server-side (where the range always
// comes from the database) and indirectly in the browser via
// laborRateForDifficulty(), which supplies the currently-loaded range.
export function rateForDifficulty(value, range) {
  const difficulty = normalizeDifficulty(value);
  const r = validRange(range) ? range : DEFAULT_RANGES.service;
  const mid = Math.round((r.min + r.max) / 2);
  const rate = difficulty === 'moderate' ? mid : (difficulty === 'difficult' || difficulty === 'specialist') ? r.max : r.min;
  const provisional = difficulty === 'unassessed' || difficulty === 'specialist';
  return {difficulty, rate, provisional};
}

// Module-level cache of the current ranges, refreshed by loadLaborRateRanges().
// Starts at the defaults so every caller has an instant, sensible answer
// even before the real settings have loaded from the server.
let ranges = {...DEFAULT_RANGES};

export function laborRateForDifficulty(value, profile = 'service') {
  return rateForDifficulty(value, ranges[profile] || DEFAULT_RANGES.service);
}

export function currentLaborRateRanges() {
  return ranges;
}

// Browser-only: fetches the owner's saved rate ranges and updates the cache
// used by laborRateForDifficulty(). Safe to call repeatedly; fails silently
// (keeping whatever was cached before) if offline or unauthenticated yet.
export async function loadLaborRateRanges(accessKey = '') {
  try {
    const key = accessKey || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('a1_fieldops_key') || '' : '');
    const r = await fetch('/api/documents?feature=labor-rate-settings', {headers: {'x-fieldops-key': key}});
    if (r.ok) {
      const j = await r.json();
      if (validRange(j?.service) && validRange(j?.construction)) ranges = {service: j.service, construction: j.construction};
    }
  } catch {}
  return ranges;
}

if (typeof window !== 'undefined') {
  const activeProfile = () => document.getElementById('estQuoteMode')?.value === 'remodel' ? 'construction' : 'service';
  const sync = (profileOverride) => {
    const selected = document.getElementById('estDescriptionQuestion8');
    const input = document.getElementById('estLaborRate');
    if (!selected || !input) return;
    const profile = profileOverride || activeProfile();
    const result = laborRateForDifficulty(selected.value, profile);
    const data=input.dataset||{};
    const previousAuto=data.autoRate;
    const manuallyEdited=previousAuto!==undefined&&input.value!==previousAuto;
    if(!manuallyEdited)input.value=String(result.rate);
    data.autoRate=String(result.rate);
    const r = ranges[profile] || DEFAULT_RANGES.service;
    // Configured ranges guide automatic rates; keep an explicitly entered or
    // historical positive rate valid when settings arrive or inputs resync.
    const enteredRate=Number(input.value);
    const preserveEntered=manuallyEdited&&Number.isFinite(enteredRate)&&enteredRate>0;
    input.min = String(preserveEntered?Math.min(r.min,enteredRate):r.min);
    input.max = String(preserveEntered?Math.max(r.max,enteredRate):r.max);
    const note = document.getElementById('estLaborRateNote');
    if (note) note.textContent = result.provisional
      ? `$${result.rate}/hour is provisional. Confirm site conditions before quoting. Existing line items change only when you edit or apply a new recommendation.`
      : `$${result.rate}/hour based on job difficulty ($${r.min}\u2013$${r.max} ${profile} range). Used by Quick Price Check and AI. Existing line items change only when you edit or apply a new recommendation.`;
    return result;
  };
  window.A1EstimateLabor = Object.freeze({normalizeDifficulty, laborRateForDifficulty, loadLaborRateRanges, currentLaborRateRanges, sync});
  document.getElementById('estDescriptionQuestion8')?.addEventListener('change', () => sync());
  document.getElementById('estQuoteMode')?.addEventListener('change', () => sync());
  document.getElementById('estimateForm')?.addEventListener('reset', () => queueMicrotask(() => {const input=document.getElementById('estLaborRate');if(input?.dataset)delete input.dataset.autoRate;sync();}));
  // Kick off a real load in the background; sync() already ran once above
  // with defaults so the form is never blank while this resolves.
  loadLaborRateRanges().then(() => sync());
  sync();
}

