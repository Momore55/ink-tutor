/* PCM playback stays on the audio rendering thread. No DOM, timers or network. */
class InkPlaybackProcessor extends AudioWorkletProcessor {
  constructor(){
    super();this.queue=[];this.head=0;this.epoch=0;this.queuedSeconds=0;this.processed=0;this.lastTick=0;
    this.port.onmessage=({data:m})=>{
      if(m.type==='FLUSH'){
        this.queue=[];this.head=0;this.queuedSeconds=0;this.epoch=m.epoch;this.processed=0;
        this.port.postMessage({type:'FLUSHED',epoch:this.epoch,contextFrame:currentFrame});return;
      }
      if(m.epoch!==this.epoch)return;
      if(m.type==='CANCEL'){const entry=this.queue.find(e=>e.id===m.id);if(entry)entry.cancelled=true;return;}
      if(m.type!=='PUSH_PCM_CHUNK')return;
      const bytes=m.bytes;
      if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength%2||!Number.isFinite(m.rate)||m.rate<8000||m.rate>96000||!Number.isFinite(m.startFrame)||this.queue.length-this.head>=800){
        this.port.postMessage({type:'ERROR',epoch:this.epoch,message:'Invalid or excessive playback data.'});return;
      }
      const seconds=bytes.byteLength/2/m.rate;
      if(seconds>3||this.queuedSeconds+seconds>60.1){this.port.postMessage({type:'ERROR',epoch:this.epoch,message:'Playback queue limit reached.'});return;}
      this.queue.push({id:m.id,pcm:new Int16Array(bytes),rate:m.rate,startFrame:Math.round(m.startFrame),seconds,started:false});
      this.queuedSeconds+=seconds;
    };
  }
  process(inputs,outputs){
    const channel=outputs[0]?.[0];if(!channel)return true;
    channel.fill(0);
    for(let i=0;i<channel.length;i++){
      const frame=currentFrame+i;
      while(this.head<this.queue.length){
        const entry=this.queue[this.head];
        if(entry.cancelled){this.finish(entry);continue;}
        if(frame<entry.startFrame)break;
        if(!entry.started){
          entry.started=true;entry.actualStart=frame;
          entry.endFrame=frame+Math.max(1,Math.round(entry.seconds*sampleRate));
          this.port.postMessage({type:'STARTED',epoch:this.epoch,id:entry.id,startContextTime:frame/sampleRate,endContextTime:entry.endFrame/sampleRate});
        }
        if(frame>=entry.endFrame){this.finish(entry);continue;}
        // Native 24 kHz is exact. Other declared rates are resampled to this graph.
        const position=(frame-entry.actualStart)*entry.rate/sampleRate;
        const index=Math.min(entry.pcm.length-1,Math.floor(position)),fraction=position-index;
        const left=entry.pcm[index],right=entry.pcm[Math.min(index+1,entry.pcm.length-1)];
        channel[i]=(left+(right-left)*fraction)/32768;this.processed++;break;
      }
    }
    if(currentFrame-this.lastTick>=Math.max(128,Math.round(sampleRate*.05))){
      this.lastTick=currentFrame;
      this.port.postMessage({type:'AUDIO_CLOCK_TICK',epoch:this.epoch,contextFrame:currentFrame+channel.length,
        samplesProcessed:this.processed,sampleRate,queuedSeconds:Math.max(0,this.queuedSeconds)});
    }
    return true;
  }
  finish(entry){
    this.queuedSeconds=Math.max(0,this.queuedSeconds-entry.seconds);entry.pcm=null;this.head++;
    this.port.postMessage({type:'ENDED',epoch:this.epoch,id:entry.id});
    if(this.head>=64){this.queue=this.queue.slice(this.head);this.head=0;}
  }
}
registerProcessor('ink-pcm-playback',InkPlaybackProcessor);
