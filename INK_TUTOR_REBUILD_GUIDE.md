# Ink Tutor rebuild guide

Use this document to recreate the current prototype or build a similar live teaching app. This is a snapshot dated 15 November 2026. Distinguish implemented features from the planned illustration capability below.

## Product requirements

Build a personal teacher with live voice, a whiteboard, typed questions, learner memory, and a dynamic learning progression. The learner chooses the subject. Generate examples, exercises, and milestones from the conversation. Teach a milestone, assign varied practice, assess each answer and its reasoning, repair specific gaps, and advance when the learner demonstrates understanding.

Use one teaching policy. Respect requests for hints, full solutions, several exercises, or one-step pacing. Let the learning purpose determine response length. Avoid scripted lessons, speech timers, and repeated permission checks.

## Architecture and files

| File | Purpose |
| --- | --- |
| `voice_server.py` | Python standard-library server and privileged API routes |
| `index.html`, `style.css` | Blank whiteboard, Start class, captions, typed input, problem input, learner notes |
| `live-config.js` | Single teaching policy, dynamic context, Live configuration and tool declarations |
| `app.js` | Session lifecycle, tool execution, UI integration |
| `playback-sync.js` | Audio scheduling and approximate playback-driven board actions |
| `board-scene.js` | Semantic actions to progressive SVG geometry |
| `gemini-adapter.js` | Normalize native stream events and interruption fences |
| `phase0-probe.js` | Opt-in timing observations; no microphone recording |
| `ink-config.json` | Non-secret server model configuration |
| `audio-output.js`, `audio-playback-worklet.js` | Off-thread PCM playback and sample clock |
| `stroke-protocol.js` | Timestamped generic vector serialization |
| `canvas-jobs.js`, `canvas_agent.py` | Async visual delegation, canvas feedback and streamed strokes |
| `mic-capture.js` | AudioWorklet sending 16 kHz mono PCM in roughly 50 ms chunks |
| `board-math.js` | Supported notation to positioned glyph marks |
| `learning-state.js` | Browser-local plan and evidence-backed concept notes |
| `openmath-solver.mjs` | Node adapter loading OpenMath TypeScript sources |
| `OpenMath/` | External symbolic solver with its own licensing |
| `dist/` | Served frontend copies |
| `simulate.mjs` | Optional text-only teaching evaluation |

The server binds to `127.0.0.1:7860` and serves `dist/`. It holds the long-lived Gemini key and issues a one-use temporary Live token. The browser connects directly to Gemini Live with that token, streams microphone audio, receives 24 kHz audio and transcriptions, and executes tool calls. Return each function result using its call ID and name. Process all content parts in each server event.

Model identifiers are read from `ink-config.json`; current values are `models/gemini-3.8-live` and `gemini-3.8-flash`. Copy that configuration alongside the server. Verify model availability and provider documentation when recreating the app. See `PHASE0_FINDINGS.md` for the new synchronization specification, tested capability limits, and measurement commands.

## Routes and tools

- `POST /voice-session` obtains the temporary Live token.
- `POST /math-expression` reads a photo or translates prose into an unsolved formula. Let the learner review the formula before solving.
- `POST /math-solve` invokes OpenMath and returns complete verified steps, or an explicit unsupported/error response.
- `POST /board-lines` is a legacy content-extraction route, unused by the current Live frontend. Its instructions only extract supplied content.

Gemini has five normal Live tools. `show_step` queues up to eight related math lines, an explanation, and optional learning changes. `board_actions` prepares generic writing and annotation actions; `get_board_state` returns confirmed visible and partial content. `update_learning` updates the compact plan and concept notes. `check_math` verifies supported equations and expressions through OpenMath. A marker-only measurement tool is enabled solely by explicit test configuration. Keep argument formats and rendering limits in tool descriptions. Use the single teaching policy for teaching decisions.

The 23 November architecture update adds `draw_strokes` for explicitly timed vectors and `delegatePrompt` for a separate vision-capable drawing specialist, bringing the normal total to seven tools. See `specs/ARCHITECTURE_IMPLEMENTATION.md` for the implementation map and current verification limits. `npm run build` now copies all frontend dependencies to `dist/`.

Append the current learning summary and visible board expressions as labeled data at session start. Keep ongoing dialogue in the Live session. Browser notes use statuses `working_on`, `needs_help`, and `demonstrated`, plus student evidence and optional `lastError`. Store at most 12 notes and a moving window of one to five milestones. Topic coverage and demonstrated understanding are separate. Include a visible clear action.

## Whiteboard

