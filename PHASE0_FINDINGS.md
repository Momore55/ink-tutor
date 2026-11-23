# Phase 0: voice–board synchronization

16 November 2026. Build specification: [SRS v1.1](specs/VOICE_BOARD_SYNC_SRS_v1.1.md).

**Status: instrumentation and initial pilots; Phase 0 exit criteria are not met.** Normal classes retain native Gemini Live voice and the single teaching policy. No external speech recognition or text-to-speech service was added.

**Subsequent writing fix:** [WRITING_SYNC_FIX.md](WRITING_SYNC_FIX.md) records the duration-fitting repair, calibration control, 31 passing checks, and two successful controlled Live examples. Historical failures below are retained as evidence. The production queue cap is now 60 seconds; earlier 12-second figures describe the build tested at that time. Word-level and physical alignment gates remain open.

## Evidence and scope

Raw observations and optional generated tutor WAVs are in `tests/artifacts/phase0/`. Recompute derived metrics with `node tests/phase0-summarize.cjs`; it preserves raw evidence. Reports never export API keys, resumption handles or microphone recordings. Default device reports omit transcript text and tutor audio.

All Live pilots use `models/gemini-3.8-live`, Windows Chrome, typed input and an uncontrolled connection. Headless output-clock estimates are not physical speaker-onset measurements. The user reports PC speakers and agreed to a spoken test.

26 controller, demux, configuration-isolation, normalization and privacy checks passed. Synthetic browser tests passed playback-driven writing, pause/resume and partial-stroke interruption. Local freeze was approximately 0.6 ms after synthetic detection, excluding speech detection/network time. Both normal and measurement pages initialized without browser exceptions. A stopped server caused the first repeat attempt to fail before reaching Gemini; the harness now checks connectivity and initialization explicitly.

## Initial pilots

| Test | Marker calls / requested | Anchors found in transcript | Tutor audio | Observation |
| --- | --- | --- | --- | --- |
| WHEN_IDLE A | 3 / 10 | 2 | 2.24 s | Incomplete observation |
| SILENT A | 1 / 10 | 1 | 2.32 s | Incomplete observation |
| Omitted scheduling A | 10 / 10 | 10 | 12.31 s | All supplied markers completed |
| Compression + resumption setup | 1 / 1 | 1 | 2.36 s | Setup accepted; resumable update received |
| Output word timestamps | 0 / 1 | 0 | 0 s | Connection rejected, code 1007 |

A scheduling pilots stopped after a short quiet window. They do **not** prove the partial sessions would never continue. Repeat B observes up to 45 seconds, stopping early only after all markers and three quiet seconds, or twenty seconds without audio. Supplied arithmetic statements are test fixtures, not runtime teaching examples.

Exact timestamp rejection: `word_timestamp is not supported in BidiGenerateContent.` Normal classes retain `outputAudioTranscription: {}`. None of the successful initial transcript fragments had offsets. Recheck support per model before enabling the flag.

### Repeat B: corrected observation window

| Scheduling | Marker calls | Anchors present | Tutor audio | First audible estimate | Peak queue |
| --- | --- | --- | --- | --- | --- |
| WHEN_IDLE | 11 (10 requested) | 11 | 12.28 s | 1.38 s | 9.01 s |
| SILENT | 10 | 10 | 12.64 s | 1.96 s | 2.84 s |
| Omitted | 10 | 10 | 21.18 s | 2.84 s | 3.81 s |

All ten requested statements appeared in each repeat. SILENT did not stall in B. WHEN_IDLE made an extra marker call and added a completion sentence; OMIT added an unwanted introductory fragment. Observed scheduled gaps over 20 ms: one 4.66 s gap for WHEN_IDLE, ten gaps with 420 ms median for SILENT, ten with 441 ms median for OMIT. These are application scheduling observations, not independent acoustic speech-gap measurements. Word offsets remained absent. A single run per setting cannot establish a winner or general latency distribution. Keep the current normal setting; validate pacing and call adherence across more varied trials.

Repeat B used a **test-only** 30-second queue cap to observe generation ahead; normal classes retain the 12-second cap. The 9.01-second queue confirms that receive time cannot stand in for heard time. Text-presence counts include duplicate calls and do not prove semantic alignment.

### Normal Live regression trial

The unmodified normal setup received 290,880 PCM bytes, wrote `x + 2 = 5`, circled `+ 2`, and wrote `x + 2 - 2 = 5 - 2` without browser exceptions. However, the final `x = 3` stopped at approximately 68% with `audio_ended_before_writing_finished`. This is a **failed full-board-completion check**, not a passing end-to-end synchronization result. Native voice remains operational; duration fitting in approximate mode is still inadequate for this case. The subsequent typed interruption probe did not trigger during its observation window. Retained evidence: `tests/artifacts/phase0/normal-live-regression.json`. Do not hide the defect by snapping the remaining line into view. Future Live regression runs now return a failure status if the final line remains incomplete.

## Questions and release gates

