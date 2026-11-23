/* Gemini Live tutor and sequential whiteboard handwriting. */
globalThis.InkAppReady=false;
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const glyphs={
 '0':['M8 2 C-2 2 -1 29 7 30 C18 31 19 0 8 2'],
 '1':['M2 7 L8 1 L7 30','M2 30 L14 30'],
 '2':['M1 7 C5 -3 19 0 15 10 C13 16 4 23 1 29 L18 29'],
 '3':['M1 4 C10 -2 20 1 13 11 L7 15 C22 12 20 33 1 28'],
 '4':['M13 1 L0 20 L20 20','M14 7 L13 30'],
 '5':['M17 2 L3 2 L2 14 C19 9 24 32 2 28'],
 '6':['M15 1 C2 4 -3 31 9 30 C24 29 16 10 3 17'],
 '7':['M0 2 L19 2 L6 30'],
 '8':['M9 15 C-8 7 8 -6 16 4 C23 14 -9 19 3 29 C20 39 26 18 9 15'],
 '9':['M15 15 C-5 21 -3 -1 11 1 C24 3 15 26 3 31'],
 'x':['M1 9 L18 29','M18 8 C12 13 7 23 0 30'],
 '+':['M0 16 L20 16','M10 6 L10 27'],
 '-':['M0 17 L20 17'],
 '=':['M0 12 L21 12','M0 22 L21 22'],
 '/':['M19 0 L0 34'],
 'S':['M19 3 C-2 -5 -5 12 10 15 C28 21 18 36 0 28'],
 'O':['M10 1 C-4 1 -4 31 9 31 C25 30 25 0 10 1'],
 'L':['M2 1 L1 30 L19 30'],
 'V':['M0 1 L9 31 L22 1'],
 'E':['M20 1 L2 1 L1 30 L21 30','M2 15 L17 15'],
 'X':['M1 1 L21 30','M21 1 L0 31']
};
const white='#eeeedd', yellow='#eec57e';
const micButton = $('start-class');
let voiceSession;
let boardScene;

function readWritingDelay() {
  try {const value=Number(localStorage.getItem('ink-writing-delay-ms'));return Number.isFinite(value)&&value>=0&&value<=250?value:0;}
  catch{return 0;}
}
$('writing-delay').value=readWritingDelay();
$('writing-delay-value').textContent=readWritingDelay()+' ms';
$('writing-delay').oninput=()=>{
  const delay=Number($('writing-delay').value);
  try{localStorage.setItem('ink-writing-delay-ms',String(delay));}catch{}
  $('writing-delay-value').textContent=delay+' ms';
  $('timing-status').textContent='Saved for the next class. Test again if you change audio devices.';
};
$('timing-test').onclick=async()=>{
  if(voiceSession){$('timing-status').textContent='End the class before testing sound and pen timing.';return;}
  const button=$('timing-test');button.disabled=true;
  let context;
  try {
    context=new AudioContext();await context.resume();
    const clock=new InkSync.Controller(context,{visualDelayMs:readWritingDelay()});
    const starts=[.3,1,1.7].map(offset=>context.currentTime+offset),strokes=[];
    $('timing-preview').replaceChildren();
    for(let i=0;i<starts.length;i++) {
      const oscillator=context.createOscillator(),gain=context.createGain();
      oscillator.frequency.value=660;gain.gain.setValueAtTime(0,starts[i]);
      gain.gain.linearRampToValueAtTime(.08,starts[i]+.005);gain.gain.linearRampToValueAtTime(0,starts[i]+.12);
      oscillator.connect(gain).connect(context.destination);oscillator.start(starts[i]);oscillator.stop(starts[i]+.13);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      const path=document.createElementNS(NS,'path');path.setAttribute('d',`M ${10+i*80} 20 h 60`);
      path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','3');path.setAttribute('fill','none');
      path.setAttribute('stroke-dasharray','60');path.setAttribute('stroke-dashoffset','60');
      $('timing-preview').append(path);strokes.push(path);
    }
    $('timing-status').textContent='Each beep should begin with its pen stroke. Add delay only if the pen looks early.';
    await new Promise(resolve=>{
      const frame=()=>{
        const heard=Math.max(0,clock.audibleTime()-readWritingDelay()/1000);
        strokes.forEach((path,i)=>path.setAttribute('stroke-dashoffset',String(60*(1-Math.min(1,Math.max(0,(heard-starts[i])/.12))))));
        if(heard>=starts.at(-1)+.15)resolve();else requestAnimationFrame(frame);
      };frame();
    });
  }catch(error){$('timing-status').textContent='Timing test could not play: '+error.message;}
  finally{await context?.close().catch(()=>{});button.disabled=false;}
};

