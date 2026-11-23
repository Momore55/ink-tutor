const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../playback-sync.js');
require('../gemini-adapter.js');
function fixture(config={}) {
  const context={currentTime:0,state:'running',destination:{},
    createBuffer(channels,count,rate){return{duration:count/rate,getChannelData:()=>new Float32Array(count)};},
    createBufferSource(){return{connect(){},start(){},stop(){},disconnect(){}};}};
  let now=0;
  const controller=new InkSync.Controller(context,{config,now:()=>now});
  const geometry={progress:0,cancelled:false,targetId:'g1:eq',duration:1,
    render(f){this.progress=f;},cancel(f){this.cancelled=true;this.progress=f;}};
  const prepare=(segment='unit',id='action')=>controller.prepare(controller.openSegment(segment),{actionId:id,kind:'write_math',targetId:'eq',content:'x + 2 = 5'},()=>geometry);
  return {context,controller,geometry,prepare,advance(time){context.currentTime=time;now=time*1000;controller.tick();}};
}
const audio=seconds=>new Uint8Array(Math.round(24000*seconds)*2);

test('prepared geometry stays hidden until audible playback, then overlaps it',()=>{
 const f=fixture();f.prepare();f.controller.enqueue(audio(1),24000);
 f.advance(.2);assert.equal(f.geometry.progress,0);
 f.advance(.75);assert.equal(f.geometry.progress,.5);assert.equal(f.controller.state,'playing');
 f.advance(1.25);assert.equal(f.geometry.progress,1);assert.equal(f.controller.state,'completed');
});
test('underrun freezes progress despite a running AudioContext',()=>{
 const f=fixture();f.prepare();f.controller.enqueue(audio(.2),24000);f.advance(.45);
 const before=f.geometry.progress;f.advance(5);assert.equal(f.geometry.progress,before);assert.equal(f.controller.state,'stalled');
 f.controller.enqueue(audio(.3),24000);f.advance(5.4);assert(f.geometry.progress>before);
});
test('pause/resume freezes relative playback',()=>{
 const f=fixture();f.prepare();f.controller.enqueue(audio(1),24000);f.advance(.5);
 f.context.state='suspended';f.controller.tick();assert.equal(f.geometry.progress,.25);
 f.context.state='running';f.advance(.75);assert.equal(f.geometry.progress,.5);
});
test('interruption preserves the partial symbol and rejects old-generation audio',()=>{
 const f=fixture();f.prepare();f.controller.enqueue(audio(1),24000);f.advance(.6);
 const oldGeneration=f.controller.generation;
 f.controller.interrupt();assert.equal(f.geometry.progress,.35);assert(f.geometry.cancelled);
 assert.equal(f.controller.enqueue(audio(1),24000,oldGeneration),false);assert.equal(f.controller.sources.size,0);
 f.advance(8);assert.equal(f.geometry.progress,.35);
 assert.equal(f.controller.events.find(e=>e.type==='interruption').localFreezeMs,0);
});
test('duplicate action is idempotent and altered duplicate is rejected',()=>{
 const f=fixture();f.prepare();f.prepare();assert.equal(f.controller.actions.size,1);
 assert.throws(()=>f.controller.prepare(f.controller.segment,{actionId:'action',kind:'write_math',content:'different'},()=>f.geometry),/different content/);
});
test('late action is cancelled rather than replayed against later speech',()=>{
 const f=fixture();f.controller.openSegment('unit');f.controller.enqueue(audio(1),24000);f.advance(1);
 const result=f.prepare();assert.equal(result.status,'cancelled');assert.equal(result.reason,'late_action_not_replayed');
});
test('no associated audio expires visibly without virtual-clock writing',()=>{
 const f=fixture({maxPreparedMs:500});f.prepare();f.advance(1);
 assert.equal(f.geometry.progress,0);assert.equal([...f.controller.actions.values()][0].reason,'no_associated_audio');
});
test('short speech fits the whole calculation before its playback ends',()=>{
 const f=fixture();f.prepare();f.controller.enqueue(audio(.2),24000);f.controller.endTurn();f.advance(1);
 assert.equal(f.geometry.progress,1);assert.equal([...f.controller.actions.values()][0].status,'completed');
});

