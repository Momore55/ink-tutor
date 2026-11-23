const assert=require('node:assert/strict');const {spawn}=require('node:child_process');
const {launch,delay,ready}=require('./phase0-browser.cjs');
const source=`
const realFetch=globalThis.fetch;
globalThis.INK_PHASE0_OPTIONS={captureText:false,lookaheadMs:80};
globalThis.fetch=(url,options)=>{
 if(String(url)==='/voice-session')return Promise.resolve(new Response(JSON.stringify({token:'test',model:'test'})));
 if(String(url)==='/canvas-actions')return Promise.resolve(new Response(new ReadableStream({start(controller){
  const stroke={id:'delegated',type:'freedraw',onsetOffsetMs:600,durationMs:600,points:[{x:400,y:300},{x:450,y:250},{x:500,y:300}],color:'#eec57e'};
  setTimeout(()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'stroke',stroke})+'\\n'));controller.enqueue(new TextEncoder().encode('{"type":"done"}\\n'));controller.close();},150);
 }}),{headers:{'Content-Type':'application/x-ndjson'}}));
 return realFetch(url,options);
};
globalThis.WebSocket=class {static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];globalThis.fakeSocket=this;setTimeout(()=>this.onopen?.(),0);}send(data){const m=JSON.parse(data);this.sent.push(m);if(m.setup)setTimeout(()=>this.emit({setupComplete:{}}),0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}close(){this.readyState=3;}};
globalThis.pcm=seconds=>{const bytes=new Uint8Array(24000*seconds*2);return btoa(String.fromCharCode(...bytes));};
`;
(async()=>{
 const server=spawn('py',['-m','http.server','8767','--bind','127.0.0.1','--directory','dist'],{windowsHide:true,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<50;i++){if(await fetch('http://127.0.0.1:8767/').then(r=>r.ok).catch(()=>false))break;await delay(100);}
  browser=await launch({source});await browser.cdp('Page.navigate',{url:'http://127.0.0.1:8767/?phase0=1'});await ready(browser);
  await browser.evaluate(`document.getElementById('question').value='Vector regression';document.getElementById('board-question').requestSubmit(document.querySelector('#board-question button'));`);
  for(let i=0;i<100;i++){if(await browser.evaluate('!!voiceSession?.connected'))break;await delay(50);}
  assert.equal(await browser.evaluate('voiceSession.sync.diagnostics().output'),'audio_worklet');
  const stroke={id:'trace',type:'freedraw',onsetOffsetMs:500,durationMs:500,points:[{x:60,y:80},{x:120,y:120},{x:180,y:80}],color:'#eec57e'};
  await browser.evaluate(`fakeSocket.emit({toolCall:{functionCalls:[{id:'draw',name:'draw_strokes',args:{segmentId:'drawing',strokes:[${JSON.stringify(stroke)}]}}]}});fakeSocket.emit({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:pcm(2)}}]},generationComplete:true,turnComplete:true}});`);
  await delay(200);assert.equal(await browser.evaluate('boardScene.snapshot().length'),0);
  await delay(450);const before=await browser.evaluate('voiceSession.output.clock.samplesProcessed');
  await browser.evaluate(`(()=>{const until=performance.now()+500;while(performance.now()<until){}return true})()`);await delay(80);
  const after=await browser.evaluate('voiceSession.output.clock.samplesProcessed');assert(after-before>=10000);
  await delay(1200);assert.equal(await browser.evaluate('boardScene.snapshot()[0].status'),'completed');
  await browser.evaluate(`fakeSocket.emit({toolCall:{functionCalls:[{id:'delegate',name:'delegatePrompt',args:{intent:'An arbitrary triangle-like trajectory',narration:'A shape is drawn while we explain it.'}}]}});fakeSocket.emit({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:pcm(2)}}]},generationComplete:true,turnComplete:true}});`);
  await delay(100);assert.equal(await browser.evaluate(`fakeSocket.sent.flatMap(m=>m.toolResponse?.functionResponses||[]).find(r=>r.id==='delegate')?.response.status`),'delegated');
  await delay(2400);assert.equal(await browser.evaluate(`[...voiceSession.canvasJobs.values()][0].status`),'prepared');
  assert.equal(await browser.evaluate('boardScene.snapshot().length'),2);
  await browser.evaluate(`document.querySelector('#canvas-jobs button:last-child').click()`);assert.equal(await browser.evaluate('boardScene.snapshot().length'),1);
  await browser.evaluate(`fakeSocket.emit({serverContent:{interrupted:true,turnComplete:true}})`);await delay(150);
  assert.equal(await browser.evaluate('voiceSession.output.pending.size'),0);
  assert.equal(await browser.evaluate('voiceSession.output.clock?.samplesProcessed||0'),0);
  assert.deepEqual(browser.errors,[]);
  console.log(JSON.stringify({passed:true,output:'audio_worklet',samplesAdvancedDuring500MsMainThreadBlock:after-before,timedVector:true,delegation:true,rejectPreservedOtherObjects:true,flush:true}));
  await browser.evaluate('closeVoice()');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