function renderLearning() {
  const { plan, observations } = InkLearning.snapshot();
  $('learning-goal').textContent = plan?.goal || 'Choose a topic to begin a lesson plan.';
  $('learning-plan').replaceChildren();
  for (const step of plan?.steps || []) {
    const item = document.createElement('li');
    const label = { pending: 'Upcoming', current: 'Now', complete: 'Covered' }[step.status];
    item.textContent = label + ' — ' + step.title;
    $('learning-plan').append(item);
  }
  $('learning-notes').replaceChildren();
  for (const note of observations) {
    const item = document.createElement('li');
    const label = { working_on: 'Working on', needs_help: 'Needs practice', demonstrated: 'Demonstrated' }[note.status];
    item.textContent = label + ' — ' + note.concept + '. Your words: “' + note.evidence + '”';
    $('learning-notes').append(item);
  }
  $('learning-storage').textContent = InkLearning.isPersistent()
    ? 'Saved in this browser and shared with Gemini when a class starts.'
    : 'Browser storage is unavailable. Notes will last only while this page is open.';
}

function rememberStudent(session, text) {
  if (text.trim()) session.studentUtterances.push(text.trim().slice(0, 2000));
  session.studentUtterances = session.studentUtterances.slice(-12);
}

function updateLearning(change, session) {
  const result = InkLearning.update(change, [...session.studentUtterances, session.studentTranscript]);
  renderLearning();
  return result;
}

$('clear-learning').onclick = () => {
  if (voiceSession) closeVoice('Learning notes cleared. Start a new class to use a fresh context.');
  InkLearning.clear();
  renderLearning();
};
renderLearning();

const liveInk = $('ink');
const pen = document.createElementNS(NS, 'g');
pen.setAttribute('aria-hidden', 'true');
pen.style.display = 'none';
const penBody = document.createElementNS(NS, 'path');
penBody.setAttribute('d', 'M0 0 L9 -29 L19 -25 L6 2 Z');
penBody.setAttribute('fill', '#f5edcf');
const penTip = document.createElementNS(NS, 'path');
penTip.setAttribute('d', 'M0 0 L6 2 L-2 7 Z');
penTip.setAttribute('fill', '#e8af64');
pen.append(penBody, penTip);
$('board').append(pen);
const mathGlyphs = {
  ...glyphs,
  '(': ['M11 0 Q-2 15 11 31'],
  ')': ['M2 0 Q15 15 2 31'],
  '.': ['M5 29 L6 29'],
  ',': ['M7 27 L4 33'],
  '·': ['M8 16 L9 16'],
  '×': glyphs.x,
  '*': ['M9 7 L9 24 M2 11 L17 20 M2 20 L17 11'],
  '÷': ['M0 16 L19 16 M9 8 L10 8 M9 24 L10 24'],
  '^': ['M1 13 L8 3 L16 13'],
  '√': ['M0 17 L6 20 L10 30 L17 1 L25 1'],
  'Σ': ['M22 2 L1 2 L14 15 L1 29 L23 29'],
  'θ': ['M11 2 C-1 2 -2 29 9 30 C21 31 23 2 11 2 M3 16 L18 16'],
  'J': ['M5 2 L20 2 M16 2 L15 23 Q13 34 2 27'],
  'C': ['M20 5 C0 -8 -7 36 20 28'],
  'M': ['M1 30 L2 1 L11 17 L21 1 L22 30'],
  'N': ['M1 30 L2 1 L21 30 L22 1'],
  'n': ['M2 29 L2 10 M2 17 Q18 2 18 19 L18 29'],
  'm': ['M1 29 L1 10 M1 17 Q10 3 11 18 L11 29 M11 18 Q22 3 22 18 L22 29'],
  'f': ['M7 30 L9 8 Q10 -2 20 2 M2 14 L17 14'],
  'y': ['M1 10 L10 27 M19 10 L6 37'],
  'w': ['M1 10 L5 29 L12 15 L17 29 L24 10'],
  'b': ['M2 1 L2 29 M2 19 C18 0 26 31 2 29'],
  'i': ['M7 11 L7 29 M7 4 L8 4'],
  'a': ['M17 14 C1 1 -4 29 8 29 Q14 29 17 22 M17 11 L17 29'],
  'e': ['M2 19 L18 18 C20 4 -1 7 1 21 Q3 34 19 26'],
  'r': ['M2 29 L2 11 M2 18 Q10 7 18 11'],
  'o': ['M10 10 C-2 8 -3 30 9 30 C22 31 23 9 10 10'],
  't': ['M9 3 L8 24 Q8 32 17 27', 'M1 13 L17 13'],
  's': ['M18 12 C3 4 -3 18 10 20 C24 23 17 34 1 27'],
  'u': ['M2 10 L2 23 Q3 36 17 23 M18 10 L18 29'],
  'c': ['M19 12 C0 1 -6 35 20 27'],
  'l': ['M8 1 L7 25 Q7 32 15 28'],
  'd': ['M18 1 L17 29 M17 14 C0 3 -5 30 7 30 Q14 30 17 22'],
  'p': ['M2 11 L2 39 M2 16 C20 -3 27 31 3 27'],
};
boardScene = new InkBoard.Scene(liveInk, $('board'), pen, mathGlyphs, layoutBoardMath);
const developmentMode = new URLSearchParams(location.search).has('debugSync');
const phase0Mode = new URLSearchParams(location.search).has('phase0');
let lastPhase0Session;
function phase0Options() {
  if(!phase0Mode)return {};
  return {
    enabled:true,
    outputType:$('phase0-output').value,
    toolScheduling:$('phase0-scheduling').value,
    lookaheadMs:Number($('phase0-lookahead').value),
    wordTimestamps:$('phase0-word-timestamps').checked,
    captureText:$('phase0-capture-text').checked,
    captureAudio:$('phase0-capture-audio').checked,
    ...globalThis.INK_PHASE0_OPTIONS,
  };
}


