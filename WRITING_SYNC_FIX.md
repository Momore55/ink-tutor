# Writing completion and calibration — 16 November 2026

## Change

The previous pen duration depended on path length. A short native voice unit could therefore end with part of a calculation missing. Native `generationComplete` now closes the speech window while its audio is still queued. At that boundary, or the next tool boundary, remaining strokes are fitted proportionally into the unplayed samples. Revealed strokes stay fixed; completion progresses in line order. Audio scheduling, playback rate and 250 ms startup lookahead are unchanged.

The pen reads the browser's estimated output clock, so prepared geometry remains hidden before associated playback. Optional calibration delays only visual time by 0–250 ms. **Writing timing → Test sound and pen** pairs three beeps with progressive strokes; the saved preference applies to the next class. Retest when changing speakers/headphones. Automatic hardware word-onset calibration was not performed.

Two additional real-test blockers were fixed: a 12-second queue cap interrupted a provider-generated-ahead explanation, and colon punctuation rejected labeled cost-function calculations. The queue is still bounded, now at 60 seconds (2.88 MB native PCM16 at 24 kHz, plus decoded buffers). Larger capacity does not delay first playback or slow speech. Colon/semicolon labels preserve the existing superscript and stacked-fraction layout.

## Verification

- 31 focused tests passed, including short-speech completion, smooth mid-stroke fitting, sequential batches, unchanged source start/end times, no writing before playback, pause, underrun, interruption and calibration delay.
- Synthetic real-browser regression passed pause/resume, progressive writing and preservation of partial ink on interruption.
- Isolated browser calibration test completed all three paired strokes, saved/reloaded the writing delay, and loaded both normal and measurement pages without exceptions.
- Controlled Gemini Live trials passed with no browser errors, incomplete actions or cancellations:

| Trial | Completed lines | Final calculation | Peak native audio queue |
| --- | --- | --- | --- |
| Algebra | 5 / 5 | x = 5 from 3x + 5 = 20 | 20.05 s |
| Mean squared error | 7 / 7 | MSE = 5/2 = 2.5 | 16.32 s |

Native voice explained supplied equations while the normal renderer wrote them. Supplying the full sequence is a test fixture only; no lesson examples were added to the app. Reports and optional tutor WAVs: `tests/artifacts/writing-fit-controlled/`. The algebra reply's first PCM-to-audible estimate was about 324 ms, consistent with the retained startup lookahead and browser output effects; this is not a response-latency benchmark.

No stroke began before the associated segment's scheduled audio window in these traces. Stroke completions stayed within 50 ms of that window's end; the algebra final stroke finished approximately 8 ms after the estimated endpoint, within one display frame. These are browser-clock estimates, not independent physical speaker or spoken-word alignment measurements.

## Limits and failed trials retained

The freely generated equation trial completed every prepared line but stopped its teaching at 3x = 15. Its missing division was a lesson-generation omission, not an unfinished pen stroke. The freely generated cost trial completed six visible calculations, then made repeated unnecessary drawing/erase attempts; those later pending/cancelled actions prevent calling the whole conversation a clean pass. Earlier reports predated the stricter all-actions acceptance check. Preserve them in `tests/artifacts/writing-fit/`; use controlled results to assess the duration fix specifically.

A caption in the controlled cost trial described the subtraction direction inconsistently with its negative errors. The displayed calculations use prediction minus actual and the MSE result is correct. The writing fix does not validate every spoken mathematical claim.

Exact phrase timing remains approximate because this model rejected output word timestamps. Tool bursts before audio have ambiguous boundaries. Calibration can compensate perceived output delay; it cannot identify when a particular equation is spoken. No universal pixel/timing constant guarantees per-word alignment. Independent speech alignment remains a Phase 0 release gate.

If all relevant audio has already played before a usable boundary arrives, the renderer cannot retroactively finish within that audio. It preserves an explicit failure rather than instantly revealing the rest. User interruption continues to preserve partial ink. General illustration support and teaching policy were not changed.

## Reproduce

```powershell
node --test tests/playback-sync.test.cjs tests/phase0.test.cjs
node tests/browser-sync.cjs
node tests/phase0-page.cjs
# Existing server with Gemini key required:
node tests/writing-live.cjs --controlled
# Broader generation behavior probe, which may expose teaching/tool failures:
node tests/writing-live.cjs
```

Refresh the app and begin a fresh class to load the frontend changes. No Python restart is needed for this change.
