# Voice–Board Synchronization for the AI Lecturer

**Software Requirements Specification (SRS) · Version 1.1 · 16 November 2026 · Audience: senior software engineers and developers**

## 1. Purpose and scope

This document specifies how the AI lecturer’s handwriting (the marker effect) is kept in step with its Gemini Live voice, including when the student interrupts mid-sentence. It is written to be handed to engineering as a build brief.

**Already built (out of scope):** the Gemini Live integration, the whiteboard, and the marker renderer.

**In scope (this SRS):** the missing layer between them: clocks, timing, the board-action protocol, interruption handling, session lifecycle, testing and rollout.

**Evidence labels used throughout**

- **\[Verified\]** stated in documentation retrieved during research (see §18).
- **\[Assumption\]** engineering judgment that must be confirmed by measurement.
- **\[Validate\]** an open question to be answered in the Phase 0 spike (§6).

Requirement keywords: **MUST**, **SHOULD**, **MAY**.

**Caveat.** Live API model names, defaults and behavior change quickly, and at least one public report describes VAD settings appearing to be ignored after a server-side change on a preview model. Re-read the Live API documentation before implementation starts and pin the model ID in configuration (§17).

## 2. Problem statement

### 2.1 Current state

- Real-time voice conversation with Gemini Live works.
- The marker effect works.
- **Missing:** the writing is not locked to what the student actually hears, and interruptions do not leave voice, board and model context in a consistent state.

### 2.2 Why drift happens (root causes)

1. **Audio is generated faster than real time.** The API delivers speech as fast as it can and the client buffers and plays it out. Anything keyed to message arrival (a transcript fragment, a tool call) happens before the student hears the matching words.
2. **Heard time is not scheduled time.** Sound reaches the ear after the browser’s output latency, which varies by device (for example Bluetooth earbuds).
3. **Separate event streams.** Audio chunks, transcript fragments and tool calls are separate events, and one server event can carry several parts. Arrival order alone does not say where in the speech each belongs \[Validate Q1, Q2\].
4. **Blocking tool calls can pause speech** on some models. Sequential-only models stop speaking while a tool call is outstanding.
5. **Generated is not heard on interruption.** The server cuts generation on barge-in, but the client may hold seconds of unplayed audio, so the speech actually heard is shorter than what was generated.
6. **Wall-clock animation.** If the marker runs on its own timer started at message arrival, it is on a different clock from the audio and will drift.
7. **Platform variance.** Background-tab throttling, Safari quirks in output timestamps, and echo or feedback on speakers.

## 3. Goals, non-goals and success metrics

### 3.1 Goals

- **G1** The pen starts writing each item when the lecturer says the related words, within the tolerance in §3.3.
- **G2** The student can interrupt at any time; audio stops fast and board, voice and model context end in a consistent state.
- **G3** No accumulating drift over a lesson of any length.
- **G4** The client adds minimal audio latency on top of what Gemini Live already incurs.
- **G5** Failures degrade safely (late or approximate writing) instead of freezing or desynchronizing.

### 3.2 Non-goals for v1

- Freehand diagrams beyond the existing shape set.
- Cloned or custom voices (native-audio Live models use Gemini’s own voices) \[Assumption: confirm in current docs\].
- Multi-student rooms, offline mode, training or fine-tuning any model.

### 3.3 Success metrics

Define **sync error** *e* = t\_pen\_start(item) − t\_heard\_onset(first anchor word), in milliseconds. Negative means the pen leads the voice; positive means it lags.

