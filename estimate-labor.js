// Shared by the estimate form and server so hourly guidance stays consistent.
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
    input.value = String(result.rate);
    const note = document.getElementById('estLaborRateNote');
    if (note) note.textContent = result.provisional
      ? `$${result.rate}/hour is provisional. Confirm site conditions before quoting. Existing line items change only when you edit or apply a new recommendation.`
      : `$${result.rate}/hour based on job difficulty. Used by Quick Price Check and AI. Existing line items change only when you edit or apply a new recommendation.`;
    return result;
  };
  window.A1EstimateLabor = Object.freeze({normalizeDifficulty, laborRateForDifficulty, sync});
  document.getElementById('estDescriptionQuestion8')?.addEventListener('change', sync);
  document.getElementById('estimateForm')?.addEventListener('reset', () => queueMicrotask(sync));
  sync();
}
