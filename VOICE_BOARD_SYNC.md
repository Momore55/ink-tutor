# Native voice and marker synchronization

The new build specification is `specs/VOICE_BOARD_SYNC_SRS_v1.1.md`. Phase 0 observations, conflicts and unresolved release gates are tracked in [PHASE0_FINDINGS.md](PHASE0_FINDINGS.md). Instrumentation is opt-in; precise phrase alignment and physical interruption latency are not yet validated.

The latest completion fix and controlled Live evidence are in [WRITING_SYNC_FIX.md](WRITING_SYNC_FIX.md).

The 23 November update implements dedicated worklet playback, generic timed vectors and a separate drawing specialist. See [the current architecture record](specs/ARCHITECTURE_IMPLEMENTATION.md). Older source-node timing observations below are historical; use `npm run build` to include the new modules when rebuilding.

## Setup

Keep the normal Gemini-key startup for `voice_server.py`. Refresh the browser and start a fresh class after updating frontend files. Python serves `dist/`, so synchronize the browser modules after edits.

```powershell
Copy-Item index.html,style.css,app.js,live-config.js,board-math.js,learning-state.js,mic-capture.js,playback-sync.js,board-scene.js,gemini-adapter.js,phase0-probe.js -Destination dist
```

The normal UI has Start/End class, Pause/Resume tutor, and microphone mute. Open `http://127.0.0.1:7860/?debugSync=1` for development diagnostics. `inkSyncDiagnostics()` returns the same bounded report in the browser console. Diagnostic events contain timings and IDs, not API keys.

Open **Writing timing → Test sound and pen** with no active class to play three short beeps paired with progressive strokes. The browser output clock compensates for its reported speaker delay. If the pen looks early, add 10–250 ms of writing delay and test again. This preference is saved in that browser and applies to the next class; changing output devices requires retesting. It never advances writing or delays voice. This is perceptual output calibration, not validated speech-word alignment.

## Implementation

| File | Responsibility |
| --- | --- |
| `gemini-adapter.js` | Normalize native PCM, transcription, tool calls/cancellations, usage, interruption, and turn boundaries |
| `playback-sync.js` | Schedule decoded audio and advance action progress from playback sample ranges |
| `board-scene.js` | Compile semantic actions to SVG geometry and progressively reveal cumulative pen-path length |
| `app.js` | Connect the adapter, controller, renderer, existing learner tools, and UI |
| `live-config.js` | Keep one teaching policy and declare technical board-action contracts |

The project uses plain browser scripts with no TypeScript build pipeline. These modules stay in JavaScript to preserve that loading model and avoid a compiler dependency. TypeScript migration and static type checking were not performed.

The existing native Gemini Live connection and backend-issued temporary credentials remain the audio path. No additional speech provider, recognizer, or image stream was introduced.

## Timing source and its limits

Timing is explicitly **approximate**. Decode the PCM16 service format using its declared sample rate. Schedule each chunk with Web Audio and record its context interval and sample range. Prefer `getOutputTimestamp().contextTime` for the output clock, with an output/base-latency-adjusted context-time fallback. These are audible-position estimates, not microphone measurements of speaker output.

Advance writing only through samples belonging to its segment that have reached that output clock. A running AudioContext during silence does not advance a stalled segment. Suspending the context freezes its timeline. A frame callback renders the current position; wall-clock deadlines only expire abandoned prepared actions.

An early drawing call supplies a candidate segment boundary. Multiple calls before audio are grouped as an explicitly ambiguous batch. Stroke windows use local path-length duration estimates. Phrase anchors and occurrence numbers are retained but do not become word timestamps. We do not infer word alignment from transcript or tool arrival.

Drawing functions are asynchronous. `WHEN_IDLE` acknowledgments let native speech continue and request a subsequent explanation when the model is idle. Real testing exposed both blocking tool-call chains and silent acknowledgments that could stall the lesson. This improves execution flow but does not guarantee the model's semantic timing or full lesson completion.

Late actions in an already-passed segment are cancelled. Prepared units expire after a bounded wait, accounting for earlier queued speech. If audio ends before writing finishes, preserve the partial writing and report cancellation. Do not finish it with an independent timer.

## Actions and state

`board_actions` accepts small batches of `write_math`, `write_text`, `highlight`, `circle`, `draw_line`, and `erase`. This is the requested initial action vocabulary. A general free-form scene/illustration system remains future work.

The application assigns generation IDs. Segment and action IDs are validated and canonical returned IDs can be reused. Action IDs are generation-scoped. Repeating identical input returns its current status; conflicting reuse returns an error. Changed content needs a fresh action ID. All coordinates are validated against the 900 by 620 board.

`show_step` remains a compatibility entry point for math batches. Both writing tools return **prepared**, not a claim of completed writing. `get_board_state` returns actual visible content, progress, decorations, and partial erasure. The controller tracks prepared, started, completed, and cancelled actions. Completed and cancelled controller records release renderer closures.

Common math glyphs and circles/lines use genuine pen paths. Unsupported characters in text use a progressive clipped glyph fallback. That fallback is not natural centerline handwriting. Full mathematical typography remains constrained by `board-math.js`.

On interruption, stop scheduled sources, preserve already revealed paths, cancel unfinished actions, allocate a new generation, and discard pending old-generation async results. The provider adapter ignores interrupted output through its `turnComplete` fence. Append the confirmed partial board as context at that boundary and expose it through `get_board_state` before further references.

Provider messages have no app generation ID. The turn fence and call IDs handle observed boundaries, but cannot identify an untagged stale event arriving after a provider-declared boundary. Explicit old-generation controller inputs are rejected.