| Question | Evidence | Decision / remaining work |
| --- | --- | --- |
| Q1: tool/stream ordering | Epochs, message IDs, receipt times and sample positions are recorded. Seven OMIT-A tools arrived while earlier audio played. | **No-go for precise stream-position anchors:** independent spoken-onset alignment is missing. Retain approximate mode. |
| Q2: transcript spans | Initial fragments generally had two or three words; no offsets. Co-delivered fields and sample counters retained. | Interpolation remains a hypothesis; ±100 ms accuracy is unproven. |
| Q3: native word timestamps | Actual endpoint rejected the flag with 1007. | Unsupported on this tested endpoint. Disabled normally. |
| Q4: playback status | References mention it, but a usable public client field was not established. | Do not invent protocol fields or claim heard-word truncation. |
| Q5: async tools | NON_BLOCKING accepted; audio received; OMIT-A completed ten markers. | **Go for further async testing, not reliability sign-off.** Keep normal WHEN_IDLE pending repeat/listening evidence. |
| Q6: anchor matches | Ten supplied OMIT-A anchors appeared in output text. English math normalization implemented. | Text presence is not timing accuracy. Need 200 cues across 20 varied lessons, including repeated phrases. |
| Q7: audio backlog | A pilots peaked around 1.34–2.09 s queued; some chunks waited over a second behind speech. | Retain queue cap and interrupt flush. Longer lessons and controlled jitter pending. |
| Q8: device clocks | Output timestamp, latency, context time and heard-sample estimates logged. | Physical calibration pending; wired, Bluetooth, Android, macOS and iOS untested. |
| Q9: VAD settings | Optional configuration plumbing exists. | Controlled parameter comparison pending. Accepted setup does not establish effectiveness. |
| Q10: local-first stop | Energy candidates and provider interruptions can be logged; synthetic post-detection stop works. | **No-go for production local-first interruption.** Energy threshold is not validated speech detection. Need 100 spoken trials and false-trigger measurements. |
| Q11: speaker echo | Capture requests echo cancellation. User agreed to speaker trial. | Actual quiet-listening test pending. Requested AEC does not prove suppression. |
| Q12: reconciliation | Existing clientContent note and confirmed board snapshot retained. | No 50-trial channel comparison yet. No claim of realtime text ordering or exact heard words. |

Compression/resumption setup acceptance does not establish actual reconnection or a 60-minute lesson. Resumption handles stay volatile. Normal setup is unchanged; automatic recovery is outside this spike.

### PC-speaker pilot

Saved metadata: `tests/artifacts/phase0/speaker-device.json`. The user reported that the tutor stopped before they spoke. The trace contains **zero provider interruptions and zero confirmed local speech candidates**. The only controller interruption is `class_ended` from clicking Finish, not a speech-triggered stop. Therefore this pilot does not establish an echo-induced false interruption.

Browser capture reported echo cancellation, noise suppression and automatic gain control enabled, mono at 48 kHz; the app resamples microphone output to 16 kHz. Tutor audio and microphone payloads were exchanged. The planned-interruption annotation occurred about 12.8 seconds after the last provider turn ended, so there was no active speech to interrupt at that point. A new attempt must speak over active tutor audio. Do not infer a validated microphone threshold or barge-in latency from this run.

The same incomplete final-line issue occurred: five board actions completed and one ended at approximately 64% when audio ended. Keep this as a second real-device observation of duration fitting failure. No microphone audio or transcript text was saved.

## Decisions where requirements conflict

1. A fixed 120 ms pen lead yields −120 ms error even with perfect anchors, outside M1's ±100 ms median target. Do not install that default; validate onset then tune lead.
2. Preserve partial strokes and stop audio on interruption. Do not finish words afterward or instantly reveal remaining expressions. Return unfinished state for deliberate repair.
3. Test SILENT rather than mandate it. Keep normal WHEN_IDLE. Omitted scheduling defaults to WHEN_IDLE in the documentation; pilot differences do not establish a semantic distinction.
4. Report startup/rebuffer lookahead separately from waiting behind earlier queued speech. Native generation ahead makes all-chunk receipt-to-start delay a poor measure of processing overhead. Do not claim M6 passes or silently redefine it.
5. Omit unsupported word timestamps and unestablished playback-status fields from normal sessions.
6. Sample clocks estimate played ranges, not exact words heard. Reconciliation describes the confirmed board and partial state without claiming a precise heard transcript.

These are provisional decisions from available evidence, not closure of every SRS question.

## Run and participate

```powershell
node --test tests/playback-sync.test.cjs tests/phase0.test.cjs
node tests/browser-sync.cjs
node tests/phase0-page.cjs
# Requires voice_server.py running with the masked key setup:
node tests/phase0-live.cjs repeat
node tests/phase0-summarize.cjs
node tests/phase0-device.cjs
```

The device test opens a separate visible Chrome profile. Click **Start microphone test**, allow the microphone, and listen without speaking. Mark quiet listening, then mark a planned interruption and say “Wait, explain that again” while the tutor speaks. Click **Finish device test** afterward. The runner saves timing metadata locally. Microphone audio streams to Gemini for the class and is never retained by this probe.

Normal URL behavior is unchanged. `?phase0=1` enables measurements. Restart Python after backend/config changes; start a fresh class after setup changes. Keep PowerShell open.

## Primary references reviewed 16 November 2026

- [Live API reference](https://ai.google.dev/api/live)
- [Tools and scheduling](https://ai.google.dev/gemini-api/docs/live-tools)
- [Session management](https://ai.google.dev/gemini-api/docs/live-session)
- [Google SDK types](https://github.com/googleapis/js-genai/blob/main/src/types.ts)
- [Output timestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)
- [Output latency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)

References describe interfaces. Raw trials establish observed model behavior. Neither substitutes for acoustic ground truth.
