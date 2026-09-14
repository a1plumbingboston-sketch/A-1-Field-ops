// Difficulty supplies estimating context only. The user-entered hourly rate remains authoritative.
export function normalizeDifficulty(value) {
  const label = String(value ?? '').trim().toLowerCase();
  for (const key of ['standard', 'moderate', 'difficult', 'specialist']) {
    if (label === key || label.startsWith(key + ' ') || label.startsWith(key + '—')) return key;
  }
  return 'unassessed';
}

export function laborRateForDifficulty(value) {
  const difficulty = normalizeDifficulty(value);
  const rate = difficulty === 'moderate' ? 225 : ['difficult', 'specialist'].includes(difficulty) ? 250 : 200;
  const provisional = ['unassessed', 'specialist'].includes(difficulty);
  return {difficulty, rate, provisional};
}

if (typeof window !== 'undefined') {
  const sync = () => {
    const selected = document.getElementById('estDescriptionQuestion8');
    const input = document.getElementById('estLaborRate');
    if (!selected || !input) return;
    const result = laborRateForDifficulty(selected.value);
    const note = document.getElementById('estLaborRateNote');
    if (note) note.textContent = 'Job difficulty gives AI context only. It does not change your hourly rate.';
    return result;
  };
  window.A1EstimateLabor = Object.freeze({normalizeDifficulty, laborRateForDifficulty, sync});
  document.getElementById('estDescriptionQuestion8')?.addEventListener('change', sync);
  document.getElementById('estimateForm')?.addEventListener('reset', () => queueMicrotask(sync));
  sync();
}