| ID | Metric | Initial target | Basis |
| --- | --- | --- | --- |
| M1 | *e*, median | within ±100 ms | \[Assumption\] |
| M2 | *e*, p95 | between −150 ms (pen early) and +100 ms (pen late) | By analogy with lip-sync tolerance (sound leading picture is noticed at about 45 ms, lagging at about 125 ms), pen-late is the stricter side. Writing is not lip-sync, so validate with user testing \[Assumption\] |
| M3 | *e* at minute 10 vs minute 1 | median shift ≤ 30 ms | Follows from the stateless clock design (FR-R1, FR-R2) |
| M4 | Barge-in: user speech onset to speakers silent | p95 ≤ 300 ms | \[Assumption\] |
| M5 | Interrupted cues ending in a defined state | 100% (no ghost strokes, no audio after flush) | Correctness |
| M6 | Client-added audio latency (chunk received to chunk playing, excluding hardware latency) | p95 ≤ 150 ms | \[Assumption\]; end-to-end voice latency is baselined in Phase 0 because Gemini-side latency is outside our control |
| M7 | Phrase-anchor resolution rate | ≥ 95% of cues | Drives the need for fallbacks (§8.9) |
| M8 | 60-minute session with compression and resumption | no desync, no crash | Session limits in §11 |

## 4. Platform facts carried forward

These were recorded as verified in the v1.0 research. Re-confirm each against the current documentation before relying on it.

| ID | Fact |
| --- | --- |
| P1 | The Live API supports barge-in, function calling, Google Search as a tool, and transcripts of both user input and model output. |
| P2 | Output audio is raw 16-bit little-endian PCM at 24 kHz. Input is 16 kHz (other rates are resampled if the MIME type declares the rate). |
| P3 | Output transcription is enabled by sending an empty outputAudioTranscription object in the setup config. |
| P4 | Content is generated as quickly as possible, not in real time; clients buffer and play out in real time. |
| P5 | On barge-in the server sends an interrupted message. An interrupted turn goes interrupted → turnComplete, with no generationComplete. |
| P6 | Default activity handling is START\_OF\_ACTIVITY\_INTERRUPTS; NO\_INTERRUPTION is available. |
| P7 | Automatic activity detection exposes startOfSpeechSensitivity, endOfSpeechSensitivity, prefixPaddingMs and silenceDurationMs, and can be disabled so the client sends activityStart and activityEnd. |
| P8 | clientContent is appended unconditionally to history and interrupts current generation. realtimeInput can be sent continuously without interrupting generation. |
| P9 | Setup configuration cannot be changed while the connection is open, except the model via pause and resume with session resumption. |
| P10 | When playback status reporting is enabled, turnComplete is emitted only when playback is reported done. Field names and mechanics not yet retrieved (Q4). |
| P11 | A single server event can contain multiple parts (for example inlineData and transcript); code must process every part. |
| P12 | Function calling: the newest Live model supports NON\_BLOCKING calls (default) with scheduling SILENT, WHEN\_IDLE and INTERRUPT. Its Extended Thinking variant is async only and does not accept scheduling (sending it closes the session with error 1007). Gemini 3.1 Flash Live Preview is sequential only and marked legacy. |
| P13 | When scheduling is omitted on supported models it defaults to WHEN\_IDLE, so each function response triggers a new model turn after the user finishes speaking. |
| P14 | Without compression, audio-only sessions last 15 minutes and a connection lasts about 10 minutes. A GoAway message precedes termination. Sliding-window contextWindowCompression extends sessions. Resumption tokens are valid for 2 hours. |
| P15 | AudioContext.outputLatency estimates hardware output latency. Supported in Chrome 102, Firefox 70, Safari 18.4. |
| P16 | A 2021 forum report shows getOutputTimestamp returning wrong values on iOS 15.1 Safari. Re-test on current iOS. |
| P17 | Browser voice-agent pattern: keep a playback cursor and schedule chunks back to back; on interrupt, stop scheduled audio; use echoCancellation and headphones to avoid self-interruption. |
| P18 | Pipecat with Gemini Live: the provider decides when the user barged in, the client still flushes local audio so the bot goes silent immediately, and the LLM context keeps only words actually spoken. |
| P19 | Lip-sync detectability thresholds are about 45 ms audio lead to 125 ms audio lag (ITU-R BT.1359-1); EBU R37 asks for +40/−60 ms end to end. |
| P20 | Browser VAD: Silero via vad-web on ONNX Runtime Web; 512-sample frames at 16 kHz (32 ms); about 50 ms processing overhead; confirmation and silence frame counts are tunable. |
| P21 | Public reports exist of input transcription delays in long sessions and of VAD parameters apparently ignored after a server-side change. |
| P22 | Within realtimeInput, audio, video and text are separate concurrent streams and ordering across them is not guaranteed. |

