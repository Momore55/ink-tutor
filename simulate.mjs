// Evaluate the unified teaching policy with simulated new students.
// Usage: set GEMINI_API_KEY, then run node simulate.mjs [runsPerPersona=2].
// Optional: GEMINI_TEXT_MODEL (default gemini-3.8-flash, the model your server already uses).
// This tests teaching behaviour in text. It does not test voice, the board, or handwriting.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
require('./live-config.js');

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Set GEMINI_API_KEY.'); process.exit(1); }
const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
const runs = Number(process.argv[2] || 2);
const TURNS = 6;

const personas = [
  { name: 'weak', topic: 'adding fractions', persona: 'Grade 5 student. Shaky on fractions, answers briefly, often unsure. Believes 1/2 + 1/3 = 2/5 (adds tops and bottoms).' },
  { name: 'average', topic: 'solving linear equations', persona: 'Grade 8 student. Can do one-step equations, struggles when variables are on both sides. Answers in short sentences.' },
  { name: 'strong', topic: 'mean squared error', persona: 'University student. Comfortable with algebra, wants intuition for why errors are squared. Answers precisely.' },
  { name: 'misconception', topic: 'mean squared error', persona: 'High-school student who firmly believes a squared error can be negative if the original error was negative. Says so when asked.' },
  { name: 'silent', topic: 'percentages', persona: 'Grade 6 student who gives very short answers like "idk" or "ok" and rarely explains their thinking.' },
];

async function gemini(system, contents, json) {
  const body = { systemInstruction: { parts: [{ text: system }] }, contents };
  if (json) body.generationConfig = { responseMimeType: 'application/json' };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
}

const textOnly = 'TEXT TEST MODE: there is no whiteboard and no tools. Speak your reply in plain text only.';
const turn = (role, text) => ({ role, parts: [{ text }] });

async function converse(p) {
  const tutorSystem = InkLive.instructions({ plan: null, observations: [] }, []) + '\n' + textOnly;
  const studentSystem = `You are role-playing a student. ${p.persona} Reply with 1-2 short, realistic sentences. Never mention that you are role-playing.`;
  const log = [];
  let tutorView = [turn('user', `I want to learn about ${p.topic}.`)];
  log.push({ who: 'student', text: `I want to learn about ${p.topic}.` });
  for (let i = 0; i < TURNS; i++) {
    const tutor = await gemini(tutorSystem, tutorView, false);
    log.push({ who: 'tutor', text: tutor });
    tutorView.push(turn('model', tutor));
    const studentView = log.map(m => turn(m.who === 'student' ? 'model' : 'user', m.text));
    const student = await gemini(studentSystem, studentView, false);
    log.push({ who: 'student', text: student });
    tutorView.push(turn('user', student));
  }
  return log;
}

const rubric = ['explained_before_practice', 'varied_practice_at_milestones', 'checked_results_and_reasoning',
  'identified_missing_or_partial_answers', 'targeted_gap_repair', 'evidence_based_progression',
  'respected_requested_help_and_pace', 'no_wrong_math'];

async function judge(p, log) {
  const transcript = log.map(m => `${m.who.toUpperCase()}: ${m.text}`).join('\n');
  const raw = await gemini(
    'You are an experienced teacher grading an AI tutor. Score each criterion from 1 (poor) to 5 (excellent) for the TUTOR only. Return JSON: {"scores":{...},"worst_moment":"short quote and why"}. Criteria: ' +
    rubric.join(', ') + '. no_wrong_math: 5 means every mathematical claim is correct.',
    [turn('user', `Student profile: ${p.persona}\n\n${transcript}`)], true);
  return JSON.parse(raw);
}

const results = [];
const transcripts = [];
for (const p of personas) for (let r = 0; r < runs; r++) {
  try {
    const log = await converse(p);
    const grade = await judge(p, log);
    results.push({ persona: p.name, ...grade });
    transcripts.push({ persona: p.name, run: r, log, grade });
    console.log(`${p.name} #${r + 1} done`);
  } catch (e) { console.error(`${p.name} #${r + 1} failed: ${e.message}`); }
}

const mean = c => {
  const v = results.map(x => x.scores?.[c]).filter(Number.isFinite);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : 'n/a';
};
console.log('\ncriterion'.padEnd(42) + 'unified policy');
for (const c of rubric) console.log(c.padEnd(41) + mean(c));
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ model, transcripts }, null, 2));
console.log('\nFull transcripts and worst moments saved to results.json. Read the worst moments: scores alone mislead.');
