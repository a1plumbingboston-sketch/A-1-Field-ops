// Replaces remodel-quoter.js. One itemized task-list builder for BOTH
// service calls and construction/remodel builds — a job type selector
// picks which of the two owner-configurable rate ranges applies, and every
// task gets its own quantity, difficulty, hours and materials instead of
// a job forced into exactly four fixed phases. Submits to /api/estimate-assist,
// the same unified AI endpoint used by the main estimate form's quick
// research button.
import {laborRateForDifficulty, loadLaborRateRanges} from './estimate-labor.js';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = n => n.toLocaleString('en-US', {style: 'currency', currency: 'USD'});
const STORAGE_KEY = 'a1_task_estimator_v1';
const difficultyLabel = {unassessed: 'Not assessed', standard: 'Standard', moderate: 'Moderate', difficult: 'Difficult', specialist: 'Specialist'};

function currentProfile() { return $('#taskProfile')?.value === 'construction' ? 'construction' : 'service'; }
function difficultyOptionsHTML(selected = '') {
  const profile = currentProfile();
  return Object.keys(difficultyLabel).map(d => {
    const {rate, provisional} = laborRateForDifficulty(d, profile);
    return `<option value="${d}"${d === selected ? ' selected' : ''}>${difficultyLabel[d]} \u2014 $${rate}/hr${provisional ? ' provisional' : ''}</option>`;
  }).join('');
}
function refreshDifficultyOptions() {
  for (const select of document.querySelectorAll('#taskList .task-difficulty')) {
    const current = select.value;
    select.innerHTML = difficultyOptionsHTML(current);
  }
}
let rowCount = 0;
function taskRowHTML(vals = {}) {
  const i = rowCount++;
  return `<div class="task-row" data-i="${i}"><label>Task<input class="task-name" maxlength="200" placeholder="e.g. Install toilet flange" value="${esc(vals.name || '')}"></label><label>Qty<input class="task-qty" type="number" min="1" max="1000" step="1" value="${vals.quantity || 1}"></label><label>Difficulty<select class="task-difficulty">${difficultyOptionsHTML(vals.difficulty)}</select></label><label>Hours each<input class="task-hours" type="number" min="0" max="1000" step="0.25" placeholder="AI estimate" value="${vals.hours ?? ''}"></label><label>Materials ($ each)<input class="task-materials" type="number" min="0" max="100000" step="0.01" placeholder="Unpriced" value="${vals.materials ?? ''}"></label><button type="button" class="remove-task">Remove</button></div>`;
}