## 5. Terminology

- **Audio timeline:** monotonic seconds of model speech, counted in samples (24,000 per second), restarting at 0 each epoch.
- **Epoch:** integer incremented whenever buffered speech is invalidated (interruption, flush, reconnect). All cues, chunks and transcript data carry an epoch.
- **Heard time:** the audio-timeline position currently leaving the speakers.
- **Cue:** a board action placed on the audio timeline.
- **Anchor:** the reference that places a cue on the timeline (a spoken phrase, or a stream position).
- **Pen lead:** how far before the anchor word the pen starts moving.
- **Lookahead:** seconds of received-but-unplayed audio.

## 6. Phase 0 spike: open questions

Each question MUST be answered with logged measurements before the design in §7–§11 is frozen.

| ID | Question | How to test | Decision it drives |
| --- | --- | --- | --- |
| Q1 | Do audio chunks, transcript fragments and tool calls arrive in an order that reflects speech position? | Log every message with cumulative samples received; compare with offline alignment of the recorded audio. | Whether stream-position anchoring (FR-C2 step 2) is usable. |
| Q2 | What is the granularity of output transcript fragments (word, phrase, sentence), and does the transcript lead or lag its audio? | Same log; plot fragment arrival vs audio position. | Rule for assigning fragments to audio time (FR-T3). |
| Q3 | Does a word-timestamp option exist for output transcription, and in what format? | Enable it in setup and inspect output messages. | Removes the need for word-time interpolation (FR-T4). |
| Q4 | What is playback status reporting: field names, how the client reports position, does the server truncate context at the heard position? | Read the API reference; test with a deliberate barge-in. | Could replace much of FR-M1 and FR-M2. |
| Q5 | On the production model, do NON\_BLOCKING board calls keep speech continuous, and does scheduling SILENT stop the model narrating the tool result? | Scripted lesson with 10 mid-sentence calls; listen for gaps and extra narration. | Model choice; whether fallback F2 is needed. |
| Q6 | How often does the model emit anchor\_text that matches the words it says next, in spoken form? | 200 board calls across 20 lessons; fuzzy-match against the transcript. | Anchor strategy; prompt design (§12). |
| Q7 | How many seconds of audio does the server deliver ahead of playback? | Measure received-minus-played at each chunk. | Interrupt waste; sizing of lookahead (FR-A8). |
| Q8 | How reliable are outputLatency and getOutputTimestamp on Chrome, Safari (macOS, iOS), Android Chrome and Bluetooth? | Measure with a click and screen-flash probe. | Need for per-device calibration (FR-A5). |
| Q9 | Are VAD parameters honored on the chosen model? | Vary silenceDurationMs and confirm behavior changes. | Local VAD tuning; regression canary (§14). |
| Q10 | Time from local VAD speech start to server interrupted, and the false-interrupt rate. | 100 scripted barge-ins; log both timestamps. | INTERRUPT\_CONFIRM\_MS, FR-I3 design. |
| Q11 | Does browser echo cancellation suppress Web Audio output on speakers in each target browser? | Speaker test with the lecturer talking and no user speech; count false interrupts. | Headphone requirement; AEC strategy. |
| Q12 | Which channel (realtime text, or clientContent with turnComplete false) reliably delivers the reconciliation note before the model answers? | 50 interrupts; check the reply against the note. | FR-M2. |

**Phase 0 exit criteria:** every question has a written answer with data; a go or no-go decision is recorded for stream-position anchoring (Q1), non-blocking tool calls (Q5) and local-first interruption (Q10).

## 7. Architecture overview

### 7.1 Design principles

1. **One master clock.** The audio playout clock is the single source of time. The renderer is a pure function of it.
2. **Anchors, not arrival times.** A board action is placed by what the lecturer says (or where in the audio stream it was issued), never by when the message arrived.
3. **Local-first interruption, server-confirmed.** The client reacts to user speech immediately; the server’s interrupted message finalizes state.
4. **Epoch-scoped state.** Anything produced before an interruption or reconnect cannot affect what happens after it.
5. **Degrade visibly but safely.** If timing cannot be met, the pen catches up or snaps; it never blocks the voice.