function reportSync(session, event) {
  if (voiceSession !== session) return;
  if (event.state && session.connected) $('state').textContent = event.state;
  if (developmentMode) $('sync-diagnostics').textContent = JSON.stringify(session.sync.diagnostics(), null, 2);
  for(const job of session.canvasJobs?.values()||[])renderCanvasJob(job);
}

function runSyncFrame(session) {
  if (voiceSession !== session) return;
  try { session.sync.tick(); session.probe.sample(session.sync); }
  catch (error) { closeVoice('Audio/board playback stopped: ' + error.message); return; }
  const idle=session.connected&&!session.paused&&!session.sync.ranges.length&&![...session.sync.actions.values()].some(action=>['prepared','started'].includes(action.status));
  if(idle){
    session.idleSince??=performance.now();
    if(performance.now()-session.idleSince>1000&&session.playback.state==='running'){
      session.idleSuspended=true;session.playback.suspend().catch(()=>{});
    }
  }else session.idleSince=undefined;
  session.frame = requestAnimationFrame(() => runSyncFrame(session));
}

function wakePlayback(session){
  session.idleSince=undefined;
  if(session.idleSuspended&&!session.paused){session.idleSuspended=false;session.playback.resume().catch(error=>{if(voiceSession===session)closeVoice(error.message);});}
}

function interruptPlayback(session, reason) {
  for(const job of session.canvasJobs?.values()||[])if(job.status==='drawing')job.abort.abort();
  session.sync.interrupt(reason);
  session.boardCalls.clear();
  session.toolActions.clear();
  session.transcript = '';
  session.boardStatePending = reason !== 'next_student_message';
  pen.style.display = 'none';
}

function closeVoice(message = 'Class ended.') {
  const session = voiceSession;
  if (session) {
    cancelAnimationFrame(session.frame);
    clearTimeout(session.timer);
    session.sync?.close();
    for(const job of session.canvasJobs?.values()||[])job.abort.abort();
    if(session.probe?.enabled)lastPhase0Session=session;
    session.socket?.close();
    session.stream?.getTracks().forEach(track => track.stop());
    session.capture?.close().catch(() => {});
    session.output?.close();
    session.playback?.close().catch(() => {});
  }
  voiceSession = undefined;
  pen.style.display = 'none';
  micButton.textContent = 'Start class';
  $('pause-tutor').disabled = true;
  $('mute-mic').disabled = true;
  $('state').textContent = 'Ready';
  $('caption').textContent = message;
}

function boardState(session) {
  return { board: boardScene.snapshot(), generationId:'g' + session.sync.generation, timing:'approximate' };
}