test('generation end fits unfinished writing without a jump or changed audio schedule',()=>{
 const f=fixture();f.geometry.duration=3;f.prepare();f.controller.enqueue(audio(1),24000);f.advance(.65);
 const before=f.geometry.progress,start=f.controller.ranges[0].start,end=f.controller.ranges[0].end;
 f.controller.generationComplete();assert.equal(f.geometry.progress,before);
 assert.equal(f.controller.ranges[0].start,start);assert.equal(f.controller.ranges[0].end,end);
 f.advance(.95);assert(f.geometry.progress>before&&f.geometry.progress<1);
 f.advance(1.25);assert.equal(f.geometry.progress,1);
});

test('a batch fits sequentially into heard speech, never writes before playback',()=>{
 const f=fixture();const handles=[];const segment=f.controller.openSegment('batch');
 for(let i=0;i<3;i++){
  const handle={duration:2,targetId:'line'+i,progress:0,render(p){this.progress=p;},cancel(){}};
  handles.push(handle);f.controller.prepare(segment,{actionId:'line'+i},()=>handle);
 }
 f.controller.enqueue(audio(.9),24000);f.controller.generationComplete();
 f.advance(.24);assert(handles.every(h=>h.progress===0));
 f.advance(.4);assert(handles[0].progress>0&&handles[0].progress<1);assert.equal(handles[1].progress,0);
 f.advance(.7);assert.equal(handles[0].progress,1);assert(handles[1].progress>0);assert.equal(handles[2].progress,0);
 f.advance(1.15);assert(handles.every(h=>h.progress===1));
});

test('fitted writing still freezes at an underrun and cancels partial ink on interruption',()=>{
 const f=fixture();f.geometry.duration=3;f.prepare();f.controller.enqueue(audio(.2),24000);f.advance(.45);
 const progress=f.geometry.progress;f.advance(2);assert.equal(f.geometry.progress,progress);
 f.controller.enqueue(audio(.8),24000);f.controller.generationComplete();f.advance(2.5);
 const partial=f.geometry.progress;assert(partial>progress&&partial<1);
 f.controller.interrupt();f.advance(5);assert.equal(f.geometry.progress,partial);
});