### 7.2 Components

| Component | Responsibility |
| --- | --- |
| LiveSessionClient | WebSocket or SDK session, setup config, message demux, GoAway, reconnect and resumption. |
| AudioPlayout | Output AudioContext at 24 kHz, chunk scheduling cursor, flush, suspend and resume, latency estimate, chunk map. |
| HeardClock | Converts the output timestamp into audio-timeline time. |
| TranscriptTimeline | Maps output transcript fragments to audio-time spans and estimates word onsets. |
| CueManager | Receives board tool calls, resolves anchors into start times, fits durations, serializes the single pen. |
| BoardClock + Renderer | Existing marker effect, wrapped behind a deterministic renderAt(cue, t) contract. |
| InterruptController | Local VAD plus server interrupted, state machine, reconciliation. |
| ModelContextSync | Sends what was actually heard and what is on the board back to the model. |
| SyncProbe / Telemetry | Per-cue timing logs, calibration screen, regression canaries. |

### 7.3 Data flow

```
Mic -> AEC -> Local VAD --------+            Gemini Live (WebSocket)
                                v                 ^        |
                       InterruptController <------+        | audio chunks, transcript,
                                |                  |        | tool calls, interrupted, goAway
                                v                  |        v
                           AudioPlayout <------ LiveSessionClient (demux, epoch)
                             |    (master clock)            |
                             v                              v
                         HeardClock                 TranscriptTimeline
                             |                              |
                             v                              v
                        BoardClock <------ CueManager <--- board tool calls
                             |
                             v
                  Marker renderer: renderAt(cue, t)
```

## 8. Functional requirements

### 8.1 Session and demux (FR-S)

- **FR-S1** The client MUST enable output audio transcription and input audio transcription in the setup config.
- **FR-S2** The demuxer MUST process **every part** of every server event (audio, transcript, tool call, flags); it MUST NOT assume one part per event (P11).
- **FR-S3** Every demuxed item MUST be tagged with the current epoch and a monotonic receive timestamp (performance.now()).
- **FR-S4** The demuxer MUST maintain a running count of output audio samples received in the current epoch, and stamp each transcript fragment and tool call with that count at the moment it is processed (the **stream position**).
- **FR-S5** The model ID MUST come from configuration, not code (§17).

### 8.2 AudioPlayout (FR-A)

- **FR-A1** Playback MUST use a single AudioContext with a 24 kHz output path, decoding 16-bit PCM chunks to float.
- **FR-A2** Chunks MUST be scheduled back to back with a playback cursor (next start = max(currentTime, cursor)), with no gaps or overlaps within an epoch.
- **FR-A3** For every chunk, AudioPlayout MUST record: epoch, start sample on the audio timeline, length in samples, and scheduled AudioContext start time (the **chunk map**).
- **FR-A4** AudioPlayout MUST expose flush(): stop all scheduled sources, clear the chunk map and advance the epoch, all within one animation frame.
- **FR-A5** AudioPlayout SHOULD apply per-device latency compensation using outputLatency where supported, with a manual calibration offset stored per device (Q8).
- **FR-A6** AudioPlayout MUST handle suspend and resume of the AudioContext (autoplay policy, background tab) without losing the chunk map; on resume, HeardClock MUST re-sync.
- **FR-A7** A start-of-turn jitter buffer of 80 ms or less MAY be used \[Assumption\].
- **FR-A8** AudioPlayout MUST report lookahead (seconds received but unplayed) to telemetry. If lookahead exceeds the configured cap (Q7), the client SHOULD apply backpressure or accept the interrupt waste, as decided in Phase 0.

### 8.3 HeardClock (FR-H)

- **FR-H1** HeardClock MUST return the audio-timeline position currently leaving the speakers: heard time = (context.currentTime − outputLatency) mapped through the chunk map to samples ÷ 24,000.
- **FR-H2** HeardClock MUST be monotonic within an epoch and return null when nothing is playing.
- **FR-H3** The renderer and CueManager MUST read time **only** through HeardClock. No other timer may drive board animation.

