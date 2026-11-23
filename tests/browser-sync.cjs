// Real-browser synthetic test through the app's typed-question and WebSocket entry points.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const live=process.argv.includes('--live');
const port=live?7860:8765;
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sync-test-'));
const artifacts=path.resolve(__dirname,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
const server=live?null:spawn('py',['-m','http.server',String(port),'--bind','127.0.0.1','--directory','dist'],{windowsHide:true,stdio:'ignore'});
let browser,socket;
(async()=>{
 try {
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const active=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100&&!fs.existsSync(active);i++)await delay(100);
  const debugPort=fs.readFileSync(active,'utf8').split('\n')[0];
  const targets=await (await fetch('http://127.0.0.1:'+debugPort+'/json')).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let sequence=0;const pending=new Map(),errors=[];
  socket.onmessage=({data})=>{
    const message=JSON.parse(data);
    if(message.id){const call=pending.get(message.id);pending.delete(message.id);if(message.error)call.reject(Error(message.error.message));else call.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text+' '+(message.params.exceptionDetails.exception?.description||''));
  };
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result?.value;
  };
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  if(!live)await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
    const nativeFetch=globalThis.fetch;
    globalThis.fetch=(url,options)=>String(url)==='/voice-session'?Promise.resolve(new Response(JSON.stringify({token:'synthetic',model:'test'}),{status:200})):nativeFetch(url,options);
    globalThis.WebSocket=class {
      static OPEN=1;
      constructor(){this.readyState=1;this.bufferedAmount=0;globalThis.testSocket=this;this.sent=[];setTimeout(()=>this.onopen?.(),0);}
      send(data){const message=JSON.parse(data);this.sent.push(message);if(message.setup)setTimeout(()=>this.emit({setupComplete:{}}),0);}
      emit(message){this.onmessage?.({data:JSON.stringify(message)});}
      close(){this.readyState=3;}
    };
    globalThis.testAudio=seconds=>{
      const buffer=new ArrayBuffer(24000*seconds*2),view=new DataView(buffer);
      for(let i=0;i<24000*seconds;i++)view.setInt16(i*2,Math.sin(i/24000*Math.PI*440*2)*300,true);
      let binary='';for(const value of new Uint8Array(buffer))binary+=String.fromCharCode(value);
      testSocket.emit({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:btoa(binary)}}]}}});
    };
  `});
  await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+'/?debugSync=1'});
  for(let i=0;i<100;i++){if(await evaluate("Boolean(document.getElementById('board-question') && globalThis.InkSync)"))break;await delay(100);}
  const question=live?'Teach x + 2 = 5 using small spoken and writing units. Write the equation, circle the added 2 while explaining it, show subtraction from both sides, and finish with x = 3. Explain why each operation works.':'Synthetic timing test';
  await evaluate('document.getElementById("question").value='+JSON.stringify(question)+'; document.getElementById("board-question").requestSubmit(document.querySelector("#board-question button"))');
  if(live) {
    const snapshots=[];
    for(let i=0;i<70;i++) {
      await delay(1000);
      const state=await evaluate('({caption:document.getElementById("caption").textContent,transcript:document.getElementById("transcript").textContent,board:boardScene.snapshot(),diagnostics:inkSyncDiagnostics()})');
      snapshots.push({second:i+1,state:state.diagnostics?.state,queueSeconds:state.diagnostics?.queueSeconds,board:state.board});
      const complete=state.board.some(item=>/x\s*=\s*3/.test(item.content)&&item.status==='completed');
      if(complete && state.diagnostics?.queueSeconds===0)break;
      if(!state.diagnostics)break;
      if(i>=24&&!state.diagnostics.stats.receivedPcmBytes)break;
    }
    const before=await evaluate('({board:boardScene.snapshot(),diagnostics:inkSyncDiagnostics(),transcript:document.getElementById("transcript").textContent,caption:document.getElementById("caption").textContent})');
    const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'live-lesson.png'),Buffer.from(shot.data,'base64'));
    // A second real request tests interruption during a newly prepared symbol.
    await evaluate('document.getElementById("question").value="Write 3x + 5 = 20 and begin explaining how to solve it."; document.getElementById("board-question").requestSubmit(document.querySelector("#board-question button"))');
    let interrupted=false;
    for(let i=0;i<25 && before.diagnostics?.stats.receivedPcmBytes;i++) {
      await delay(300);
      const partial=await evaluate('boardScene.snapshot().some(item=>item.status==="started"&&item.progress>0&&item.progress<1)');
      if(partial){
        await evaluate('document.getElementById("question").value="Stop. Tell me which expression is still unfinished on the board."; document.getElementById("board-question").requestSubmit(document.querySelector("#board-question button"))');
        interrupted=true;break;
      }
    }
    await delay(5000);
    const after=await evaluate('({board:boardScene.snapshot(),diagnostics:inkSyncDiagnostics(),transcript:document.getElementById("transcript").textContent,caption:document.getElementById("caption").textContent})');
    const acceptance={voiceReceived:Boolean(before.diagnostics?.stats.receivedPcmBytes),
      finalLineComplete:before.board.some(item=>/x\s*=\s*3/.test(item.content)&&item.status==='completed'),
      browserErrors:errors.length,typedInterruptionObserved:interrupted};
    const report={environment:'Chrome headless on Windows using real Gemini Live through local temporary-token server; typed input, native audio output; microphone detection not tested',acceptance,snapshots,before,after,interrupted,errors};
    fs.writeFileSync(path.join(artifacts,'live-results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({live:true,acceptance,receivedPcmBytes:before.diagnostics?.stats.receivedPcmBytes,board:before.board,transcript:before.transcript,caption:before.caption,interrupted,afterBoard:after.board,errors}));
    if(!acceptance.voiceReceived||!acceptance.finalLineComplete||acceptance.browserErrors)process.exitCode=1;
    await cdp('Browser.close');return;
  }
  await delay(500);
  assert.equal(await evaluate('testSocket.sent.some(message=>message.clientContent)'),true);
  const tool=async(segment,action)=>evaluate('testSocket.emit('+JSON.stringify({toolCall:{functionCalls:[{id:segment,name:'board_actions',args:{segmentId:segment,actions:[action]}}]}})+')');
  const audio=seconds=>evaluate('testAudio('+seconds+')');
  const end=()=>evaluate('testSocket.emit({serverContent:{turnComplete:true}})');
  const screenshot=async name=>{const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name),Buffer.from(shot.data,'base64'));};
  await tool('first',{actionId:'first',kind:'write_math',targetId:'equation',content:'x + 2 = 5'});await audio(3);await end();
  await delay(700);
  const partial=await evaluate('boardScene.snapshot()');assert(partial[0].progress>0&&partial[0].progress<1);
  await screenshot('writing-progress.png');
  await evaluate("document.getElementById('pause-tutor').click()");
  await delay(100);
  const paused=await evaluate('boardScene.snapshot()[0].progress');
  await delay(350);
  assert.equal(await evaluate('boardScene.snapshot()[0].progress'),paused);
  await evaluate("document.getElementById('pause-tutor').click()");
  await delay(2900);
  assert.equal((await evaluate('boardScene.snapshot()'))[0].progress,1);
  await tool('circle',{actionId:'circle',kind:'circle',targetId:'equation',term:'2'});await audio(1);await end();await delay(1500);
  assert.equal((await evaluate('boardScene.snapshot()'))[0].marks[0].status,'completed');
  await tool('subtract',{actionId:'subtract',kind:'write_math',targetId:'subtraction',content:'x + 2 - 2 = 5 - 2'});await audio(3);await audio(2);await end();await delay(5500);
  await tool('result',{actionId:'result',kind:'write_math',targetId:'answer',content:'x = 3'});await audio(2);await end();await delay(2500);
  await screenshot('completed-lesson.png');
  assert.equal((await evaluate('boardScene.snapshot()')).find(item=>item.content==='x = 3').status,'completed');
  await tool('interruption',{actionId:'interruption',kind:'write_math',targetId:'unfinished',content:'x + 2 = 5'});await audio(2);await delay(450);
  await evaluate('testSocket.emit({serverContent:{interrupted:true}})');
  const frozen=await evaluate("boardScene.snapshot().find(item=>item.content==='x + 2 = 5'&&item.status==='cancelled')");
  assert(frozen&&frozen.progress>0&&frozen.progress<1);
  await tool('stale',{actionId:'stale',kind:'write_math',targetId:'stale',content:'99 = 99'});
  assert.equal(await evaluate("boardScene.snapshot().some(item=>item.content==='99 = 99')"),false);
  await delay(400);
  assert.equal(await evaluate("boardScene.snapshot().find(item=>item.targetId==="+JSON.stringify(frozen.targetId)+").progress"),frozen.progress);
  await screenshot('interrupted-writing.png');
  const diagnostics=await evaluate('inkSyncDiagnostics()');
  assert.equal(diagnostics.sources,0);
  assert.equal(errors.length,0,errors.join('\n'));
  const report={environment:'Chrome headless on Windows, real Web Audio + SVG, synthetic PCM sine wave; no provider/network timing',partialProgress:partial[0].progress,frozenProgress:frozen.progress,diagnostics,errors};
  fs.writeFileSync(path.join(artifacts,'browser-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,partialProgress:partial[0].progress,frozenProgress:frozen.progress,localFreezeMs:diagnostics.events.findLast(e=>e.type==='interruption')?.localFreezeMs,peakQueueSeconds:diagnostics.stats.peakQueueSeconds,errors}));
  await cdp('Browser.close');
 } finally {
  socket?.close();browser?.kill();server?.kill();
  // Delete only this test's freshly created temporary profile.
  if(path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('ink-sync-test-')){
    await delay(500);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:4,retryDelay:300});}catch{}
  }
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
