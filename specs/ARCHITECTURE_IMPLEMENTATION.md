# Audio visual architecture implementation

23 November 2026. Based on the supplied **Architectural Specification Real Time Audio Visual Synchronization for AI Whiteboard Tutors**. This record maps its requirements to executable code and distinguishes verified behavior from claims still requiring measurements.

## Requirement mapping

| Specification section | Implementation |
| --- | --- |
| 1 Transport mismatch | Tool receipt prepares geometry only. Rendering observes played audio, not WebSocket receipt. |
| 2 Pillar I audio clock | `playback-sync.js` uses output timestamps or compensated AudioContext time. requestAnimationFrame samples that clock; it does not accumulate animation time. |
| 2 Pillar II latency | `getOutputTimestamp()` already represents output-device position, so no second latency subtraction is applied. Fallback subtracts outputLatency + baseLatency. Manual writing-only delay is retained. |
| 2 Pillar III sample mapping | PCM16 duration is byteLength / 2 / rate. Each chunk maps epoch sample range to scheduled and worklet-confirmed context times. Native 24 kHz is requested; the worklet can resample other declared rates to the actual graph. |
| 2 Pillar IV scheduled vectors | `stroke-protocol.js` validates id, geometry, onset and duration. Timed actions are ordered by audio onset and interpolated by the same playback clock. |
| 3 AudioWorklet | Normal Live output uses `audio-playback-worklet.js`, with bounded PCM storage, zero-filled underruns, transfer buffers and generation-scoped FLUSH. Clock reports contain sample counters and context frames. Capture already uses a separate worklet. |
| 3 Lifecycle | Idle output suspends after one second, new input/output wakes it, manual pause remains distinct, and class teardown closes nodes/contexts. Microphone capture remains active during an active listening class. |
| 4 Serialization | FREEDRAW / TEXT / PRIMITIVE data and structured ScheduledStroke objects are supported. Arbitrary bounded point trajectories are allowed, with no lesson or illustration catalog. Mathematical text keeps superscripts/fractions. |
| 4 Dual agents | Gemini Live delegates via NON_BLOCKING `delegatePrompt`; a separate backend vision/text call receives visual intent, planned narration, confirmed scene state and a 640×360 canvas image. Validated actions stream incrementally as NDJSON. Native voice does not await the specialist. |
| 4 Canvas feedback and diff | Every request includes the visible canvas; local cards support keeping/removing an illustration without affecting other objects. Repeated calls see the updated scene. |
| 5 Barge-in | PCM queue flushes and old-epoch arrivals are rejected. Pending actions cancel; active SVG paths retain their current fraction. Async drawing jobs abort and cannot write into a later epoch. |
| 6 Engine | Existing semantic board and math APIs remain compatible. Generic vector strokes use the same persistent SVG scene and playback scheduler, preserving completed and partial work. |
| 7 References | Primary browser/API/research sources checked. The paper's timestamp-conditioned fine-tuning is research context; its model/data are not bundled or silently assumed to be Gemini capabilities. |

## Corrections to the supplied reference code

The build follows the architecture rather than copying incomplete sample code:

- A first audio sample, not the time a network turn starts, anchors a speech window. Waiting for inference must not advance writing.
- An output timestamp is already hardware-compensated; subtracting latency again would double-delay the pen. The fallback compensates both documented latency components.
- Native PCM cannot be played at a 44.1/48 kHz graph rate without resampling; the output graph requests 24 kHz and the worklet explicitly handles rate conversion.
- Clock messages are throttled to roughly 50 ms while reporting precise frame/sample positions. Posting once per 128-frame quantum would create unnecessary main-thread IPC load.
- FLUSH resets media counts and changes the epoch; buffered old-generation messages cannot revive old audio. Per-job drawing requests are cancelled too.
- SVG paths retain visible ink as the scene; the reference's canvas loop would repeatedly overdraw partial paths and fails to implement its text/primitive variants. SVG preserves existing progressive math typography and supports generic freehand vectors without introducing a new UI framework.
- Loopback Python hosts the drawing specialist because the chosen deliverable is a repository with local running instructions. Cloudflare Workers, Durable Objects and an additional Anthropic account are not required for this local two-role implementation.

## Evidence

39 Node checks and eight Python checks passed. Backend checks include streaming responses, foreign-origin rejection, request validation and explicit provider errors. Existing synthetic browser lesson passed progressive math, pause/resume and partial interruption on the new worklet output. A second real Chrome test verified explicit stroke onset, streaming delegation, remove/keep isolation and epoch flush. During a deliberate 500 ms block of the main page thread, the audio thread advanced 13,568 samples, demonstrating independent audio processing; wall-clock overlap and callback timing affect the exact observation interval.

These browser checks use synthetic provider events and do not consume a Gemini key. The public repository excludes private captures and credentials. New real Gemini voice and canvas-specialist calls require the user-started key-bearing local server and must be reported separately when completed.

## Accuracy limits

Sample duration and execution against the playback clock are deterministic. The **semantic relationship** between a model-proposed onset and an actual spoken word is not established by sample counting alone. The previous endpoint rejected native output word timestamps. An estimated onset from a second model is not independent audio alignment. Late delegated strokes are explicitly rebased to the remaining heard timeline and flagged approximate; they are not presented as measured word anchors. If narration is over, the job reports a timing error instead of silently drawing against later speech.

The supplied research studies a separately fine-tuned timestamp-conditioned model on paired demonstrations. It does not establish universal millisecond semantic alignment for unmodified Gemini Live. Nor does moving audio off-thread make UI painting immune to main-thread jank: when a visual frame is missed, the next frame catches up to the master clock. Bluetooth, physical speaker onset, rendering-frame error and varied natural lessons still need acceptance tests.

## Primary references checked

- [Web Audio output timestamps](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)
- [Web Audio base latency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency)
- [Gemini Live tools](https://ai.google.dev/gemini-api/docs/live-tools)
- [Speech synchronized whiteboard research](https://arxiv.org/abs/2603.25870)