function renderCanvasJob(job){
  const session=voiceSession;if(!session||session.sync.generation!==job.generation)return;
  $('canvas-panel').hidden=false;
  const key='canvas-card-'+job.generation+'-'+job.id;
  let card=document.getElementById(key);
  if(!card){
    card=document.createElement('div');card.id=key;card.className='canvas-card';
    const status=document.createElement('p');status.className='canvas-job-status';card.append(status);
    const keep=document.createElement('button');keep.type='button';keep.textContent='Keep illustration';
    const reject=document.createElement('button');reject.type='button';reject.textContent='Remove illustration';
    keep.onclick=()=>{job.accepted=true;renderCanvasJob(job);};
    reject.onclick=()=>{
      job.abort.abort();session.sync.cancelActions(job.actionIds);boardScene.discardTargets(job.targetIds);
      job.status='removed';renderCanvasJob(job);
    };
    card.append(keep,reject);$('canvas-jobs').append(card);
  }
  const done=job.actionIds.length&&job.actionIds.every(id=>session.sync.actions.get(id)?.status==='completed');
  const status=job.status==='removed'?'Illustration removed.':job.error||
    (done?'Illustration written.':job.status==='drawing'?'Preparing the illustration while your teacher speaks.':job.status==='cancelled'?'Illustration interrupted.':'Illustration prepared; writing follows the voice.');
  card.querySelector('.canvas-job-status').textContent=(job.accepted?'Kept. ':'')+status;
  for(const button of card.querySelectorAll('button'))button.disabled=job.status==='removed';
}

function prepareBoardCall(call, session) {
  const generation = session.sync.generation;
  const callKey = generation + ':' + call.id;
  const duplicate = session.boardCalls.get(callKey);
  if (duplicate) {
    if (duplicate.fingerprint !== JSON.stringify(call)) return {error:'Repeated call ID has different content.'};
    return { ...duplicate.response, actions:duplicate.ids.map(id=>{
      const action=session.sync.actions.get(id);
      return action ? session.sync.result(action) : {actionId:id,status:'cancelled'};
    }) };
  }
  if (session.boardCalls.size >= 128) return {error:'Tool history limit reached. Start a new class.'};
  try {
    const args=call.args||{};
    let actions, segmentId;
    if (call.name==='show_step') {
      if(!Array.isArray(args.lines)||!args.lines.length||args.lines.length>8||typeof args.explanation!=='string'||args.explanation.length>2000) throw Error('Supply one to eight math lines and a short explanation.');
      args.lines.forEach(layoutBoardMath);
      const next = ++session.boardSequence;
      segmentId='step_' + next;
      actions=args.lines.map((content,i)=>({actionId:'step_' + next + '_line_' + i,kind:'write_math',targetId:'eq_' + next + '_' + i,content}));
    } else if(call.name==='draw_strokes'){
      if(!Array.isArray(args.strokes)||!args.strokes.length||args.strokes.length>24)throw Error('Supply one to 24 timed strokes.');
      actions=args.strokes.map(InkStroke.action);segmentId=args.segmentId;
    } else {
      if(!Array.isArray(args.actions)||!args.actions.length||args.actions.length>8)throw Error('Supply one to eight actions.');
      actions=args.actions;segmentId=args.segmentId;
    }
    const segment=session.sync.openSegment(segmentId);
    const prepared=[];
    const existingActions=new Set(session.sync.actions.keys());
    const originalOffset=segment.actionSeconds;
    try {
      for (const action of actions) prepared.push(session.sync.prepare(segment,action,(input,g)=>boardScene.prepare(input,g)));
    } catch(error) {
      session.sync.cancelActions(prepared.filter(result=>result.status==='prepared'&&!existingActions.has(result.actionId)).map(result=>result.actionId));
      segment.actionSeconds=originalOffset;
      throw error;
    }
    const response={ok:true,status:'prepared',generationId:'g'+generation,timing:'approximate',actions:prepared,
      instruction:'Paths are prepared, not yet fully written. Speak this short unit now while writing advances with audio playback. Timing is approximate. Use returned targetIds for later decorations.'};
    if(args.learning)response.learning=updateLearning(args.learning,session);
    if(args.explanation)$('caption').textContent=args.explanation;
    session.boardCalls.set(callKey,{fingerprint:JSON.stringify(call),response,ids:prepared.map(result=>result.actionId)});
    session.toolActions.set(call.id,prepared.map(result=>result.actionId));
    return response;
  }catch(error){return {error:error.message,...boardState(session)};}
}

