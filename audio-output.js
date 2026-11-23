/* Worklet transport: PCM bytes in, generation-scoped sample/clock observations out. */
(function(root){
  class Output{
    static async create(context){
      if(!context.audioWorklet)throw Error('This browser needs AudioWorklet support for live playback.');
      await context.audioWorklet.addModule('audio-playback-worklet.js?v=1');
      return new Output(context,new AudioWorkletNode(context,'ink-pcm-playback',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]}));
    }
    constructor(context,node){
      this.context=context;this.node=node;this.epoch=0;this.sequence=0;this.pending=new Map();
      node.connect(context.destination);
      node.port.onmessage=({data:m})=>{
        if(m.epoch!==this.epoch)return;
        const entry=this.pending.get(m.id);
        if(m.type==='STARTED')entry?.onStarted?.(m);
        if(m.type==='ENDED'){this.pending.delete(m.id);entry?.onEnded?.();}
        if(m.type==='AUDIO_CLOCK_TICK')this.clock=m;
        if(m.type==='ERROR')this.onError?.(new Error(m.message));
      };
    }
    flush(epoch){
      this.epoch=epoch;this.pending.clear();this.clock=null;
      this.node.port.postMessage({type:'FLUSH',epoch});
    }
    enqueue(bytes,rate,start,onStarted,onEnded){
      const id=++this.sequence,buffer=bytes.slice().buffer;
      this.pending.set(id,{onStarted,onEnded});
      this.node.port.postMessage({type:'PUSH_PCM_CHUNK',epoch:this.epoch,id,rate,startFrame:Math.round(start*this.context.sampleRate),bytes:buffer},[buffer]);
      return {stop:()=>this.node.port.postMessage({type:'CANCEL',epoch:this.epoch,id}),disconnect(){},buffer:null};
    }
    close(){this.flush(this.epoch+1);this.node.port.onmessage=null;this.node.disconnect();}
  }
  root.InkAudio={Output};
})(globalThis);