### 8.4 TranscriptTimeline (FR-T)

- **FR-T1** TranscriptTimeline MUST normalize transcript text for matching (case-folded, punctuation stripped, numbers and math symbols expanded to spoken form, for example “x²” becomes “x squared”).
- **FR-T2** Each transcript fragment MUST be stored with its epoch and stream position (FR-S4).
- **FR-T3** Fragments MUST be assigned an audio-time span by the rule selected in Phase 0 (Q2). Default: a fragment spans from the previous fragment’s end stream position to its own stream position.
- **FR-T4** Within a span, word onsets MUST be estimated by interpolation proportional to character count, unless a native word-timestamp feature exists (Q3), in which case native values MUST be used.
- **FR-T5** The timeline MUST support a lookup: given an anchor phrase and a search window, return the estimated onset time of its first word, or a miss.

### 8.5 Cues and CueManager (FR-C)

- **FR-C1** CueManager MUST receive board tool calls (§9), assign each a cue ID within the current epoch, and acknowledge the call to the model immediately (before animation starts) with a short result.
- **FR-C2** Each cue’s start time MUST be resolved in this order:
  1. **Phrase anchor:** look up anchor\_text in TranscriptTimeline within the window \[stream position − 4 s, stream position + 8 s\]. If found, start = onset − PEN\_LEAD\_MS.
  2. **Stream position:** otherwise start = (stream position ÷ 24,000) − PEN\_LEAD\_MS. Valid only if Phase 0 Q1 approved it.
  3. **Fallback:** otherwise start = current heard time + FALLBACK\_DELAY\_MS, and the cue is flagged *approximate* in telemetry.
- **FR-C3** Resolution MAY be deferred up to 1.5 s to wait for the transcript to arrive, but a cue MUST NOT start later than its deadline (anchor onset + MAX\_LATE\_MS) unless in snap mode (FR-C6).
- **FR-C4** The pen is single: cues MUST be serialized in start-time order. If a cue’s start falls inside the previous cue’s writing, the previous cue MUST be sped up (up to MAX\_SPEEDUP) to finish before the next start.
- **FR-C5** Writing duration MUST be fitted to the speech: duration = clamp(time until next cue or end of the spoken sentence, MIN\_DUR, MAX\_DUR), scaled by content length (characters or strokes).
- **FR-C6** If a cue cannot be written in time even at MAX\_SPEEDUP, CueManager MUST snap the item onto the board (default) or continue with a late pen, per configuration, and log the miss.
- **FR-C7** Cue state (pending, writing, done, cancelled) MUST be queryable by InterruptController and ModelContextSync.

### 8.6 Renderer contract (FR-R)

- **FR-R1** The renderer MUST expose renderAt(cue, t) that draws the cue’s state at heard time t deterministically: same input, same output, with no internal timers or per-frame random state.
- **FR-R2** The renderer MUST NOT keep its own clock. Pausing, resuming and scrubbing MUST work by changing t only.
- **FR-R3** The renderer MUST support a word-granular stop point so an interrupted cue can finish the current word (FR-I2).
- **FR-R4** The renderer MUST support instant completion (snap) and instant removal of a cue.
- **FR-R5** Rendering MUST run on requestAnimationFrame; when the tab is hidden, state is recomputed from HeardClock on return instead of catching up frame by frame.

### 8.7 Interruption handling (FR-I)

- **FR-I1** A local VAD MUST run on the microphone stream (P20). On confirmed speech start (INTERRUPT\_CONFIRM\_MS), InterruptController MUST immediately fade out and flush AudioPlayout (FR-A4) without waiting for the server.
- **FR-I2** On local interrupt, the pen MUST finish the current word (at most MAX\_FINISH\_MS) and then stop. Unstarted cues in the epoch MUST be cancelled. Strokes already drawn MUST stay on the board.
- **FR-I3** The false-interrupt policy MUST be defined from Phase 0 data (Q10, Q11): coughs, echo of the lecturer’s own voice and background noise MUST NOT cause a permanent stop. If the server does not confirm interrupted within SERVER\_CONFIRM\_TIMEOUT\_MS, the client MAY recover by having the model repeat the last sentence and continue.
- **FR-I4** On the server’s interrupted message the epoch MUST be finalized: late audio, transcript and tool calls tagged with the old epoch MUST be discarded.
- **FR-I5** The state machine in §10 MUST be the only code path that changes interruption state.