async function handleTool(call, session) {
  wakePlayback(session);
  const generation=session.sync.generation;
  if(session.adapter.cancelledCalls.has(call.id))return;
  session.sync.log('tool_arrival',{name:call.name,callId:call.id});
  let response;
  if(call.name==='check_math')response=await checkMath(call.args);
  else if(call.name==='update_learning')response=updateLearning(call.args,session);
  else if(call.name==='get_board_state')response={ok:true,...boardState(session)};
  else if(call.name==='phase0_marker'&&session.probe.enabled) {
    const {cueId,anchor_text,occurrence=1}=call.args||{};
    if(typeof cueId!=='string'||cueId.length>64||typeof anchor_text!=='string'||anchor_text.length>180)response={error:'Invalid timing marker.'};
    else {
      session.probe.record('marker_cue',{epoch:generation,cueId,occurrence,...(session.probe.captureText?{anchor_text}:{characters:anchor_text.length})});
      response={ok:true,status:'prepared',cueId};
    }
  }
  else if(call.name==='delegatePrompt'){
    try{
      const job=InkCanvas.start(session,call.args,boardScene,renderCanvasJob);
      response={ok:true,status:'delegated',jobId:job.id,instruction:'Explain the planned narration now. Canvas work runs independently. Check actual visibility using get_board_state.'};
    }catch(error){response={error:error.message};}
  }
  else if(['show_step','board_actions','draw_strokes'].includes(call.name))response=prepareBoardCall(call,session);
  else response={error:'Unknown tool.'};
  if(voiceSession!==session||generation!==session.sync.generation||session.adapter.cancelledCalls.has(call.id))return;
  session.sync.log('tool_result',{name:call.name,status:response.status||'returned',error:response.error||null});
  if(['show_step','board_actions','draw_strokes','delegatePrompt','phase0_marker'].includes(call.name)) {
    const scheduling=session.probe.enabled?session.probe.settings.toolScheduling:'WHEN_IDLE';
    if(scheduling!=='OMIT')response.scheduling=scheduling;
  }
  session.probe.record('tool_ack',{epoch:generation,name:call.name,callId:call.id,scheduling:response.scheduling||'OMIT'});
  session.socket.send(JSON.stringify({toolResponse:{functionResponses:[{id:call.id,name:call.name,response}]}}));
}

function sendStudentText(session, question) {
  wakePlayback(session);
  if (session.requestPending || session.sync.queueSeconds() || [...session.sync.actions.values()].some(action=>['prepared','started'].includes(action.status))) {
    interruptPlayback(session,'typed_interruption');
    session.adapter.fence();
  }
  else if(session.sync.actions.size) interruptPlayback(session,'next_student_message');
  session.requestPending=true;
  rememberStudent(session,question);
  session.probe.record('user_request',{epoch:session.sync.generation,...(session.probe.captureText?{text:question}:{characters:question.length})});
  session.sync.stats.lastUserInputEndMs=performance.now();
  session.sync.log('user_text_end');
  session.socket.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:question}]}],turnComplete:true}}));
}

// Lets the tutor verify a worked example with the same OpenMath solver as the side panel.
async function checkMath(args) {
  const expression = typeof args?.expression === 'string' ? args.expression.trim() : '';
  if (!expression || expression.length > 500) return { error: 'Supply one short equation or expression.' };
  try {
    const { answer, steps } = await requestMath('/math-solve', { problem: expression });
    return { ok: true, verified: true, answer, steps: (steps || []).slice(0, 8) };
  } catch {
    return { ok: false, verified: false, note: 'Could not verify automatically. Check the arithmetic by hand.' };
  }
}