test('visual calibration delays writing without changing the audio schedule',()=>{
 const f=fixture();f.controller.visualDelayMs=100;f.prepare();f.controller.enqueue(audio(1),24000);f.controller.generationComplete();
 assert.equal(f.controller.ranges[0].start,.25);
 f.advance(.3);assert.equal(f.geometry.progress,0);
 f.advance(.85);assert(Math.abs(f.geometry.progress-.5)<1e-6);
 f.advance(1.35);assert.equal(f.geometry.progress,1);
});
test('tool-only turnComplete does not end its following audio segment',()=>{
 const f=fixture();f.prepare();f.controller.endTurn();assert.equal(f.controller.segment.ended,false);
 f.controller.enqueue(audio(1),24000);f.advance(.75);assert.equal(f.geometry.progress,.5);
});
test('queue and action limits fail explicitly',()=>{
 const f=fixture({maxQueueSeconds:1,maxActions:1});f.prepare();
 assert.throws(()=>f.controller.enqueue(audio(2),24000),/queue limit/);
 assert.throws(()=>f.prepare('unit','second'),/Too many/);
});
test('tool cancellation preserves visible strokes',()=>{
 const f=fixture();const action=f.prepare();f.controller.enqueue(audio(1),24000);f.advance(.75);
 f.controller.cancelActions([action.actionId]);f.advance(1.1);assert.equal(f.geometry.progress,.5);
});
test('output latency shifts visual progress toward audible rather than scheduled time',()=>{
 const f=fixture();f.context.outputLatency=.1;f.prepare();f.controller.enqueue(audio(1),24000);
 f.advance(.8);assert(Math.abs(f.geometry.progress-.45)<1e-6);
});
test('adapter fences delayed outputs through the interrupted turn boundary',()=>{
 const a=new InkGemini.Adapter();
 const data=Buffer.from(audio(.1)).toString('base64');
 const stale={serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data}}]}}};
 a.normalize({serverContent:{interrupted:true}});assert.equal(a.normalize(stale).length,0);
 a.normalize({turnComplete:true});assert.equal(a.normalize(stale).length,0);
 a.normalize({serverContent:{turnComplete:true}});assert.equal(a.normalize(stale)[0].kind,'audio');
});
test('adapter preserves simultaneous audio/transcription and cancels tools',()=>{
 const a=new InkGemini.Adapter();
 a.normalize({toolCallCancellation:{ids:['old']}});
 const events=a.normalize({toolCall:{functionCalls:[{id:'old'},{id:'new'}]},serverContent:{outputTranscription:{text:'hello'},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=16000',data:'AAA='}}]},turnComplete:true}});
 assert.deepEqual(events.map(e=>e.kind),['tool','audio','output_text','turn_end']);assert.equal(events[1].rate,16000);
});
test('bounded controller metadata over a synthetic 30-minute session',()=>{
 const f=fixture();let time=0;
 for(let i=0;i<1800;i++) {
   f.prepare('unit','action');f.controller.enqueue(audio(.5),24000);f.advance(time+.8);
   f.controller.interrupt('next_test_turn');time++;f.advance(time);
 }
 assert(f.controller.events.length<=256);assert(f.controller.actions.size<=128);
 assert(f.controller.segments.size<=48);assert.equal(f.controller.ranges.length,0);assert.equal(f.controller.sources.size,0);
});

test('new sessions and interruptions allocate distinct generation IDs',()=>{
 const a=fixture(),b=fixture();assert.notEqual(a.controller.generation,b.controller.generation);
 const previous=a.controller.generation;a.controller.interrupt();assert.notEqual(a.controller.generation,previous);assert.notEqual(a.controller.generation,b.controller.generation);
});
test('pre-audio tool bursts share an explicitly unresolved batch',()=>{
 const f=fixture();f.prepare('first');f.prepare('second','other');
 assert.equal(f.controller.segments.size,1);assert.equal(f.controller.segment.boundary,'ambiguous_tool_batch');
});
test('duplicate IDs remain idempotent across declared segments',()=>{
 const f=fixture();const first=f.prepare('first');const second=f.prepare('second');
 assert.equal(first.actionId,second.actionId);assert.equal(f.controller.actions.size,1);
});
test('removed targets cancel dependent geometry without drawing',()=>{
 const f=fixture();f.geometry.available=()=>false;f.prepare();f.controller.enqueue(audio(1),24000);f.advance(.5);
 assert.equal([...f.controller.actions.values()][0].reason,'target_removed');assert.equal(f.geometry.progress,0);
});

test('future actions do not expire while earlier queued speech is playing',()=>{
 const f=fixture({maxPreparedMs:500});f.controller.openSegment('earlier');f.controller.enqueue(audio(2),24000);
 f.prepare('later');f.advance(1);assert.equal([...f.controller.actions.values()][0].status,'prepared');
 f.controller.enqueue(audio(1),24000);f.advance(2.75);assert(f.geometry.progress>0);
});

test('returned canonical IDs can be reused without duplicating an action',()=>{
 const f=fixture();const first=f.prepare();
 const segment=f.controller.openSegment(first.segmentId);
 const again=f.controller.prepare(segment,{actionId:first.actionId,kind:'write_math',targetId:'eq',content:'x + 2 = 5'},()=>f.geometry);
 assert.equal(again.actionId,first.actionId);assert.equal(f.controller.actions.size,1);
});