### 8.8 Model context sync (FR-M)

- **FR-M1** After an interruption, ModelContextSync MUST compute the **heard text**: transcript words whose estimated onset is at or before the heard time at the moment of flush. The remainder is the **unheard text**.
- **FR-M2** Before the model answers, it MUST be given a reconciliation note containing: heard text, unheard text, the board items currently visible, and the cancelled cues. The delivery channel is chosen by Q12. If Q4 shows the server truncates context at the reported heard position natively, the note MAY be reduced accordingly.
- **FR-M3** The note MUST be marked as system context so the model does not read it aloud.
- **FR-M4** After answering the student, the lecturer SHOULD be able to resume from the interrupted point (§12).

### 8.9 Fallbacks

| ID | Condition | Behavior |
| --- | --- | --- |
| F1 | Anchor phrase not found (M7 miss) | Use stream position (FR-C2 step 2), then fallback delay; flag as approximate. |
| F2 | Q5 fails: tool calls pause speech on the chosen model | Switch to plan-first mode: a planning step writes the lesson as segments (narration plus anchored board actions) ahead of time; Gemini Live only speaks segments, and cues are matched to the transcript. No mid-speech tool calls. |
| F3 | Transcript delayed or missing | Place cues by stream position only; log degraded sync. |
| F4 | Pen cannot keep up | Snap items onto the board (FR-C6); never delay the voice. |

## 9. Board-action protocol

The model issues one function, **write\_board**, for each item it wants on the board. It is declared at session setup, and is non-blocking where the model supports that. The result returned to the model MUST be immediate and short and, where scheduling is available, MUST use SILENT scheduling so the model does not narrate the result.

```json
{
  "name": "write_board",
  "parameters": {
    "kind": "text | equation | shape | underline | erase",
    "slot": "grid slot id, e.g. A1, B2 (never raw coordinates)",
    "content": "text, LaTeX, or shape name with parameters",
    "anchor_text": "the exact words you will say when this should start, in spoken form (3 to 6 words)",
    "priority": "normal | must_finish"
  }
}
```

- **FR-P1** The board is a slot grid; the model chooses slot IDs and CueManager owns coordinates and collision avoidance.
- **FR-P2** The model MUST issue the call **before** the lecturer says the anchor words, not after.
- **FR-P3** Unknown kinds or slots MUST be rejected with a short error result and logged, without stalling speech.
- **FR-P4** Equations MUST be pre-rendered to stroke paths (or equivalent) off the critical path; render time MUST NOT count against sync.
- **FR-P5** An erase action SHOULD be placed at a natural pause (end of a sentence or topic).

## 10. Interruption state machine

| State | Entered when | Actions | Exits to |
| --- | --- | --- | --- |
| SPEAKING | Lecturer audio is playing | Normal cue scheduling. | PENDING\_INTERRUPT on local VAD speech start. |
| PENDING\_INTERRUPT | Local VAD speech start, before confirmation | Start the confirmation timer; nothing audible changes yet. | LOCAL\_INTERRUPT on confirmation; SPEAKING if speech ends first (false trigger). |
| LOCAL\_INTERRUPT | Confirmed speech start | Fade and flush audio (FR-A4); finish current word then stop pen; cancel unstarted cues; compute heard text (FR-M1). | AWAIT\_SERVER when flush completes. |
| AWAIT\_SERVER | Local flush done | Wait for server interrupted; discard old-epoch items. | USER\_TURN on interrupted; recovery on timeout (FR-I3). |
| USER\_TURN | Server confirmed | Send reconciliation note (FR-M2); keep streaming student audio. | MODEL\_REPLY on the model’s first audio. |
| MODEL\_REPLY | New audio in new epoch | Normal playback; board edits for the answer follow the same cue rules. | RESUME when the reply turn completes. |
| RESUME | Reply done | Model continues from the interrupted point or re-explains (§12). | SPEAKING. |

