const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
require('../gemini-adapter.js');require('../live-config.js');
require('../board-math.js');
const {normalize,distribution,analyze}=require('./phase0-analysis.cjs');
test('labeled calculation lines retain fraction and superscript layout',()=>{
 const layout=layoutBoardMath(String.raw`Squared errors: (-1)^{2} = 1; Mean: \frac{5}{2} = 2.5`);
 assert(layout.marks.some(mark=>mark.char===':'));
 assert(layout.marks.some(mark=>mark.char==='bar'));
 assert(layout.marks.some(mark=>mark.char==='2'&&mark.y<0));
 assert.throws(()=>layoutBoardMath(String.raw`\unknown{1}`),/Unsupported/);
});
test('all demux events carry epoch, monotonic receipt and observed stream position',()=>{
 const adapter=new InkGemini.Adapter();
 const events=adapter.normalize({toolCall:{functionCalls:[{id:'cue',name:'phase0_marker'}]},serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(480).toString('base64')}}]},outputTranscription:{text:'x',startOffset:'0.01s',endOffset:'0.02s'},generationComplete:true,turnComplete:true}},42);
 assert(events.every(event=>event.epoch===42&&Number.isFinite(event.receivedAtMs)&&event.messageId===1));
 assert.equal(events.find(event=>event.kind==='tool').streamSample,0);
 assert.equal(events.find(event=>event.kind==='audio').streamSample,0);
 assert.equal(events.find(event=>event.kind==='output_text').streamSample,240);
 assert.equal(events.find(event=>event.kind==='output_text').startOffset,'0.01s');
 assert(events.every(event=>event.coDelivered));
 const next=adapter.normalize({serverContent:{outputTranscription:{text:'new'}}},43);
 assert.equal(next[0].streamSample,0);
});
test('optional timing and session setup is isolated from normal Live setup',()=>{
 const baseline=InkLive.setup('model');assert.deepEqual(baseline.outputAudioTranscription,{});
 assert(!baseline.contextWindowCompression&&!baseline.sessionResumption);
 assert(!baseline.tools[0].functionDeclarations.some(tool=>tool.name==='phase0_marker'));
 const probe=InkLive.setup('model',undefined,undefined,{wordTimestamps:true,compression:true,resumption:true,phase0Markers:true});
 assert(probe.outputAudioTranscription.wordTimestamp);
 assert.deepEqual(probe.contextWindowCompression,{slidingWindow:{}});
 assert(probe.tools[0].functionDeclarations.some(tool=>tool.name==='phase0_marker'));
 assert(!InkLive.setup('model').tools[0].functionDeclarations.some(tool=>tool.name==='phase0_marker'));
});
test('default Phase 0 reports redact content and never retain microphone audio',()=>{
 const sandbox={performance:{now:()=>10},navigator:{userAgent:'test'},Uint8Array,ArrayBuffer,DataView,btoa:()=>''};
 vm.runInNewContext(fs.readFileSync(require.resolve('../phase0-probe.js'),'utf8'),sandbox);
 const probe=new sandbox.InkPhase0.Probe({enabled:true});
 const sync={context:{currentTime:0},queueSeconds:()=>0,heardPosition:()=>null,
   diagnostics:()=>({actions:[{anchor:{phrase:'private sentence',occurrence:1}}]})};
 probe.observe({kind:'input_text',text:'private sentence',epoch:1,streamSample:0},sync);
 const report=probe.report(sync,{snapshot:()=>{throw Error('Content must not be exported');}});
 assert(!JSON.stringify(report).includes('private sentence'));
 assert.equal(report.capture.microphoneAudio,false);assert.equal(probe.audioBytes,0);
});
test('English math normalization compares speech with notation without inventing timing',()=>{
 assert.equal(normalize('x² + 2 = 5'),'x squared plus two equals five');
 assert(!normalize('x^20').includes('squared'));
 assert.equal(normalize(String.raw`\frac{1}{2}`),'one over two');
});
test('small-sample summaries calculate median and label missing timing evidence',()=>{
 assert.deepEqual(distribution([10,20]),{count:2,min:10,median:15,p95:20,max:20});
 const summary=analyze({events:[{type:'marker_cue',epoch:1,anchor_text:'x plus two',occurrence:2},{type:'output_text',epoch:1,text:'x + 2, x + 2',words:6}],diagnostics:{stats:{}}});
 assert.equal(summary.anchorMatches[0].occurrences,2);
 assert(summary.anchorMatches[0].ambiguous);
 assert.equal(summary.timingAccuracy,'not measured against independent audio alignment');
});