## Bounded resource configuration

Set `globalThis.INK_SYNC_CONFIG` before `app.js` to override defaults. Numeric values must be finite and positive, and lookahead cannot exceed 400 ms.

| Setting | Default |
| --- | --- |
| `lookaheadMs` | 250 ms on initial playback and after a gap |
| `maxQueueSeconds` | 60 seconds (about 2.88 MB of native PCM16 at 24 kHz, plus decoded buffers) |
| `maxActions` | 64 pending actions |
| `maxSegments` | 48 retained segments |
| `maxResults` | 128 action result records |
| `maxEvents` | 256 diagnostic events |
| `lateToleranceMs` | 400 ms |
| `maxPreparedMs` | 6,000 ms beyond previously queued speech |

There are also 800 scheduled-range/source caps, a three-second decoded chunk cap, 32 scene objects, eight writing rows, and eight decorations per object. A full board returns an explicit erase request. Excess queued audio stops the class with an error. Long pauses while the model keeps generating can reach this limit.

Finished audio nodes disconnect and release buffers. Geometry is compiled outside the audio path. Tool history and cancelled-call sets are bounded. The diagnostics count received PCM/socket bytes and microphone JSON bytes, preserve reported provider usage when supplied, and track queue peaks. These counters exclude transport overhead and are not a billing calculation. Context compression and session recovery remain follow-up work.

The earlier 12-second queue cap cut off a real explanation while the provider generated audio ahead of playback. The 60-second cap increases bounded capacity, not startup buffering: sources still start with the same 250 ms lookahead and run at native speed.

## Fitting writing to speech, 16 November 2026

Stroke length supplies provisional pacing while audio is arriving. At `generationComplete` or a subsequent tool boundary, the controller measures unplayed samples and distributes that remaining speech budget across unfinished strokes in their original order, weighted by remaining path duration. Replanning preserves revealed ink and progress. The final action ends at the last sample of its associated speech window. Neither source start times nor playback rate are changed. A positive writing-calibration delay shifts visual observation only.

No-audio actions still expire, truly late actions remain explicit failures, and interruptions still preserve partial strokes rather than finishing them after the learner speaks. If a boundary arrives only after all associated audio has played, the controller cannot retroactively synchronize missing writing. Multi-line batches and tools emitted before any speech still have approximate semantic boundaries; this fix is not a word aligner.

Labeled calculation lines now accept colon/semicolon punctuation while retaining stacked fractions and superscripts, preventing the observed cost-function label rejection loop.

## Tests

```powershell
node --test tests/playback-sync.test.cjs
node tests/browser-sync.cjs
node tests/browser-sync.cjs --live
```

The browser tests require installed Chrome at the path in `tests/browser-sync.cjs`. They launch a temporary isolated headless profile. The synthetic test starts its own loopback server on port 8765 and injects known PCM and tool events through the app's UI/WebSocket entry points. The Live test uses the normal server on port 7860 and its temporary credentials. It never reads the key.

Artifacts under `tests/artifacts/` include JSON event reports and screenshots. The deterministic tests exercise overlap, underruns, pause/resume, partial interruption, duplicates, ambiguous tool bursts, late actions, target removal, queue caps, canonical IDs, and generation fencing. An accelerated 30-minute scenario checks metadata bounds. It is not a real-time 30-minute heap/memory profile.

The synthetic browser lesson writes an equation, circles an existing term, subtracts from both sides, and finishes the solution. A separate step interrupts a partially drawn expression. It also verifies the UI pause control. Synthetic audio is a sine wave, so this establishes controller/rendering behavior, not semantic speech alignment.

Real trials have shown native audio overlapping progressive writing, circling, and preservation of partial expressions after typed interruption. Trials have also stalled or omitted later worked steps. Retain failed-trial reports and evaluate the latest result before claiming the entire experience is reliable. Spoken microphone interruption latency has not been measured by these typed-input browser tests. Network conditions are unthrottled and uncontrolled on this Windows PC.

## Remaining acceptance work

Measure phrase-to-action error on real spoken math, microphone-to-interruption latency, median/p95 response timing under controlled jitter, mobile-data traffic, and real 30-minute memory behavior. General illustration paths, robust repeated-phrase alignment, and narration replay remain future work. Measured word alignment would require validated provider timestamps or a separately evaluated alignment pipeline and an explicit provider/cost decision.

## API references checked

- https://ai.google.dev/api/live
- https://ai.google.dev/gemini-api/docs/live-tools

The reference describes independently delivered transcription and audio. Optional transcription offsets do not establish word-level alignment for the configured session. This implementation does not enable or rely on those offsets.
## Recorded results, 16 November 2026

The latest successful native Live trial used typed input in headless Chrome on Windows and the existing local Gemini server. It completed the equation, circle, subtraction line, and final result. Estimated time from submitting the typed question to audible playback was approximately **3.51 seconds**. First received PCM to the output-clock estimate was approximately **324 ms**, including the configured lookahead and browser output effects. Peak queued audio was approximately **8.79 seconds**. These are one-trial observations on an uncontrolled connection, not median/p95 guarantees or measured phrase alignment.

Earlier real trials captured typed-interruption local freeze times around **0–0.7 ms** after local detection, preserving partial writing. They exclude speech detection and provider/network delays. Failed and partial trial reports are retained alongside the successful one. The final trial's separate second-request interruption probe did not trigger within its wait window; use the earlier reports for that observation.

See `tests/artifacts/live-results.json`, `live-stalled-trial.json`, `live-queued-audio-trial.json`, and `live-lesson.png`. The controller suite passed **21 tests**, including the accelerated metadata-bound test.