async function startClass(withMicrophone) {
  if (voiceSession) return voiceSession.ready;
  const session = {
    playback: new AudioContext({sampleRate:24000,latencyHint:'interactive'}),
    phase0: phase0Options(),
    adapter: new InkGemini.Adapter(),
    boardCalls: new Map(),
    toolActions: new Map(),
    boardSequence: 0,
    muted: false,
    transcript: '',
    studentTranscript: '',
    studentUtterances: [],
  };
  voiceSession = session;
  $('canvas-jobs').replaceChildren();$('canvas-panel').hidden=true;
  session.probe = new InkPhase0.Probe(session.phase0);
  session.sync = new InkSync.Controller(session.playback, {
    visualDelayMs:readWritingDelay(),
    config: {...globalThis.INK_SYNC_CONFIG,...(phase0Mode?{lookaheadMs:session.phase0.lookaheadMs}:{})},
    observeLog: event => session.probe.record('controller',event),
    notify: event => reportSync(session,event),
  });
  session.playback.onstatechange = () => {
    if(voiceSession===session && session.playback.state==='closed') closeVoice('Audio output closed. Start class to reconnect.');
  };
  runSyncFrame(session);
  micButton.textContent = 'End class';
  $('state').textContent = 'Connecting';
  $('caption').textContent = 'Connecting to Gemini Live…';
  session.ready = (async () => {
    await session.playback.resume();
    session.output=await InkAudio.Output.create(session.playback);
    if(voiceSession!==session){session.output.close();throw Error('Class cancelled.');}
    session.output.onError=error=>{if(voiceSession===session)closeVoice(error.message);};
    session.sync.setOutput(session.output);
    if (withMicrophone) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      if (voiceSession !== session) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Class cancelled.');
      }
      session.stream = stream;
      if(session.probe.enabled) {
        const settings=stream.getAudioTracks()[0]?.getSettings()||{};
        session.probe.record('capture_settings',{
          echoCancellation:settings.echoCancellation??null,
          noiseSuppression:settings.noiseSuppression??null,
          autoGainControl:settings.autoGainControl??null,
          sampleRate:settings.sampleRate??null,channelCount:settings.channelCount??null,
        });
      }
      session.capture = new AudioContext({ sampleRate: 16000 });
      await session.capture.resume();
      await session.capture.audioWorklet.addModule('/mic-capture.js');
    }
    if (voiceSession !== session) throw new Error('Class cancelled.');
    const response = await fetch('/voice-session', { method: 'POST' });
    if (!response.ok) throw new Error(response.statusText || 'Could not start Gemini Live.');
    const { token, model } = await response.json();
    session.model=model;
    session.probe.record('setup',{model,wordTimestamps:Boolean(session.phase0.wordTimestamps),compression:Boolean(session.phase0.compression),resumption:Boolean(session.phase0.resumption)});
    if (voiceSession !== session) throw new Error('Class cancelled.');
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(InkLive.endpoint + '?access_token=' + encodeURIComponent(token));
      session.socket = socket;
      socket.binaryType = 'arraybuffer';
      session.timer = setTimeout(() => {
        reject(new Error('Gemini Live connection timed out.'));
        if (voiceSession === session) closeVoice('Gemini Live connection timed out.');
      }, 20000);
      socket.onopen = () => socket.send(JSON.stringify({
        setup: InkLive.setup(model, InkLearning.snapshot(), boardScene.snapshot(), session.phase0),
      }));
      socket.onmessage = ({ data }) => {
        if (voiceSession !== session) return;
        try {
          session.sync.stats.receivedSocketBytes=(session.sync.stats.receivedSocketBytes||0)+(typeof data==='string'?new TextEncoder().encode(data).length:data.byteLength);
          const message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
          if(message.sessionResumptionUpdate?.newHandle)session.resumptionHandle=message.sessionResumptionUpdate.newHandle;
          for(const event of session.adapter.normalize(message, session.sync.generation)) {
            session.probe.observe(event,session.sync);
            if(event.kind==='error')throw Error(event.message);
            if(event.kind==='usage')session.sync.stats.latestProviderUsage=event.usage;
            if(event.kind==='ready') {
              session.connected=true;
              clearTimeout(session.timer);
              if(session.stream) {
                const capture=new AudioWorkletNode(session.capture,'mic-capture',{numberOfOutputs:0});
                session.capture.createMediaStreamSource(session.stream).connect(capture);
                capture.port.onmessage=({data:bytes})=>{
                  if(session.muted||socket.readyState!==WebSocket.OPEN||socket.bufferedAmount>65536)return;
                  const samples=new Int16Array(bytes);
                  const energy=Math.sqrt(samples.reduce((sum,sample)=>sum+(sample/32768)**2,0)/samples.length);
                  if(energy>0.025) {
                    if(!session.micSpeech) {
                      session.micCandidateAt=performance.now();session.micConfirmed=false;
                      session.probe.record('local_speech_candidate',{source:'energy_threshold',queueSeconds:session.sync.queueSeconds()});
                    }
                    session.micSpeech=true;session.lastMicSpeech=performance.now();
                    if(!session.micConfirmed&&performance.now()-session.micCandidateAt>=session.probe.settings.speechConfirmMs) {
                      session.micConfirmed=true;
                      session.probe.record('local_speech_confirmed',{source:'energy_threshold',onsetEstimateMs:session.micCandidateAt,queueSeconds:session.sync.queueSeconds()});
                    }
                  }
                  else if(session.micSpeech && performance.now()-session.lastMicSpeech>400) {
                    session.micSpeech=false;
                    session.probe.record('local_speech_end',{source:'energy_threshold',endEstimateMs:session.lastMicSpeech});
                    session.sync.log('user_speech_end_estimate',{source:'local_energy_threshold',endAtMs:session.lastMicSpeech});
                  }
                  const message=JSON.stringify({realtimeInput:{audio:{data:btoa(String.fromCharCode(...new Uint8Array(bytes))),mimeType:'audio/pcm;rate=16000'}}});
                  session.sync.stats.sentMicrophoneSocketBytes=(session.sync.stats.sentMicrophoneSocketBytes||0)+message.length;
                  socket.send(message);
                };
              }
              $('pause-tutor').disabled=false;
              $('mute-mic').disabled=!session.stream;
              $('pause-tutor').textContent='Pause tutor';
              $('mute-mic').textContent='Mute mic';
              $('state').textContent='Live';
              $('caption').textContent=session.stream?'Listening. Tell me what you want to learn.':'Connected. Type a question below.';
              resolve(session);
            }
            if(event.kind==='input_text') {
              session.studentTranscript=(session.studentTranscript+event.text).slice(-4000);
              session.sync.log('input_transcript_arrived');
            }
            if(event.kind==='interrupt')interruptPlayback(session,'provider_interruption');
            if(event.kind==='cancel_tools')session.sync.cancelActions(event.ids.flatMap(id=>session.toolActions.get(id)||[]));
            if(event.kind==='tool')handleTool(event.call,session).catch(error=>closeVoice('Tool execution failed: '+error.message));
            if(event.kind==='audio'){wakePlayback(session);session.sync.enqueue(event.bytes,event.rate);}
            if(event.kind==='generation_end')session.sync.generationComplete();
            if(event.kind==='output_text') {
              session.transcript=(session.transcript+event.text).slice(-6000);
              $('transcript').textContent=session.transcript;
            }
            if(event.kind==='turn_end') {
              session.requestPending=false;
              if(!event.fenced)session.sync.endTurn();
              if(event.fenced && session.boardStatePending && socket.readyState===WebSocket.OPEN) {
                // Append actual partial state without requesting a new model turn.
                socket.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:'Board state after interruption (data only): '+JSON.stringify(boardState(session))}]}],turnComplete:false}}));
                session.boardStatePending=false;
              }
              rememberStudent(session,session.studentTranscript);
              session.studentTranscript='';session.transcript='';
            }
          }
        } catch(error) {
          reject(error);
          closeVoice('Live playback stopped: '+error.message);
        }
      };
      socket.onerror = () => reject(new Error('Gemini Live connection failed.'));
      socket.onclose = ({ code, reason='' }) => {
        session.probe.record('socket_closed',{code,reason:reason.replace(/access_token=[^ &]+/g,'access_token=[redacted]').slice(0,600)});
        reject(new Error('Gemini Live closed before connecting.'));
        if (voiceSession === session) closeVoice('Gemini Live disconnected (code ' + code + '). Start class to reconnect.');
      };
    });
  })();
  try {
    return await session.ready;
  } catch (error) {
    if (voiceSession === session) closeVoice(error.message);
    throw error;
  }
}