Use the existing SVG board. Convert supported math notation into positioned marks and animate pen strokes sequentially. Powers sit above the baseline, fractions stack around a horizontal bar, and summation bounds surround the sigma. Some glyphs use paths and others progressively reveal text. Validate a whole batch before drawing. Keep expressions legible and retain the latest eight lines.

The synchronization vertical slice now drives strokes from scheduled playback sample ranges and preserves partial strokes on interruption. Timing remains approximate. See `VOICE_BOARD_SYNC.md` for setup, limits, measurement results, and remaining acceptance work.

Use native `generationComplete` to fit unfinished strokes into the remaining speech window without changing the audio schedule. The **Writing timing** control offers a local beep/stroke preview and a nonnegative writing-only delay. There is no universal constant guaranteeing exact spoken-word alignment; independent alignment and physical calibration remain acceptance work.

## General illustrations — planned

The current tools accept math, annotations, and arbitrary bounded freehand vector paths. A separate illustration specialist streams these paths from visual intent and current canvas context. Model-generated onset times remain estimates; no separately fine-tuned drawing model is bundled.

Extend the board to accept an editable scene of arbitrary vector paths, text, math, positions, colors, and object IDs. Gemini chooses the composition and drawing sequence freely. The local renderer validates operations, animates strokes, and returns confirmed scene state. Support later highlighting, moving, replacing, and erasing objects. Avoid a predefined catalog of lesson-specific diagrams. Process drawing data rather than arbitrary generated JavaScript or HTML.

## Recreate and run

Copy the application source and `dist/` to the new project folder. Install Python 3 and Node 24 compatible with the module hooks in `openmath-solver.mjs`. Obtain a Gemini key with access to the configured models. The current Python server uses only the standard library. The adapter loads OpenMath sources directly without installing its complete web application.

Fetch the solver if the checkout was not copied.

```powershell
git clone https://github.com/ndunl075/OpenMath.git OpenMath
```

Preserve `OpenMath/LICENSE` and `OpenMath/LICENSING.md` notices. Use the checkout revision recorded at the end of this document for reproducibility.

After frontend edits, synchronize the files Python serves.

```powershell
Copy-Item index.html,style.css,app.js,live-config.js,board-math.js,learning-state.js,mic-capture.js,playback-sync.js,board-scene.js,gemini-adapter.js,phase0-probe.js -Destination dist
```

Run these commands from the new project folder. Enter the key only at the masked prompt.

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

Open `http://127.0.0.1:7860/`, allow microphone access, and select Start class. Keep PowerShell open. Stop with Ctrl+C before restarting. Refresh and begin a fresh class after changing the prompt because existing sessions retain their setup. Keep long-lived keys on the server, validate Host and Origin, and avoid logging credentials or temporary tokens. Public hosting needs a separate deployment design.

## Implementation order

1. Create the blank workspace and local token server.
2. Establish live microphone capture, audio playback, transcription, interruption, and cleanup.
3. Add math layout, animated handwriting, and board tool responses.
4. Load the single teaching policy below and append learner context as data.
5. Add compact local memory with evidence validation and clearing.
6. Integrate OpenMath and the optional recognition/formula-review flow.
7. Validate real conversations before adding the general illustration scene.

## Acceptance checks

- Run `node --check` on JavaScript and `py -m py_compile voice_server.py`.
- Confirm deployed frontend copies match source, and old query strings cannot activate another teaching policy.
- Verify real microphone input, audible response, transcript, drawing, interruptions, and cleanup through the UI.
- Request a course with multiple exercises. Check explanations, varied practice, item-by-item marking, gap repair, and progression based on evidence.
- Submit a correct answer with incorrect reasoning and an incomplete answer batch. Check that the tutor identifies both.
- Test hint-only requests, complete worked solutions, and explicit one-step pacing.
- Check powers, fractions, sums, malformed notation, and interrupted writing visually.
- Use `3x + 5 = 20` as an algebra test with answer `x = 5`. Use predictions 3 and 3 and actual values 2 and 5 as a mean squared error test with answer `5/2 = 2.5`. These are test fixtures, not fixed teaching content.
- Test an actual photo and word problem through recognition, formula review, solver, narration, and board. Mock recognition does not establish real photo accuracy.
- Verify memory persistence, clearing, and that acknowledgements never establish mastery.
- Measure first-audio latency and failures with and without a solver call.

## Known gaps

OpenMath rejects raw word problems and supports a bounded symbolic domain. Recognition can misread input. End-to-end photo recognition and live reliability remain partly unverified, and earlier Live tests encountered timeouts. The most recent teaching-policy change passed syntax and configuration checks but has not undergone fresh live teaching evaluation.

Math notation is limited, and complex layouts need visual checking. General illustrations and precise speech-to-stroke timing remain planned. Memory is local to a browser origin/profile. Current audio evidence matching permits approximate word overlap, which can accept inaccurate quotations and needs stronger checks for rigorous assessment.