Every transition MUST be logged with timestamps for M4 and M5.

## 11. Session lifecycle

- **FR-L1** The client MUST enable sliding-window context compression and session resumption at setup (P14).
- **FR-L2** On a GoAway message, the client MUST open a resumed session using the latest resumption token and swap over at the next sentence boundary or silence where possible.
- **FR-L3** On reconnect the epoch MUST advance, the audio timeline MUST reset, and any pending cues from the old session MUST be completed or snapped, never left half-written.
- **FR-L4** Board state MUST persist across reconnects; after resumption the model MUST receive the list of visible board items (same note format as FR-M2).
- **FR-L5** A resumption token MUST be treated as expiring after 2 hours; a longer lesson MUST fall back to a fresh session plus a board summary.
- **FR-L6** If the connection drops without GoAway, the client MUST attempt resumption and show a visible “reconnecting” state without losing the board.

## 12. Prompting requirements

The lecturer’s system prompt MUST include the following rules. They are tested in Phase 0 (Q6) and refined afterward.

1. Call write\_board **just before** saying the related words, never after.
2. Set anchor\_text to the exact words that will be spoken next, as spoken (“x squared”, not “x²”), 3 to 6 words.
3. At most one board item per sentence; do not stack many calls in a row.
4. After a write\_board call, do not narrate the call or its result.
5. When a reconciliation note arrives: answer the student’s question first, then say a short resume line and continue from the unheard text, or re-explain if the question showed confusion.
6. Choose slot IDs only from the provided grid; never invent coordinates.
7. While a long item is being written, pause naturally (a short filler phrase or a beat of silence).

## 13. Non-functional requirements

- **NFR-1 Performance:** the render loop MUST hold 60 fps on the reference device; CueManager and TranscriptTimeline work MUST stay under 2 ms per frame.
- **NFR-2 Platforms:** Chrome (desktop and Android), Safari (macOS and iOS), Edge and Firefox on the supported list; each MUST be tested against §14.
- **NFR-3 Audio devices:** wired, speaker and Bluetooth outputs MUST be supported; Bluetooth latency MUST be handled by calibration (FR-A5).
- **NFR-4 Echo:** the product SHOULD recommend headphones and MUST enable echoCancellation on the microphone stream (Q11).
- **NFR-5 Accessibility:** a captions option SHOULD show the heard text; the board MUST remain readable with animations turned off (instant snap mode).
- **NFR-6 Privacy:** microphone audio and transcripts MUST NOT be logged beyond what is configured; telemetry stores timings, not content, by default.
- **NFR-7 Resilience:** no exception in the sync layer may stop audio playback; failures drop to the fallbacks in §8.9.

## 14. Telemetry and testing

### 14.1 SyncProbe telemetry

For every cue, log: cue ID, epoch, anchor resolution path (phrase, stream, fallback), planned start, actual pen start, estimated heard onset, *e* in milliseconds, device, browser, output type, and whether it was approximate. For every interruption, log each state transition timestamp.

### 14.2 Calibration screen

A short test (click plus screen flash) lets a tester or user measure their device’s audio-to-visual offset and store a correction (FR-A5, Q8).

### 14.3 Test matrix

| Area | Test | Pass criterion |
| --- | --- | --- |
| Sync accuracy | 20 scripted lessons, 200 cues; offline forced alignment of recorded audio as ground truth | M1, M2 |
| Drift | 10-minute and 60-minute sessions | M3, M8 |
| Barge-in | 100 scripted interruptions at random points | M4, M5 |
| False interrupts | Speaker playback, coughs, noise | Rate below the threshold set in Phase 0 |
| Devices | Chrome, Safari macOS and iOS, Android Chrome; wired, speaker, Bluetooth | Per-device *e* within target after calibration |
| Network | Added latency, jitter and stalls | No desync; fallbacks engage (F1 to F4) |
| Session | GoAway, forced disconnect, token expiry | FR-L1 to FR-L6 |
| Reconciliation | 50 interruptions; review model replies | Replies consistent with heard text and board (Q12) |