const box = document.createElement('section');
box.id = 'taskEstimator'; box.hidden = true; box.className = 'remodel-quoter';
box.innerHTML = `<div class="remodel-heading"><div><p class="eyebrow">PROJECT STUDIO</p><h2>Task Estimator</h2><p>Build a job from a list of tasks — from one quick service call to a full multi-fixture remodel.</p></div><button type="button" id="closeTaskEstimator">Close</button></div><form id="taskEstimatorForm"><fieldset><legend>01 \u00b7 Job type &amp; scope</legend><div class="remodel-grid"><label>Job type<select name="profile" id="taskProfile"><option value="service">Service call</option><option value="construction">Remodel / construction build</option></select></label><label>Job location<input name="location" maxlength="240" placeholder="Room, floor, city"></label></div><label>Project / job title<input name="project" maxlength="300" placeholder="e.g. Two-bathroom + kitchen remodel"></label><label>Overall scope<textarea name="scope" required minlength="10" maxlength="6000" placeholder="Describe the job. For a punch list, name the rooms/areas covered — the tasks below carry the itemized work."></textarea></label></fieldset><fieldset><legend>02 \u00b7 Conditions &amp; responsibilities</legend><div class="remodel-grid"><label>Site conditions &amp; access<textarea name="conditions" maxlength="2400" placeholder="Open walls, existing pipe condition, occupied home, stairs, parking, protection"></textarea></label><label>Who handles what?<textarea name="responsibilities" maxlength="2400" placeholder="Demolition, framing, electrical, tile, wall repair, cleanup"></textarea></label><label>Permits &amp; inspections<textarea name="permits" maxlength="2400" placeholder="Permit applicant, expected inspections; unknown if not confirmed"></textarea></label><label>Timing &amp; return visits<textarea name="schedule" maxlength="2400" placeholder="Timing, other-trade dependencies, extra trips"></textarea></label></div><label>Explicit exclusions<textarea name="exclusions" maxlength="2400" placeholder="Anything outside this plumbing scope"></textarea></label></fieldset><fieldset><legend>03 \u00b7 Task list</legend><p class="meta">Add one row per task. Use quantity for repeated items (e.g. 3 toilet flanges across 3 bathrooms). Leave hours blank for an AI estimate per task; enter 0 for excluded work. Material cost is your raw purchase cost per unit; markup applies once.</p><div class="task-list" id="taskList"></div><button type="button" id="addTask">+ Add task</button><div class="remodel-grid" style="margin-top:14px"><label>Raw-material markup (%)<input name="markup" type="number" min="0" max="100" value="25" required></label><label>Permit &amp; outside costs ($; passed through without markup)<input name="fees" type="number" min="0" max="100000" step="0.01" placeholder="Unpriced \u2014 enter 0 if none"></label></div></fieldset><div class="remodel-actions"><button class="convert" type="submit" id="buildTaskEstimate">\u2726 Build proposal</button><button type="button" id="clearTaskEstimator">Clear intake</button></div><p id="taskStatus" role="status" class="meta"></p></form><div id="taskResult" aria-live="polite"></div>`;
$('#estimateForm').before(box);
const open = document.createElement('button');
open.id = 'newTaskEstimatorBtn'; open.type = 'button'; open.textContent = '\u2726 Task Estimator';
$('#newEstimateBtn').after(open);

const form = $('#taskEstimatorForm');
let draft = null, inputSnapshot = '';
function readTasks() {
  return [...document.querySelectorAll('#taskList .task-row')].map(row => ({
    name: row.querySelector('.task-name').value.trim(),
    quantity: row.querySelector('.task-qty').value,
    difficulty: row.querySelector('.task-difficulty').value,
    hours: row.querySelector('.task-hours').value,
    materials: row.querySelector('.task-materials').value
  }));
}
function inputs() { const v = Object.fromEntries(new FormData(form)); v.tasks = readTasks(); return v; }
function resetResult() { draft = null; $('#taskResult').innerHTML = ''; }
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs())); $('#taskStatus').textContent = 'Intake saved on this device. Nothing has been sent.'; }
  catch { $('#taskStatus').textContent = 'Recovery storage is unavailable. Keep this page open.'; }
}
function addTaskRow(vals) { $('#taskList').insertAdjacentHTML('beforeend', taskRowHTML(vals)); }
function renderTasksFrom(list) { $('#taskList').innerHTML = ''; (Array.isArray(list) && list.length ? list : [{}]).forEach(addTaskRow); }

try {
  const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (v) {
    for (const el of form.elements) if (el.name && el.name !== 'tasks' && v[el.name] !== undefined) el.value = v[el.name];
    renderTasksFrom(v.tasks);
  } else renderTasksFrom(null);
} catch { renderTasksFrom(null); }

loadLaborRateRanges().then(refreshDifficultyOptions);
open.onclick = () => { box.hidden = false; box.scrollIntoView({behavior: 'smooth', block: 'start'}); };
$('#closeTaskEstimator').onclick = () => { box.hidden = true; open.focus(); };
$('#clearTaskEstimator').onclick = () => {
  if (!confirm('Clear this intake? Saved quotes stay unchanged.')) return;
  form.reset(); renderTasksFrom(null); resetResult(); localStorage.removeItem(STORAGE_KEY); $('#taskStatus').textContent = '';
};
$('#addTask').onclick = () => { addTaskRow(); save(); };
$('#taskList').addEventListener('click', e => { if (e.target.classList.contains('remove-task')) { e.target.closest('.task-row').remove(); resetResult(); save(); } });
$('#taskProfile').addEventListener('change', () => { refreshDifficultyOptions(); resetResult(); save(); });
form.addEventListener('input', () => { resetResult(); save(); });
form.addEventListener('change', () => { resetResult(); save(); });