## References

- OpenMath source https://github.com/ndunl075/OpenMath
- Gemini Live documentation https://ai.google.dev/gemini-api/docs/live
- Teaching-guidance reference https://services.google.com/fh/files/misc/learnlm_prompt_guide.pdf

## Teaching policy snapshot

The following is copied from `live-config.js`. Maintain one executable source of truth in a rebuild and treat this document as a reference snapshot.

```text
You are Ink Tutor, a personal teacher who explains clearly, writes on a whiteboard, and builds understanding through conversation and practice.

Follow the learner’s chosen subject and goal. Use their actual questions, answers, mistakes, and preferences to decide what to teach next. Be accurate, warm, specific, and honest about uncertainty.

When the learner wants a course or asks to start from the beginning, develop a flexible progression of meaningful milestones. Begin with the foundations they need and connect each new milestone to what they already understand. Briefly orient them, then begin teaching. Revise the progression as their responses reveal strengths, gaps, or changing goals.

For each milestone, explain the central idea in ordinary language. Introduce necessary vocabulary and notation, show useful examples, and explain why the method works. Choose contrasting examples or boundary cases when they reveal an important distinction. Provide enough explanation for the learner to attempt the skill independently. Generate examples for the current lesson instead of repeating a fixed set.

Then offer a manageable practice round matched to that milestone. Include enough variety to reveal understanding: applying the idea, explaining a reason, distinguishing similar concepts, or transferring the idea to a fresh situation. Adjust the number and difficulty to the learner’s request, performance, and interaction style. A learner who asks for several exercises may receive a numbered batch. Leave those exercises unanswered until they attempt them or request help.

When the learner responds, match their answers to the exercises and assess each attempted part. Check both the result and the reasoning. Distinguish correct, incorrect, partially correct, missing, and ambiguous responses. Recognize valid reasoning specifically. If a conclusion is correct for an incorrect reason, explain the distinction. If a requested justification or subpart is missing, identify what remains incomplete. Do not silently supply missing work and credit it to the learner.

Use mistakes to select the next teaching action. Explain the specific gap, preserve the parts they understood, and choose a clearer example, comparison, representation, or simpler prerequisite. Give a focused follow-up practice round that tests the unresolved skill using fresh material. Avoid restarting the whole lesson when only one distinction needs work.

Advance when the learner’s independent answers give reasonable evidence that the milestone is understood. A guessed answer, repeated answer, or acknowledgement is weak evidence. Ask for a short reason or a transfer problem when needed. Avoid unnecessary repetition once understanding is clear. Briefly connect the achievement to the next milestone and begin it in the same reply when appropriate. Offer a harder challenge or skip familiar material when the evidence supports it. Revisit earlier ideas naturally in later practice.

Keep the conversation responsive. A direct question deserves a direct explanation. A request for a worked solution deserves the necessary steps and final result. A hint request deserves a useful clue with space for the learner to act. When they interrupt or change direction, address that request before continuing the learning progression.

Let the purpose determine response length. Explain connected ideas smoothly, complete a useful teaching unit, and pause when the learner has something meaningful to attempt or answer. Follow explicit pacing preferences. Avoid fixed speech durations, mandatory end-of-turn questions, and repeated permission checks. When the learner says “next,” continue from the current learning state without treating that word as proof of understanding.

Use the available whiteboard tools as part of the explanation. Put the relevant definitions, notation, examples, calculations, and exercises where the learner can refer to them. Write intermediate transformations needed to follow the reasoning and explain their purpose aloud. Choose a visual representation whenever an available drawing capability can clarify the relationship. Coordinate the explanation with the order of the board content. Follow the tool contracts and acknowledge drawing failures accurately.

Maintain a compact learning plan and evidence-based learner notes using the available tools. Distinguish material covered from understanding demonstrated. Record specific unresolved difficulties and update them when fresh evidence shows improvement. Treat saved observations as tentative, respect corrections, and let the current request guide the lesson. Keep this bookkeeping unobtrusive.

At every stage, base your next teaching action on what this learner has demonstrated and what will help them understand or practise next.
```

OpenMath checkout revision used by this prototype is: 4ef338eb0a374e4c2f720dae867e65af8e72ab23

## Synchronization update, 16 November 2026

See [VOICE_BOARD_SYNC.md](VOICE_BOARD_SYNC.md) for the implemented playback-driven vertical slice. It adds semantic writing and decoration actions, pause/mute controls, bounded scheduling, diagnostics, and timing/cancellation tests. The single teaching policy above remains the source snapshot. Native Live timing is approximate and real trials remain variable.
