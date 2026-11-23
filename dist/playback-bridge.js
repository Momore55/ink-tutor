/* Playback-driven scheduling. Native Gemini audio provides no word alignment here. */
(function (root) {
  let generationCounter = 0;
  const defaults = Object.freeze({ lookaheadMs: 250, maxQueueSeconds: 60, maxActions: 64,
    maxEvents: 256, maxSegments: 48, maxResults: 128, lateToleranceMs: 400, maxPreparedMs: 6000 });

  class Controller {
    constructor(context, options = {}) {
      this.context = context;
      this.config = { ...defaults, ...options.config };
      this.visualDelayMs = options.visualDelayMs ?? 0;
      if(!Number.isFinite(this.visualDelayMs)||this.visualDelayMs<0||this.visualDelayMs>250)throw Error('Writing delay must be between 0 and 250 ms.');
      for (const key of Object.keys(defaults)) {
        if (!Number.isFinite(this.config[key]) || this.config[key] <= 0) throw Error('Invalid sync limit: ' + key);
      }
      if (this.config.lookaheadMs > 400) throw Error('Lookahead must be at most 400 ms.');
      this.now = options.now || (() => performance.now());
      this.notify = options.notify || (() => {});
      this.observeLog = options.observeLog || (() => {});
      this.generation = ++generationCounter;
      this.sequence = 0;
      this.epochSamples = 0;
      this.segment = null;
      this.segments = new Map();
      this.actions = new Map();
      this.events = [];
      this.ranges = [];
      this.sources = new Set();
      this.state = 'ready';
      this.closed = false;
      this.userHandles=new Map();this.userSynchronizers=new Map();
      this.stats = { receivedPcmBytes:0, peakQueueSeconds:0, interruptions:0, firstAudioReceivedMs:null, firstAudibleEstimateMs:null };
    }
    log(type, detail = {}) {
      const event={ type, atMs: this.now(), generation: this.generation, ...detail };
      this.events.push(event);
      if (this.events.length > this.config.maxEvents) this.events.shift();
      try { this.observeLog(event); } catch { /* Measurement must not break playback. */ }
    }
    transition(state) {
      if (state === this.state) return;
      this.state = state;
      this.notify({ state, timing: 'approximate' });
    }
    setOutput(output){
      if(this.ranges.length)throw Error('Attach audio output before playback begins.');
      this.output=output;output.flush(this.generation);
    }
    audibleTime() {
      if (this.context.state !== 'running') return this.lastAudibleTime ?? this.context.currentTime;
      const stamp = this.context.getOutputTimestamp?.();
      const time = stamp?.contextTime > 0 ? stamp.contextTime
        : this.context.currentTime - ((this.context.outputLatency || 0)+(this.context.baseLatency || 0));
      this.lastAudibleTime = Math.max(0, time);
      return this.lastAudibleTime;
    }
    queueSeconds() {
      return Math.max(0, (this.ranges.at(-1)?.end || 0) - this.audibleTime());
    }
    newSegment(id, boundary) {
      if (this.segments.size >= this.config.maxSegments) {
        const removable = [...this.segments.values()].find(segment =>
          segment !== this.segment && !this.ranges.some(range => range.segment === segment) &&
          ![...this.actions.values()].some(action => action.segment === segment && ['prepared','started'].includes(action.status)));
        if (!removable) throw Error('Too many pending teaching segments.');
        this.segments.delete(removable.id);
      }
      const segment = { id, generation: this.generation, boundary, rate: null, samples: 0,
        played: 0, actionSeconds: 0, ended: false };
      this.segments.set(id, segment);
      return segment;
    }
    openSegment(id) {
      const prefix = 'g' + this.generation + ':';
      if(typeof id==='string'&&id.startsWith(prefix))id=id.slice(prefix.length);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw Error('Use a short alphanumeric segmentId.');
      const key = 'g' + this.generation + ':' + id;
      // A burst of calls before any audio has no defensible per-clause boundary.
      // Keep its ordered actions in one explicitly ambiguous playback batch.
      if (this.segment && !this.segment.samples && !this.segment.ended &&
        [...this.actions.values()].some(action=>action.segment===this.segment && action.status==='prepared')) {
        if(this.segment.id!==key)this.segment.boundary='ambiguous_tool_batch';
        return this.segment;
      }
      let segment = this.segments.get(key);
      if (segment && segment !== this.segment) throw Error('That segment has already passed. Use a new segmentId.');
      if (!segment) segment = this.newSegment(key, 'tool_boundary_estimate');
      if (segment.ended) throw Error('That segment has ended. Use a new segmentId.');
      if(this.segment && this.segment!==segment && this.segment.samples)this.sealSegment(this.segment);
      this.segment = segment;
      return segment;
    }
    result(action) {
      return { generationId: 'g' + action.generation, segmentId: action.segment.id,
        actionId: action.id, targetId: action.handle.targetId, status: action.status,
        anchor: action.anchor,
        progress: Math.round(action.progress * 1000) / 1000,
        timing: { source: action.timingSource, confidence: 'approximate',
          startSample: action.segment.rate ? Math.round(action.offset * action.segment.rate) : null,
          endSample: action.segment.rate ? Math.round((action.offset + action.duration) * action.segment.rate) : null },
        ...(action.reason ? { reason: action.reason } : {}) };
    }
    prepare(segment, input, compile) {
      if (this.closed || segment.generation !== this.generation) throw Error('Cancelled generation.');
      if(!input||typeof input!=='object')throw Error('Supply a board action object.');
      const prefix = 'g' + this.generation + ':';
      if(typeof input.actionId==='string'&&input.actionId.startsWith(prefix))input={...input,actionId:input.actionId.slice(prefix.length)};
      if (typeof input.actionId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.actionId)) throw Error('Use a short actionId.');
      const id = 'g' + this.generation + ':' + input.actionId;
      const fingerprint = JSON.stringify(input);
      const duplicate = this.actions.get(id);
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint) throw Error('Duplicate actionId has different content.');
        return this.result(duplicate);
      }
      if ([...this.actions.values()].filter(action => ['prepared','started'].includes(action.status)).length >= this.config.maxActions) {
        throw Error('Too many prepared actions.');
      }
      if (this.actions.size >= this.config.maxResults) {
        const old = [...this.actions.entries()].find(([,action]) => action.generation !== this.generation);
        if (!old) throw Error('Action history limit reached.');
        this.actions.delete(old[0]);
      }
      const geometry = compile(input, 'g' + this.generation);
      const supplied=typeof root.InkUserPlaybackSynchronizer==='function'&&typeof requestAnimationFrame==='function';
      const handle=supplied?{targetId:geometry.targetId,duration:geometry.duration,
        available:()=>geometry.available?geometry.available():true,render(){},
        cancel:progress=>{geometry.cancel(progress);this.userHandles.delete(id);}}:geometry;
      const fixed=input.onsetOffsetMs!==undefined||input.durationMs!==undefined;
      if(fixed&&(!Number.isFinite(input.onsetOffsetMs)||input.onsetOffsetMs<0||input.onsetOffsetMs>60000||!Number.isFinite(input.durationMs)||input.durationMs<16||input.durationMs>60000)){
        handle.cancel(0);throw Error('Invalid scheduled stroke timing.');
      }
      const action = { id, generation: this.generation, segment, fingerprint, handle, status: 'prepared',
        progress: 0, baseProgress:0, nominalDuration:Math.max(0.3,handle.duration),
        duration: fixed?input.durationMs/1000:Math.max(0.3, handle.duration), offset: fixed?input.onsetOffsetMs/1000:segment.actionSeconds,fixedTiming:fixed,
        anchor: input.anchor || null,
        // Do not expire a future unit while earlier scheduled speech is still playing.
        preparedAt: this.now() + this.queueSeconds() * 1000,
        timingSource: fixed?'specified_onset':segment.samples ? 'approximate_late_tool' : 'unresolved' };
      if (segment.played / (segment.rate || 1) > action.offset + this.config.lateToleranceMs / 1000) {
        handle.cancel(0);
        action.status = 'cancelled';
        action.reason = 'late_action_not_replayed';
      }
      segment.actionSeconds = Math.max(segment.actionSeconds,action.offset+action.duration);
      this.actions.set(id, action);
      if(supplied&&action.status==='prepared')this.userHandles.set(id,geometry);
      if(action.status==='prepared')this.transition('ready');
      this.log('path_ready', { actionId: id, status: action.status });
      return this.result(action);
    }
    enqueue(bytes, rate, generation = this.generation) {
      if (this.closed || generation !== this.generation) return false;
      if (this.context.state === 'closed') throw Error('Audio output is closed.');
      if (!(bytes instanceof Uint8Array) || bytes.length % 2 || !bytes.length || !Number.isInteger(rate) || rate < 8000 || rate > 96000) {
        throw Error('Expected mono PCM16 audio with a valid service sample rate.');
      }
      const duration = bytes.length / 2 / rate;
      if (duration > 3 || this.ranges.length >= 800 || this.sources.size >= 800 || this.queueSeconds() + duration > this.config.maxQueueSeconds) throw Error('Audio queue limit reached. End class and reconnect.');
      if (!this.segment || this.segment.ended) this.segment = this.newSegment('g' + this.generation + ':audio_' + (++this.sequence), 'unresolved');
      const segment = this.segment;
      if (segment.rate && segment.rate !== rate) throw Error('Audio rate changed inside a teaching segment.');
      segment.rate = rate;
      this.stats.receivedPcmBytes += bytes.length;
      this.stats.firstAudioReceivedMs ??= this.now();
      this.log('audio_received', { segmentId: segment.id, samples: bytes.length / 2, queueSeconds: this.queueSeconds() });
      const count=bytes.length/2;
      const previousEnd = this.ranges.at(-1)?.end || 0;
      const start = Math.max(previousEnd, this.context.currentTime + (previousEnd > this.context.currentTime ? 0 : this.config.lookaheadMs / 1000));
      const range = { start, end: start + duration, from: segment.samples, to: segment.samples + count,
        epochFromSample:this.epochSamples, epochToSample:this.epochSamples+count, segment, heard: false };
      segment.samples += count;
      segment.firstAudioStart ??=start;
      segment.lastAudioEnd=range.end;
      this.epochSamples += count;
      this.ranges.push(range);
      this.stats.peakQueueSeconds = Math.max(this.stats.peakQueueSeconds, this.queueSeconds());
      let source;
      if(this.output){
        source=this.output.enqueue(bytes,rate,start,event=>{
          if(generation!==this.generation)return;
          range.start=event.startContextTime;range.end=event.endContextTime;
          segment.lastAudioEnd=Math.max(segment.lastAudioEnd,range.end);
          this.log('worklet_chunk_started',{segmentId:segment.id,startContextTime:range.start,endContextTime:range.end});
        },()=>this.sources.delete(source));
      }else{
        const buffer=this.context.createBuffer(1,count,rate),samples=buffer.getChannelData(0);
        const pcm=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        for(let i=0;i<count;i++)samples[i]=pcm.getInt16(i*2,true)/32768;
        source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);
        source.onended=()=>{source.disconnect();source.buffer=null;this.sources.delete(source);};source.start(start);
      }
      this.sources.add(source);
      this.transition('ready');
      this.log('audio_scheduled', { segmentId: segment.id, startContextTime: start, fromSample: range.from, toSample: range.to,
        epochFromSample:range.epochFromSample,epochToSample:range.epochToSample,rate });
      return true;
    }
    tick() {
      if (this.closed || this.context.state !== 'running') return;
      // Calibration changes visuals only. It can delay the pen, never lead audio.
      const time = Math.max(0,this.audibleTime()-this.visualDelayMs/1000);
      let playing = false;
      for (const range of this.ranges) {
        if (time < range.start) break;
        if (!range.heard) {
          range.heard = true;
          if (!range.segment.heard) {
            range.segment.heard = true;
            this.stats.firstAudibleEstimateMs ??= this.now();
            this.log('first_audible_estimate', { segmentId: range.segment.id });
          }
        }
        const elapsed = Math.min(range.end - range.start, Math.max(0, time - range.start));
        range.segment.played = Math.max(range.segment.played, time>=range.end?range.to:range.from + elapsed * range.segment.rate);
        if (time < range.end) playing = true;
      }
      for (const action of [...this.actions.values()].sort((a,b)=>(a.segment.firstAudioStart||0)-(b.segment.firstAudioStart||0)||a.offset-b.offset)) {
        if (action.generation !== this.generation || !['prepared','started'].includes(action.status)) continue;
        if(action.handle.available && !action.handle.available()) {
          this.cancel(action,'target_removed');
          continue;
        }
        const segment = action.segment;
        if (!segment.samples && this.now() - action.preparedAt > this.config.maxPreparedMs) {
          this.cancel(action, 'no_associated_audio');
          continue;
        }
        const seconds = segment.played / (segment.rate || 1);
        if (seconds <= action.offset) continue;
        if(!action.fixedTiming&&action.timingSource!=='fitted_playback_window')action.timingSource = segment.boundary === 'tool_boundary_estimate' ? 'approximate_tool_boundary' : 'approximate_unresolved_boundary';
        const fraction = seconds>=action.offset+action.duration-1e-9?1:
          Math.min(1, action.baseProgress + (1-action.baseProgress)*(seconds - action.offset) / action.duration);
        if (action.status === 'prepared') {
          action.status = 'started';
          this.log('stroke_start', { actionId: action.id,segmentId:segment.id,playedSample:segment.played,
            visualContextTime:time,audioStartContextTime:segment.firstAudioStart,audioEndContextTime:segment.lastAudioEnd });
        }
        action.progress = Math.max(action.progress, fraction);
        action.handle.render(action.progress);
        if (fraction === 1) {
          action.status = 'completed';
          action.handle = { targetId:action.handle.targetId };
          this.log('stroke_end', { actionId: action.id,segmentId:segment.id,playedSample:segment.played,
            visualContextTime:time,audioEndContextTime:segment.lastAudioEnd });
          this.notify({ action: this.result(action) });
        } else if (segment.ended && seconds >= segment.samples / segment.rate) {
          this.cancel(action, 'audio_ended_before_writing_finished');
        }
      }
      this.ranges = this.ranges.filter(range => time < range.end);
      this.renderSuppliedStrokes();
      const pending = [...this.actions.values()].some(action => ['prepared','started'].includes(action.status));
      if(this.state==='interrupted'&&!pending&&!this.ranges.length)return;
      this.transition(playing ? 'playing' : (pending || this.ranges.length) ? 'stalled' : 'completed');
    }
    endTurn() {
      for (const segment of this.segments.values()) {
        if (segment.generation === this.generation && segment.samples > 0) this.sealSegment(segment);
      }
      // Tool-only turnComplete events can precede the speech answering that tool.
      for (const action of this.actions.values()) {
        if (action.generation === this.generation && action.segment.ended && action.segment.played >= action.segment.samples && action.progress < 1 && ['prepared','started'].includes(action.status)) {
          this.cancel(action, 'audio_ended_before_writing_finished');
        }
      }
    }
    renderSuppliedStrokes(){
      if(!this.userHandles.size)return;
      const groups=new Map();
      for(const [id,handle] of this.userHandles){
        const action=this.actions.get(id);
        if(!action||action.status==='cancelled'){this.userHandles.delete(id);continue;}
        if(!groups.has(action.segment))groups.set(action.segment,[]);
        groups.get(action.segment).push(action);
      }
      for(const [segment,actions] of groups){
        let synchronizer=this.userSynchronizers.get(segment);
        if(!synchronizer){
          // This clock is already hardware-compensated and excludes underrun silence.
          const context={get currentTime(){return segment.played/(segment.rate||24000);},outputLatency:0,baseLatency:0};
          synchronizer=new root.InkUserPlaybackSynchronizer(context,{
            onRenderStrokePoint:(id,progress)=>{
              const action=this.actions.get(id),geometry=this.userHandles.get(id);
              if(action&&geometry&&progress>0)geometry.render(Math.max(action.baseProgress,action.baseProgress+(1-action.baseProgress)*progress));
            },onStrokeComplete:id=>this.userHandles.delete(id),
          });
          synchronizer.playbackEpochTime=0;this.userSynchronizers.set(segment,synchronizer);
        }
        // Refresh keyframes when a streamed speech window is fitted; preserve ink.
        synchronizer.strokeQueue=[];synchronizer.activeStrokes=[];synchronizer.isRunning=true;
        for(const action of actions){
          synchronizer.enqueueStroke({id:action.id,points:[{x:0,y:0},{x:1,y:1}],onsetSeconds:action.offset,durationSeconds:action.duration});
          // The app also supports valid fitted windows shorter than its 50 ms default.
          synchronizer.strokeQueue.find(stroke=>stroke.id===action.id).durationSeconds=Math.max(1e-9,action.duration);
        }
        synchronizer.loop();
        // The app owns one render loop; don't leave a second RAF loop running.
        if(synchronizer.animFrameId!==null)cancelAnimationFrame(synchronizer.animFrameId);
        synchronizer.animFrameId=null;
      }
      for(const [segment,synchronizer] of this.userSynchronizers)if(!groups.has(segment)||!actionsFor(this,segment)){
        synchronizer.handleInterruption();this.userSynchronizers.delete(segment);
      }
      function actionsFor(controller,segment){return [...controller.userHandles.keys()].some(id=>controller.actions.get(id)?.segment===segment);}
    }
    sealSegment(segment) {
      if(segment.ended||!segment.samples)return;
      // Update from the heard clock before replanning: never rewind or snap ink.
      this.tick();
      segment.ended=true;
      const pending=[...this.actions.values()].filter(action=>action.segment===segment&&!action.fixedTiming&&['prepared','started'].includes(action.status));
      const remaining=(segment.samples-segment.played)/segment.rate;
      const weight=pending.reduce((sum,action)=>sum+action.nominalDuration*(1-action.progress),0);
      if(!pending.length||remaining<=0||weight<=0)return;
      let offset=segment.played/segment.rate;
      for(const action of pending) {
        action.baseProgress=action.progress;
        action.offset=offset;
        action.duration=remaining*action.nominalDuration*(1-action.progress)/weight;
        offset+=action.duration;
        action.timingSource='fitted_playback_window';
      }
      // Use the exact last audio sample as the deadline (avoid rounding drift).
      const last=pending.at(-1);
      last.duration=segment.samples/segment.rate-last.offset;
      this.log('writing_fitted',{segmentId:segment.id,remainingSeconds:remaining,actions:pending.length,playedSample:segment.played,endSample:segment.samples});
    }
    generationComplete() {
      // Native generation finishes ahead of playback; use that budget immediately.
      for(const segment of this.segments.values())if(segment.generation===this.generation)this.sealSegment(segment);
    }
    cancel(action, reason) {
      if (!['prepared','started'].includes(action.status)) return;
      action.status = 'cancelled'; action.reason = reason;
      action.handle.cancel(action.progress);
      action.handle = { targetId:action.handle.targetId };
      this.log('action_cancelled', { actionId: action.id, progress: action.progress, reason });
      this.notify({ action: this.result(action) });
    }
    cancelActions(ids) {
      for (const action of this.actions.values()) if (ids.includes(action.id)) this.cancel(action, 'tool_cancelled');
    }
    interrupt(reason = 'interrupted') {
      const detected = this.now();
      this.tick();
      for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); source.buffer = null; }
      this.sources.clear(); this.ranges.length = 0;
      for (const action of this.actions.values()) this.cancel(action, reason);
      for(const synchronizer of this.userSynchronizers.values())synchronizer.handleInterruption();
      this.userSynchronizers.clear();this.userHandles.clear();
      this.log('interruption', { reason, localFreezeMs: this.now() - detected });
      this.stats.interruptions++;
      this.generation = ++generationCounter;
      this.output?.flush(this.generation);
      this.epochSamples = 0;
      this.segment = null; this.segments.clear();
      this.transition('interrupted');
    }
    diagnostics() {
      return { state: this.state, generationId: 'g' + this.generation, timing: 'approximate',
        config: {...this.config,visualDelayMs:this.visualDelayMs},strokeDriver:root.InkUserPlaybackSynchronizer?'supplied_playback_synchronizer':'controller', output:this.output?'audio_worklet':'source_adapter',workletClock:this.output?.clock||null,stats:{...this.stats}, queueSeconds: this.queueSeconds(), sources: this.sources.size,
        segments: this.segments.size, actionCount: this.actions.size, events: [...this.events],
        actions: [...this.actions.values()].map(action => this.result(action)) };
    }
    heardPosition() {
      const time=this.audibleTime();
      const range=this.ranges.find(item=>time>=item.start&&time<item.end);
      return range ? {sample:range.epochFromSample+(time-range.start)*range.segment.rate,
        rate:range.segment.rate,epoch:this.generation,contextTime:time} : null;
    }
    close() { this.interrupt('class_ended'); this.closed = true; }
  }
  root.InkSync = { Controller, defaults };
})(globalThis);