micButton.onclick = () => {
  if (voiceSession) closeVoice();
  else startClass(true).catch(() => {});
};

$('board-question').onsubmit = async event => {
  event.preventDefault();
  const field = $('question');
  const question = field.value.trim();
  if (!question) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const session = await startClass(false);
    sendStudentText(session, question);
    field.value = '';
  } catch (error) {
    $('caption').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
async function requestMath(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(response.statusText || 'The math request failed.');
  return response.json();
}

const mathForm = $('math-problem');
const mathStatus = $('math-status');
let readContext;

$('math-read').onclick = async () => {
  const problem = $('math-source').value.trim();
  const file = $('math-photo').files[0];
  if (!problem && !file) {
    mathStatus.textContent = 'Enter a word problem or choose a photo.';
    return;
  }
  const buttons = mathForm.querySelectorAll('button');
  buttons.forEach(button => button.disabled = true);
  mathStatus.textContent = 'Reading the problem with Gemini…';
  readContext = undefined;
  try {
    let photo;
    if (file) {
      if (file.size > 4 * 1024 * 1024) throw new Error('Choose a photo under 4 MB.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the photo.'));
        reader.readAsDataURL(file);
      });
      photo = { mimeType: file.type, data };
    }
    const { expression } = await requestMath('/math-expression', { problem, photo });
    $('math-expression').value = expression;
    readContext = { problem, expression };
    mathStatus.textContent = 'Check that the formula matches your problem, then solve it.';
  } catch (error) {
    mathStatus.textContent = error.message;
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
};