### 14.4 Regression canaries

Because model behavior can change server-side, a scheduled automated test MUST run against the pinned model. It verifies that VAD parameters take effect (Q9), that tool calls stay non-blocking (Q5), and that the anchor match rate stays at or above M7. Failures MUST alert the team before users notice.

## 15. Rollout plan

Durations are \[Assumption\] estimates for a small team; adjust after Phase 0.

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 0. Spike (about 1 to 2 weeks) | Logging harness; answer Q1 to Q12 | §6 exit criteria met; decisions recorded |
| 1. Core sync | AudioPlayout, HeardClock, CueManager with stream-position anchoring, renderer contract, calibration screen | M1 and M3 on desktop Chrome with a scripted lesson |
| 2. Phrase anchors and transcript | TranscriptTimeline, phrase resolution, fallbacks, prompt rules | M2 and M7 met |
| 3. Interruption | Local VAD, state machine, reconciliation | M4 and M5 met; Q12 channel chosen |
| 4. Lifecycle and hardening | Compression, resumption, device matrix, canaries | M6 and M8 met; test matrix green |
| 5. Beta | Limited real users, telemetry review, user study on sync tolerance | Targets confirmed or revised by user data |

## 16. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Model or API behavior changes (preview models) | Sync or interrupts break silently | Pin the model; canaries (§14.4); configuration-driven IDs |
| Stream order does not reflect speech position (Q1) | Stream-position anchoring unusable | Phrase anchors from the transcript; plan-first mode (F2) |
| Tool calls pause speech (Q5) | Audible gaps in every lecture | Use a non-blocking model; otherwise F2 |
| Output transcript is slow or coarse (Q2) | Phrase anchors resolve late | Stream-position anchors; wider windows; native word timestamps if available (Q3) |
| Device latency variance (Q8) | Pen consistently early or late | Per-device calibration |
| Echo causes self-interruption (Q11) | Lecturer stops randomly | Headphones, AEC, confirmation window, server confirm timeout |
| Model ignores the anchoring prompt (Q6) | Low resolution rate | Prompt iteration, few-shot examples, fallback chain |
| Targets are wrong for humans | Sync feels off despite meeting metrics | User study in Phase 5; revise targets |

## 17. Configuration parameters

All values are starting points \[Assumption\] and MUST be tunable without a code change.

| Name | Starting value | Meaning |
| --- | --- | --- |
| LIVE\_MODEL\_ID | set per Phase 0 | Pinned Live model |
| PEN\_LEAD\_MS | 120 | How far before the anchor word the pen starts |
| MAX\_LATE\_MS | 100 | Latest a cue may start after its anchor onset |
| FALLBACK\_DELAY\_MS | 300 | Delay for cues with no anchor |
| MIN\_DUR / MAX\_DUR | 0.4 s / 6 s | Writing duration limits |
| MAX\_SPEEDUP | 2.0× | Maximum pen speed-up to meet the next cue |
| INTERRUPT\_CONFIRM\_MS | from Q10 | Local VAD confirmation time |
| MAX\_FINISH\_MS | 400 | Time allowed to finish the current word on interrupt |
| SERVER\_CONFIRM\_TIMEOUT\_MS | from Q10 | Wait for server interrupted before recovering |
| LOOKAHEAD\_CAP\_S | from Q7 | Maximum buffered unplayed audio |
| JITTER\_BUFFER\_MS | 80 | Start-of-turn buffer |
| CALIBRATION\_OFFSET\_MS | per device | Manual audio-to-visual correction |

## 18. References

The v1.0 draft cites sources R1 to R16: Live API documentation (sessions, tools, audio, activity detection, function calling, session management), MDN notes on AudioContext latency, browser voice-agent and Pipecat write-ups, ITU and EBU lip-sync recommendations, Silero vad-web documentation, and public bug reports. The numbered list with URLs was not part of the material used to write this version. **Add the URLs and retrieval dates before circulating this document**, and re-verify every item in §4 against the current Live API documentation.