form.onsubmit = async e => {
  e.preventDefault();
  const btn = $('#buildTaskEstimate');
  if (btn.disabled) return;
  resetResult();
  const x = inputs();
  if (!x.scope || x.scope.trim().length < 10) { $('#taskStatus').textContent = 'Describe the overall scope first.'; return; }
  if (!x.tasks.length || x.tasks.every(t => !t.name)) { $('#taskStatus').textContent = 'Add at least one task.'; return; }
  inputSnapshot = JSON.stringify(inputs());
  btn.disabled = true;
  $('#taskStatus').textContent = 'Reviewing the scope and pricing each task\u2026';
  try {
    const r = await fetch('/api/estimate-assist', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-fieldops-key': window.A1RemodelBridge.key()}, body: JSON.stringify(x)});
    const j = await r.json();
    if (!r.ok) throw Error(j.error || 'Could not build this estimate.');
    if (inputSnapshot !== JSON.stringify(inputs())) throw Error('The intake changed while AI was writing. Build again with your latest details.');
    draft = j.draft;
    render(x, j.quote, j.draft);
    $('#taskStatus').textContent = 'Proposal ready for review. Nothing has been saved or sent.';
  } catch (err) { $('#taskStatus').textContent = err.message; }
  finally { btn.disabled = false; }
};

function render(x, quote, aiDraft) {
  $('#taskResult').innerHTML = `<div class="remodel-proposal"><p class="eyebrow">${quote.isBudget ? 'BUDGET \u00b7 REVIEW REQUIRED' : 'PROPOSED FIXED PRICE \u00b7 OWNER REVIEW'}</p><div class="remodel-heading"><h3>${esc(x.project || x.scope.slice(0, 60))}</h3><strong class="remodel-total">${money(quote.total)}</strong></div><p>${esc(aiDraft.summary)}</p>${quote.tasks.map(t => `<div class="remodel-price-row"><div><b>${esc(t.description)}</b><p class="meta">${t.quantity !== 1 ? t.quantity + ' \u00d7 ' : ''}${t.hoursPerUnit} hr each \u00b7 ${money(t.rate)}/hr \u00b7 labor ${money(t.labor)} \u00b7 marked-up materials ${money(t.materials)}</p><p class="meta">${esc(t.reason)}</p></div><b>${money(t.total)}</b></div>`).join('')}${Number(x.fees) > 0 ? `<p>Permit &amp; outside allowance: ${money(Number(x.fees))}</p>` : ''}${quote.checks.length ? `<div class="remodel-review"><h3>Confirm before a firm quote</h3><ul>${quote.checks.map(s => `<li>${esc(s)}</li>`).join('')}</ul><p>Edit the details above and build again when these details are known.</p></div>` : ''}<details><summary>Customer scope &amp; exclusions</summary><p style="white-space:pre-line">${esc(quote.description)}</p></details><label class="remodel-approval"><input id="reviewTaskEstimate" type="checkbox"> I reviewed the tasks, pricing, allowances, and exclusions.</label><button type="button" id="applyTaskEstimate" class="convert" disabled>Use in draft quote</button><p class="meta">Next, choose the client and job, review the line items, and save. This does not send the quote.</p></div>`;
  $('#reviewTaskEstimate').onchange = e => $('#applyTaskEstimate').disabled = !e.target.checked;
  $('#applyTaskEstimate').onclick = async () => {
    if (inputSnapshot !== JSON.stringify(inputs()) || !$('#reviewTaskEstimate').checked) return;
    const btn = $('#applyTaskEstimate');
    btn.disabled = true;
    try {
      const applied = await window.A1RemodelBridge.apply({title: x.project || x.scope.slice(0, 80), description: quote.description, items: quote.items, profile: x.profile});
      if (applied) { box.hidden = true; $('#estimateForm').scrollIntoView({behavior: 'smooth', block: 'start'}); }
    } catch (err) { $('#taskStatus').textContent = err.message; }
    finally { btn.disabled = false; }
  };
}
