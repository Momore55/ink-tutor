/* Opt-in Phase 0 measurement. No microphone audio is retained. */
(function (root) {
  class Probe {
    constructor(options = {}) {
      this.enabled = Boolean(options.enabled);
      this.captureText = Boolean(options.captureText);
      this.captureAudio = Boolean(options.captureAudio);
      this.maxEvents = 6000;
      this.maxAudioBytes = 6 * 1024 * 1024;
      this.events = [];
      this.audio = [];
      this.audioBytes = 0;
      this.truncatedEvents = 0;
      this.audioTruncated = false;
      this.startedAt = performance.now();
      this.environment = { browser:navigator.userAgent, outputType:options.outputType || 'unknown' };
      this.settings = { toolScheduling:options.toolScheduling || 'WHEN_IDLE',
        wordTimestamps:Boolean(options.wordTimestamps), lookaheadMs:options.lookaheadMs ?? 250,
        reconciliationChannel:options.reconciliationChannel || 'clientContent',
        speechConfirmMs:options.speechConfirmMs ?? 150 };
    }
    record(type, detail = {}) {
      if (!this.enabled) return;
      if (this.events.length >= this.maxEvents) {
        this.events.shift();
        this.truncatedEvents++;
      }
      this.events.push({ type, receivedAtMs:performance.now(), ...detail });
    }
    observe(event, sync) {
      if (!this.enabled) return;
      const detail = { receivedAtMs:event.receivedAtMs, epoch:event.epoch, messageId:event.messageId, streamSample:event.streamSample,
        sampleRate:event.sampleRate, coDelivered:event.coDelivered, fields:event.fields,
        contextTime:sync.context.currentTime, queueSeconds:sync.queueSeconds(), heard:sync.heardPosition() };
      if (event.kind === 'audio') {
        Object.assign(detail, { samples:event.bytes.length / 2, rate:event.rate,
          outputLatency:sync.context.outputLatency ?? null, baseLatency:sync.context.baseLatency ?? null,
          outputTimestamp:sync.context.getOutputTimestamp?.() || null });
        if (this.captureAudio && !this.audioTruncated) {
          if (this.audioBytes + event.bytes.length <= this.maxAudioBytes) {
            this.audio.push({ epoch:event.epoch, rate:event.rate, fromSample:event.streamSample, bytes:event.bytes.slice() });
            this.audioBytes += event.bytes.length;
          } else this.audioTruncated = true;
        }
      }
      if (event.kind === 'output_text' || event.kind === 'input_text') {
        Object.assign(detail, { characters:event.text.length, words:event.text.trim().split(/\s+/).length,
          startOffset:event.startOffset ?? null, endOffset:event.endOffset ?? null,
          ...(this.captureText ? { text:event.text } : {}) });
      }
      if (event.kind === 'tool') {
        detail.name = event.call.name;
        detail.callId = event.call.id;
        if (this.captureText) detail.arguments = event.call.args;
      }
      if (event.kind === 'error') detail.error = event.message;
      if (event.kind === 'go_away') detail.timeLeft = event.timeLeft;
      if (event.kind === 'resumption') {
        detail.resumable = event.resumable;
        detail.hasHandle = event.hasHandle;
      }
      this.record(event.kind, detail);
    }
    sample(sync) {
      if(!this.enabled||performance.now()-(this.lastSampleAt||0)<100)return;
      this.lastSampleAt=performance.now();
      this.record('clock',{epoch:sync.generation,contextState:sync.context.state,
        contextTime:sync.context.currentTime,outputTimestamp:sync.context.getOutputTimestamp?.()||null,
        outputLatency:sync.context.outputLatency??null,baseLatency:sync.context.baseLatency??null,
        heard:sync.heardPosition(),queueSeconds:sync.queueSeconds()});
    }
    report(sync, scene) {
      const diagnostics=sync.diagnostics();
      if(!this.captureText)diagnostics.actions=diagnostics.actions.map(action=>({
        ...action,anchor:action.anchor?{characters:action.anchor.phrase.length,occurrence:action.anchor.occurrence}:null,
      }));
      return { schemaVersion:1, collectedAt:new Date().toISOString(), environment:this.environment,
        settings:this.settings, elapsedMs:performance.now()-this.startedAt,
        capture:{transcriptText:this.captureText,generatedAudio:this.captureAudio,microphoneAudio:false,
          outputAudioBytes:this.audioBytes,audioTruncated:this.audioTruncated,truncatedEvents:this.truncatedEvents},
        timing:'unvalidated; arrival/sample positions are observations, not word alignment',
        events:[...this.events], diagnostics,
        ...(this.captureAudio ? {audioManifest:this.audio.map(chunk=>({epoch:chunk.epoch,rate:chunk.rate,fromSample:chunk.fromSample,samples:chunk.bytes.length/2}))} : {}),
        ...(this.captureText ? { board:scene.snapshot() } : {}) };
    }
    wavBase64(epoch) {
      const chunks=this.audio.filter(chunk=>epoch===undefined||chunk.epoch===epoch);
      if(!chunks.length)return null;
      const rate=chunks[0].rate;
      if(chunks.some(chunk=>chunk.rate!==rate))throw Error('Export each sample rate separately.');
      const size=chunks.reduce((sum,chunk)=>sum+chunk.bytes.length,0);
      const buffer=new ArrayBuffer(44+size),view=new DataView(buffer);
      const label=(offset,text)=>Array.from(text).forEach((char,i)=>view.setUint8(offset+i,char.charCodeAt(0)));
      label(0,'RIFF');view.setUint32(4,36+size,true);label(8,'WAVE');label(12,'fmt ');
      view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
      view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
      label(36,'data');view.setUint32(40,size,true);
      let offset=44;
      for(const chunk of chunks){new Uint8Array(buffer,offset,chunk.bytes.length).set(chunk.bytes);offset+=chunk.bytes.length;}
      let binary='';
      for(const byte of new Uint8Array(buffer))binary+=String.fromCharCode(byte);
      return btoa(binary);
    }
  }
  root.InkPhase0 = { Probe };
})(globalThis);
