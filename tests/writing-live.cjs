// Real native-voice completion regression. Fixtures never enter the teaching policy.
const fs=require('node:fs');
const path=require('node:path');
const {launch,delay,ready}=require('./phase0-browser.cjs');
const trials=[
 {name:'equation',question:'Explain how to solve 3x + 5 = 20. Write every intermediate calculation in teaching order and finish with x = 5. Explain each transformation aloud as you write. Complete the worked example before offering practice.',answer:/x\s*=\s*5/},
 {name:'cost-function',question:'Explain a mean squared error cost function with this tiny word problem: two actual sales values are 2 and 4; our predictions are 1 and 2. Write both prediction errors, both squared errors, their sum, and the division by two, ending with MSE = 2.5 on the board. Explain why we square and average while writing the calculations. Complete this one worked example. Keep it to at most eight short writing lines.',answer:/=\s*2\.5/},
];
const controlled=process.argv.includes('--controlled');
if(controlled){
 const lines=[['3x + 5 = 20','3x + 5 - 5 = 20 - 5','3x = 15',String.raw`\frac{3x}{3} = \frac{15}{3}`,'x = 5'],
 ['Actual: 2, 4; Predictions: 1, 2','1 - 2 = -1','2 - 4 = -2','(-1)^{2} = 1','(-2)^{2} = 4','1 + 4 = 5',String.raw`MSE = \frac{5}{2} = 2.5`]];
 trials.forEach((trial,i)=>trial.question='Native voice and pen test: use exactly one show_step call with these supplied lines in this order: '+JSON.stringify(lines[i])+'. Explain the calculations aloud in that same order, including the final result. Speak continuously with the prepared writing. The supplied math is verified test data; no solver is needed. After explaining all lines, finish your reply. Do not repeat the drawing, clear the board, or offer another exercise during this test.');
}
(async()=>{
 const directory=path.resolve(__dirname,'artifacts',controlled?'writing-fit-controlled':'writing-fit');fs.mkdirSync(directory,{recursive:true});
 let failed=false;
 for(const trial of trials){
  const browser=await launch({source:'globalThis.INK_PHASE0_OPTIONS={captureText:true,captureAudio:true,lookaheadMs:250};'});
  try{
   await browser.cdp('Page.navigate',{url:'http://127.0.0.1:7860/?phase0=1'});await ready(browser);
   await browser.evaluate(`document.getElementById('question').value=${JSON.stringify(trial.question)};document.getElementById('board-question').requestSubmit(document.querySelector('#board-question button'));`);
   const frames=[];let lastChange=Date.now(),signature='';
   for(let i=0;i<200;i++){
    await delay(300);
    const state=await browser.evaluate(`(()=>{const r=inkPhase0Report();return {at:performance.now(),active:!!voiceSession,board:boardScene.snapshot(),report:r&&{queue:r.diagnostics.queueSeconds,audio:r.diagnostics.stats.receivedPcmBytes,eventCount:r.events.filter(e=>e.type!=='clock').length}}})()`);
    frames.push(state);
    const next=JSON.stringify([state.report?.eventCount,state.board.map(item=>[item.status,item.progress])]);
    if(next!==signature){signature=next;lastChange=Date.now();}
    if(!state.active&&state.report)break;
    if(state.report?.audio&&state.report.queue===0&&Date.now()-lastChange>3000)break;
   }
   const report=await browser.evaluate('inkPhase0Report()');
   const board=await browser.evaluate('boardScene.snapshot()');
   const caption=await browser.evaluate('document.getElementById("caption").textContent');
   const starts=report.events.filter(e=>e.type==='stroke_start');
   const finishes=report.events.filter(e=>e.type==='stroke_end');
   const early=starts.filter(e=>e.visualContextTime<e.audioStartContextTime-1e-6);
   const outside=finishes.filter(e=>e.visualContextTime>e.audioEndContextTime+.05);
   const incomplete=board.filter(item=>item.status!=='completed');
   const incompleteActions=report.diagnostics.actions.filter(item=>item.status!=='completed');
   const result={name:trial.name,caption,voiceReceived:report.diagnostics.stats.receivedPcmBytes>0,
    answerComplete:board.some(item=>trial.answer.test(item.content)&&item.status==='completed'),
    boardObjects:board.length,incomplete:incomplete.map(item=>({content:item.content,status:item.status,progress:item.progress})),
    incompleteActionCount:incompleteActions.length,
    writingBeforeSegmentAudio:early.length,writingOver50MsAfterSegmentAudio:outside.length,
    fittedWindows:report.events.filter(e=>e.type==='writing_fitted').length,
    peakQueueSeconds:report.diagnostics.stats.peakQueueSeconds,browserErrors:browser.errors,
    timingLimit:'speaker-clock estimates; individual spoken-word onsets are not independently measured'};
   result.passed=result.voiceReceived&&result.answerComplete&&!incomplete.length&&!incompleteActions.length&&!early.length&&!outside.length&&!browser.errors.length;
   failed ||= !result.passed;
   fs.writeFileSync(path.join(directory,trial.name+'.json'),JSON.stringify({result,report,board,frames},null,2));
   const wav=await browser.evaluate('inkPhase0Audio()');if(wav)fs.writeFileSync(path.join(directory,trial.name+'.wav'),Buffer.from(wav,'base64'));
   const shot=await browser.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,trial.name+'.png'),Buffer.from(shot.data,'base64'));
   console.log(JSON.stringify(result));
   await browser.evaluate('closeVoice()');
  }catch(error){failed=true;console.log(JSON.stringify({name:trial.name,error:error.message}));}
  finally{await browser.close();}
 }
 if(failed)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
