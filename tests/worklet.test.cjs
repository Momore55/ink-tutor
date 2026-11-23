const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
require('../stroke-protocol.js');require('../playback-sync.js');
function fixture(rate=24000){
 const messages=[];let Processor;
 const sandbox={sampleRate:rate,currentFrame:0,ArrayBuffer,Int16Array,Float32Array,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(name,cls)=>Processor=cls};
 vm.runInNewContext(fs.readFileSync(require.resolve('../audio-playback-worklet.js'),'utf8'),sandbox);
 const processor=new Processor();
 const send=m=>processor.port.onmessage({data:m});send({type:'FLUSH',epoch:1});
 return {processor,messages,send,push(id,count,value=16384,startFrame=0,sourceRate=24000){const pcm=new Int16Array(count).fill(value);send({type:'PUSH_PCM_CHUNK',epoch:1,id,bytes:pcm.buffer,rate:sourceRate,startFrame});},
 block(){const output=new Float32Array(128);processor.process([],[[output]]);sandbox.currentFrame+=128;return output;},get frame(){return sandbox.currentFrame;}};
}
test('worklet plays scheduled PCM exactly and zero-fills underruns',()=>{
 const f=fixture();f.push('a',240);f.push('b',240);
 const values=Array.from({length:4},()=>[...f.block()]).flat();
 assert(values.slice(0,480).every(value=>value===.5));assert(values.slice(480).every(value=>value===0));
 assert.equal(f.processor.processed,480);
 for(let i=0;i<20;i++)f.block();assert.equal(f.processor.processed,480);
 assert.equal(f.messages.filter(m=>m.type==='STARTED').length,2);
});
test('worklet resamples source PCM to the actual graph rate',()=>{
 const f=fixture(48000);f.push('a',240);
 const values=Array.from({length:4},()=>[...f.block()]).flat();
 assert(values.slice(0,480).every(value=>value===.5));assert.equal(f.processor.processed,480);
});
test('worklet waits for the requested sample-frame onset',()=>{
 const f=fixture();f.push('a',128,16384,256);
 assert(f.block().every(value=>value===0));assert(f.block().every(value=>value===0));assert(f.block().every(value=>value===.5));
 assert.equal(f.messages.find(m=>m.type==='STARTED').startContextTime,256/24000);
});
test('flush drops queued audio and rejects late chunks from the previous epoch',()=>{
 const f=fixture();f.push('a',500);f.block();f.send({type:'FLUSH',epoch:2});f.push('stale',128);
 assert(f.block().every(value=>value===0));assert.equal(f.processor.processed,0);assert.equal(f.processor.queue.length,0);
});
test('worklet clock messages are bounded rather than posted every audio block',()=>{
 const f=fixture();for(let i=0;i<100;i++)f.block();
 assert(f.messages.filter(m=>m.type==='AUDIO_CLOCK_TICK').length<=11);
});
test('stroke serialization validates generic trajectories and explicit onset metadata',()=>{
 const stroke=InkStroke.parse('FREEDRAW | 1450 | 120,340 | 125,335 | 150,320',{id:'curve',durationMs:800});
 const action=InkStroke.action(stroke);assert.equal(action.kind,'freedraw');assert.equal(action.onsetOffsetMs,1450);assert.equal(action.points.length,3);
 assert.throws(()=>InkStroke.parse('FREEDRAW | 0 | 1,2 | 3,4',{id:'bad',durationMs:900}),/outside/);
 assert.throws(()=>InkStroke.validate({...stroke,color:'url(https://example.com)'}),/appearance/);
});
test('explicitly timed actions remain hidden until their audio sample onset',()=>{
 const ctx={currentTime:0,state:'running',destination:{},createBuffer:(c,n,r)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource:()=>({connect(){},start(){},stop(){},disconnect(){}})};
 const controller=new InkSync.Controller(ctx);const handle={targetId:'vector',duration:2,progress:0,render(p){this.progress=p;},cancel(){}};
 const segment=controller.openSegment('timed');controller.prepare(segment,{actionId:'vector',onsetOffsetMs:500,durationMs:500},()=>handle);
 controller.enqueue(new Uint8Array(24000*2),24000);controller.generationComplete();
 ctx.currentTime=.7;controller.tick();assert.equal(handle.progress,0);
 ctx.currentTime=1;controller.tick();assert.equal(handle.progress,.5);
 ctx.currentTime=1.25;controller.tick();assert.equal(handle.progress,1);
});
test('output timestamps are not double compensated by hardware latency',()=>{
 const controller=new InkSync.Controller({state:'running',currentTime:2,outputLatency:.18,baseLatency:.02,getOutputTimestamp:()=>({contextTime:1.8})});
 assert.equal(controller.audibleTime(),1.8);
 delete controller.context.getOutputTimestamp;assert.equal(controller.audibleTime(),1.8);
});
