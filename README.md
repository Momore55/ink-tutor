# Ink Tutor

A personal teacher with Gemini Live voice, progressive mathematical handwriting, learner notes, and a separate vision-capable drawing specialist. The learner chooses the subject; examples and lessons are generated from the conversation.

Native speech plays through an AudioWorklet on the audio rendering thread. The board follows the estimated speaker clock and PCM sample timeline. Generic vector strokes carry onset/duration metadata; the illustration specialist streams drawing data while voice remains independent. Drawings support keep/remove controls and stop on interruption.

**Status:** working prototype with deterministic and browser tests. Timestamped scheduling is implemented, but model-proposed stroke times are estimates. Exact per-word synchronization, Bluetooth calibration, and the complete live voice/drawing experience still require physical-device acceptance tests. See [the architecture implementation record](specs/ARCHITECTURE_IMPLEMENTATION.md).

## Run on Windows

Install Python 3.10+, Node.js 24+, Git, and Chrome for browser tests. No Python packages or npm runtime dependencies are required. A Gemini API key must have access to the configured Live and text models; model availability and quota depend on your account.

```powershell
git clone --recurse-submodules https://github.com/Momore55/ink-tutor.git
Set-Location -LiteralPath '.\ink-tutor'
node .\scripts\build.cjs
```

If you cloned without submodules, initialize the pinned OpenMath solver:

```powershell
git submodule update --init --recursive
```

Enter the key only at a masked prompt and leave the server window open:

```powershell
try {
    $env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new(
        '', (Read-Host 'Gemini API key' -AsSecureString)
    ).Password
    py .\voice_server.py
} finally {
    Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
}
```

Open [Ink Tutor locally](http://127.0.0.1:7860/), allow the microphone, and click **Start class**. For example, ask to explain a topic, solve a problem, or illustrate a relationship. Typed questions use the same Live session. Stop with Ctrl+C in PowerShell. The optional `start-ink-tutor.ps1` performs the masked-key setup and frontend copy.

**Writing timing → Test sound and pen** plays three paired beeps/strokes. If writing looks early, add a small writing-only delay and begin a new class. Retest when changing audio devices. This does not measure spoken-word alignment.

## How it works

| Component | Responsibility |
| --- | --- |
| `voice_server.py` | Loopback API server, temporary Live credentials, math and drawing routes |
| `canvas_agent.py` | Separate Gemini vision/text specialist streaming validated vector strokes |
| `audio-playback-worklet.js` | Off-thread bounded PCM queue, resampling, sample clock, epoch flush |
| `audio-output.js` | Worklet transport and completion/clock observations |
| `playback-sync.js` | PCM-to-playback mapping, latency compensation, stroke timing and interruption |
| `stroke-protocol.js` | Validated freehand/text/primitive stroke serialization |
| `board-scene.js` | Progressive SVG geometry, equations, annotations and arbitrary vector paths |
| `canvas-jobs.js` | Async delegation, canvas image/state feedback, cancellation and removal |
| `live-config.js` | One teaching policy and separate technical tool contracts |
| `OpenMath/` | Pinned external symbolic solver submodule |

The long-lived Gemini key stays in the server process. The browser receives a temporary Live token and connects directly to Gemini. Microphone audio is sent to Gemini during class; illustration requests send the current board image/state to the separate drawing call. Canvas images are not saved. Learner notes are browser-local and can be cleared. Diagnostic reports omit content by default; local test artifacts and credentials are excluded from this repository.

Backend routes: `/voice-session`, `/canvas-actions`, `/math-expression`, `/math-solve`, and the retained legacy `/board-lines`. The server binds only to `127.0.0.1:7860` and enforces localhost Host/Origin checks. This is a local prototype; GitHub Pages alone cannot run its Python backend. No public hosted service is deployed.

## Test and develop

```powershell
npm test
py -m unittest discover -s tests -p test_canvas_agent.py
npm run test:browser
npm run test:vectors
node tests/phase0-page.cjs
# With the real server running with your key:
npm run test:live
```

Browser harnesses use an isolated Chrome profile and local synthetic fixtures; no personal browser profile is read. Real Live tests consume provider quota. Test equations and shapes are fixtures, not hardcoded runtime lessons. Regenerate `dist/` with `npm run build` after frontend edits, refresh, and start a fresh class. Restart Python after backend changes.

Model IDs are pinned in `ink-config.json`. Keep native output word timestamps disabled for the previously tested endpoint unless a new capability test confirms support.

## Sources and notices

- [OpenMath](https://github.com/ndunl075/OpenMath), revision `4ef338eb0a374e4c2f720dae867e65af8e72ab23`. Its MIT license and licensing notes remain in the submodule. Ink Tutor uses symbolic solving, not its OCR model weights.
- The teaching guidance originally consulted [Google's LearnLM Partner Prompt Guide](https://services.google.com/fh/files/misc/learnlm_prompt_guide.pdf), CC BY 4.0; the current unified policy is in `live-config.js`.
- The user-supplied architecture informed this implementation. [ExcaliTeach research](https://arxiv.org/abs/2603.25870) supports timestamp-conditioned drawing research; this project does not bundle its fine-tuned model or claim its evaluation results.

Historical local test findings are documented in [PHASE0_FINDINGS.md](PHASE0_FINDINGS.md) and [WRITING_SYNC_FIX.md](WRITING_SYNC_FIX.md); their raw captures stay local.
