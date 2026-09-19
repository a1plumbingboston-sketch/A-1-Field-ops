// Lets the owner change the hourly labor rate ranges themselves, instead of
// them being fixed in code. Two independent ranges: 'service' for
// day-to-day calls, 'construction' for remodels/builds. Standard/unassessed
// work bills at the low end of a range, difficult/specialist at the high
// end, moderate at the midpoint — see estimate-labor.js for the math.
import {loadLaborRateRanges, currentLaborRateRanges} from './estimate-labor.js';
const $ = s => document.querySelector(s);

const box = document.createElement('section');
box.id = 'laborRateSettings'; box.hidden = true; box.className = 'remodel-quoter';
box.innerHTML = `<div class="remodel-heading"><div><p class="eyebrow">SETTINGS</p><h2>Set hourly rates</h2><p>Set what you charge per hour. This does not change technician pay.</p></div><button type="button" id="closeLaborRateSettings">Close</button></div><form id="laborRateForm"><p class="meta">For one flat hourly rate, enter the same number in both boxes. Or use a low and high rate so job difficulty can suggest a rate within your range.</p><fieldset><legend>Service calls</legend><p class="meta">Used for regular service estimates and AI-generated service labor pricing.</p><div class="remodel-grid"><label>Standard / minimum ($/hr)<input name="service_min" type="number" min="1" max="1000" step="1" required></label><label>Difficult / maximum ($/hr)<input name="service_max" type="number" min="1" max="1000" step="1" required></label></div></fieldset><fieldset><legend>Remodel / construction builds</legend><p class="meta">Used when hourly construction pricing is requested. Your custom total in the Remodel / Construction Estimator remains authoritative.</p><div class="remodel-grid"><label>Standard / minimum ($/hr)<input name="construction_min" type="number" min="1" max="1000" step="1" required></label><label>Difficult / maximum ($/hr)<input name="construction_max" type="number" min="1" max="1000" step="1" required></label></div></fieldset><p class="meta">Existing quotes are unaffected. You can also enter a one-job rate directly in the Customer labor rate field while building an estimate.</p><div class="remodel-actions"><button class="convert" type="submit">Save hourly rates</button></div><p id="laborRateStatus" role="status" class="meta"></p></form>`;
document.body.appendChild(box);
const open = document.createElement('button');
open.id = 'openLaborRateSettings'; open.type = 'button'; open.textContent = '\u2699 Set hourly rates';
document.getElementById('newTaskEstimatorBtn')?.after(open) ?? document.getElementById('newEstimateBtn')?.after(open);

const form = $('#laborRateForm');
async function populate() {
  await loadLaborRateRanges();
  const r = currentLaborRateRanges();
  form.service_min.value = r.service.min; form.service_max.value = r.service.max;
  form.construction_min.value = r.construction.min; form.construction_max.value = r.construction.max;
}
open.onclick = async () => { box.hidden = false; box.scrollIntoView({behavior: 'smooth', block: 'start'}); $('#laborRateStatus').textContent = 'Loading current rates\u2026'; await populate(); $('#laborRateStatus').textContent = ''; };
$('#closeLaborRateSettings').onclick = () => { box.hidden = true; open.focus(); };

form.onsubmit = async e => {
  e.preventDefault();
  const status = $('#laborRateStatus');
  const button = e.submitter; button.disabled = true;
  status.textContent = 'Saving\u2026';
  try {
    const key = window.A1RemodelBridge?.key() || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('a1_fieldops_key') || '' : '');
    for (const profile of ['service', 'construction']) {
      const min = Number(form[profile + '_min'].value), max = Number(form[profile + '_max'].value);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) throw new Error(`Enter a valid ${profile} rate range \u2014 the low end must be at or below the high end.`);
      const r = await fetch('/api/documents?feature=labor-rate-settings', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-fieldops-key': key}, body: JSON.stringify({profile, min, max})});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Could not save the ${profile} rate.`);
    }
    await loadLaborRateRanges();
    status.textContent = 'Rates saved. New quotes will use the updated range.';
  } catch (err) { status.textContent = err.message; }
  finally { button.disabled = false; }
};