mathForm.onsubmit = async event => {
  event.preventDefault();
  const expression = $('math-expression').value.trim();
  const problem = readContext?.expression === expression ? readContext.problem : '';
  const buttons = mathForm.querySelectorAll('button');
  buttons.forEach(button => button.disabled = true);
  mathStatus.textContent = 'Checking the steps with OpenMath…';
  const originalSession = voiceSession;
  try {
    // Start the existing audio connection during the submit gesture.
    const [session, solution] = await Promise.all([
      startClass(false),
      requestMath('/math-solve', { problem: expression }),
    ]);
    if (session !== voiceSession || (originalSession && session !== originalSession)) return;
    const text = [
      'Please explain this verified OpenMath solution.',
      JSON.stringify({ originalProblem: problem, ...solution }),
    ].join('\n');
    sendStudentText(session, text);
    mathStatus.textContent = 'OpenMath checked the solution and sent it to the live tutor.';
  } catch (error) {
    mathStatus.textContent = error.message;
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
};

window.addEventListener('pagehide', () => closeVoice());

$('pause-tutor').onclick=async()=>{
  const session=voiceSession;if(!session)return;
  try {
    if(!session.paused) {session.paused=true;session.sync.tick();await session.playback.suspend();session.sync.transition('paused');$('pause-tutor').textContent='Resume tutor';}
    else {session.paused=false;session.idleSuspended=false;await session.playback.resume();session.sync.transition('ready');$('pause-tutor').textContent='Pause tutor';}
  }catch(error){closeVoice('Playback failed: '+error.message);}
};
$('mute-mic').onclick=()=>{
  const session=voiceSession;if(!session?.stream)return;
  session.muted=!session.muted;
  session.stream.getAudioTracks().forEach(track=>track.enabled=!session.muted);
  if(session.muted && session.socket?.readyState===WebSocket.OPEN)session.socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));
  $('mute-mic').textContent=session.muted?'Unmute mic':'Mute mic';
  session.sync.log(session.muted?'microphone_muted':'microphone_unmuted');
};
if(developmentMode) {
  $('sync-panel').hidden=false;
  globalThis.inkSyncDiagnostics=()=>voiceSession?.sync.diagnostics();
}

if(phase0Mode) {
  $('phase0-panel').hidden=false;
  $('phase0-start').onclick=async()=>{
    try {
      if(voiceSession&&!voiceSession.stream)closeVoice('Switching to the microphone test.');
      const session=await startClass(true);
      const question=$('phase0-question').value.trim();
      if(question)sendStudentText(session,question);
      $('phase0-status').textContent='Microphone test started. Listen quietly first, then mark and speak an interruption.';
    }catch(error){$('phase0-status').textContent=error.message;}
  };
  globalThis.inkPhase0Report=()=>{
    const session=voiceSession||lastPhase0Session;
    return session?.probe.report(session.sync,boardScene);
  };
  globalThis.inkPhase0Audio=epoch=>(voiceSession||lastPhase0Session)?.probe.wavBase64(epoch);
  const annotate=label=>{
    voiceSession?.probe.record('annotation',{label,epoch:voiceSession.sync.generation});
    $('phase0-status').textContent='Marked '+label+'.';
  };
  $('phase0-mark-quiet').onclick=()=>annotate('quiet_listening');
  $('phase0-mark-interrupt').onclick=()=>annotate('planned_interruption');
  $('phase0-download').onclick=()=>{
    const report=globalThis.inkPhase0Report();
    if(!report){$('phase0-status').textContent='Start a class first.';return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='InkTutor-phase0-'+Date.now()+'.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('phase0-finish').onclick=()=>{
    annotate('device_test_finished');
    globalThis.inkPhase0Finished=true;
    closeVoice('Device test finished. Timing metadata is available for review.');
  };
}

globalThis.InkAppReady=true;
