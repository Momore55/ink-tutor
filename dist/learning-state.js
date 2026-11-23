// Small, inspectable learning summaries. Full conversations and audio are not stored.
globalThis.InkLearning = (() => {
  const storageKey = 'ink-tutor.learning.v1';
  const empty = () => ({ version: 1, plan: null, observations: [] });
  const shortText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
  const statuses = ['working_on', 'needs_help', 'demonstrated'];

  function validatePlan(plan) {
    return plan && shortText(plan.goal, 200) &&
      Array.isArray(plan.steps) && plan.steps.length >= 1 && plan.steps.length <= 5 &&
      plan.steps.every(step => step && shortText(step.title, 100) && ['pending', 'current', 'complete'].includes(step.status)) &&
      plan.steps.filter(step => step.status === 'current').length <= 1;
  }

  function validateObservation(note) {
    return note && shortText(note.concept, 100) && statuses.includes(note.status) && shortText(note.evidence, 240) &&
      (note.lastError === undefined || shortText(note.lastError, 160));
  }

  let state = empty();
  let persistent = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.version === 1 && (saved.plan === null || validatePlan(saved.plan)) &&
        Array.isArray(saved.observations) && saved.observations.length <= 12 &&
        saved.observations.every(validateObservation)) state = saved;
  } catch {
    // Storage can be disabled or contain an older, invalid value.
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      persistent = true;
    } catch {
      persistent = false;
    }
  }

  function update(change, studentUtterances) {
    if (!change || typeof change !== 'object') return { error: 'Supply a learning update.' };
    if (change.plan !== undefined && !validatePlan(change.plan)) {
      return { error: 'Supply a goal and one to five short plan steps with valid statuses.' };
    }
    const notes = change.observations ?? [];
    if (!Array.isArray(notes) || notes.length > 4 || !notes.every(validateObservation)) {
      return { error: 'Supply up to four short, evidence-backed observations.' };
    }
    const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // Speech transcripts rarely match a model's quote character for character, so accept an exact
    // match or a quote whose words mostly appear in what the student actually said.
    const words = text => normalize(text).split(' ').filter(Boolean);
    const supported = notes.every(note => {
      const evidence = normalize(note.evidence);
      if (evidence.length < 3) return false;
      if (studentUtterances.some(utterance => normalize(utterance).includes(evidence))) return true;
      const quoted = words(note.evidence);
      if (quoted.length < 2) return false;
      return studentUtterances.some(utterance => {
        const spoken = new Set(words(utterance));
        return quoted.filter(word => spoken.has(word)).length / quoted.length >= 0.7;
      });
    });
    if (!supported) return { error: 'Evidence must quote the student’s actual words in this session. Do not infer mastery from your explanation.' };
    if (change.plan) state.plan = JSON.parse(JSON.stringify(change.plan));
    for (const note of notes) {
      state.observations = state.observations.filter(saved => saved.concept.toLowerCase() !== note.concept.toLowerCase());
      state.observations.push({
        concept: note.concept.trim(), status: note.status, evidence: note.evidence.trim(),
        ...(note.lastError ? { lastError: note.lastError.trim() } : {}),
      });
    }
    state.observations = state.observations.slice(-12);
    persist();
    return { ok: true };
  }

  function clear() {
    state = empty();
    persist();
  }

  return { update, clear, snapshot: () => JSON.parse(JSON.stringify(state)), isPersistent: () => persistent };
})();
