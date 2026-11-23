// Phase 0 live experiments. Generated audio only; API keys and resumption handles are never exported.
const fs=require('node:fs');
const path=require('node:path');
const {launch,delay,ready}=require('./phase0-browser.cjs');
const {analyze}=require('./phase0-analysis.cjs');
const directory=path.resolve(__dirname,'artifacts','phase0');fs.mkdirSync(directory,{recursive:true});
const cases=[
 {name:'when-idle-a',settings:{toolScheduling:'WHEN_IDLE'},markers:10},
 {name:'silent-a',settings:{toolScheduling:'SILENT'},markers:10},
 {name:'omitted-a',settings:{toolScheduling:'OMIT'},markers:10},
 {name:'when-idle-b',settings:{toolScheduling:'WHEN_IDLE'},markers:10},
 {name:'silent-b',settings:{toolScheduling:'SILENT'},markers:10},
 {name:'omitted-b',settings:{toolScheduling:'OMIT'},markers:10},
 {name:'word-timestamps',settings:{wordTimestamps:true,toolScheduling:'WHEN_IDLE'},markers:1},
 {name:'session-capabilities',settings:{compression:true,resumption:true,toolScheduling:'WHEN_IDLE'},markers:1},
];
const selected=process.argv[2];
const words=['one','two','three','four','five','six','seven','eight','nine','ten','eleven'];
function request(count) {
 const facts=Array.from({length:count},(_,i)=>({cueId:'cue_'+(i+1),anchor_text:words[i]+' plus one equals '+words[i+1]}));
 return 'This is a short native-voice timing trial. Speak these supplied arithmetic statements in order. Just before each, call phase0_marker using its cueId and exact anchor_text, then say those exact words. Continue until every statement is spoken. Do not narrate tool calls or results, ask questions, or add a lesson. The statements are supplied test data; no solver call is needed. '+JSON.stringify(facts);
}
(async()=>{
 const response=await fetch('http://127.0.0.1:7860/',{signal:AbortSignal.timeout(3000)}).catch(()=>null);
 if(!response?.ok)throw Error('Ink Tutor server is not reachable at http://127.0.0.1:7860/. Restart voice_server.py before running Live trials.');
 const summaries=[];
 for(const trial of cases.filter(item=>!selected||item.name===selected||(selected==='repeat'&&item.name.endsWith('-b')))) {
  const options={enabled:true,captureText:true,captureAudio:true,phase0Markers:true,lookaheadMs:80,...trial.settings};
  const browser=await launch({source:'globalThis.INK_PHASE0_OPTIONS='+JSON.stringify(options)+';globalThis.INK_SYNC_CONFIG={maxQueueSeconds:30};'});
  try {
   await browser.cdp('Page.navigate',{url:'http://127.0.0.1:7860/?phase0=1&debugSync=1'});
   await ready(browser);
   if(browser.errors.length)throw Error(browser.errors.join('\n'));
   const question=request(trial.markers);
   await browser.evaluate('document.getElementById("question").value='+JSON.stringify(question)+'; document.getElementById("board-question").requestSubmit(document.querySelector("#board-question button"))');
   let lastActivity=Date.now(),lastCount=0;
   for(let second=0;second<45;second++) {
    await delay(1000);
    const state=await browser.evaluate(`(()=>{const r=inkPhase0Report();return r?{active:Boolean(voiceSession),audio:r.diagnostics.stats.receivedPcmBytes,queue:r.diagnostics.queueSeconds,markers:r.events.filter(e=>e.type==='marker_cue').length,events:r.events.filter(e=>e.type!=='clock').length}:null})()`);
    if(state&&state.events!==lastCount){lastActivity=Date.now();lastCount=state.events;}
    if(state&&!state.active)break;
    if(state?.audio&&state.markers>=trial.markers&&state.queue===0&&Date.now()-lastActivity>3000)break;
    if(second>=19&&!state?.audio)break;
   }
   const report=await browser.evaluate('inkPhase0Report()');
   if(!report)throw Error('No Phase 0 report was created.');
   report.test={name:trial.name,stoppingRule:'45 second limit; early stop only after requested marker count and 3 seconds idle, or 20 seconds with no audio',requestedMarkers:trial.markers,network:'Unthrottled, uncontrolled PC connection',input:'typed',browserMode:'headless; no physical speaker-onset ground truth'};
   report.browserErrors=browser.errors;
   const summary=analyze(report);summary.name=trial.name;summary.requestedMarkers=trial.markers;
   fs.writeFileSync(path.join(directory,trial.name+'.json'),JSON.stringify(report,null,2));
   const audio=await browser.evaluate('inkPhase0Audio()');
   if(audio)fs.writeFileSync(path.join(directory,trial.name+'.wav'),Buffer.from(audio,'base64'));
   summaries.push(summary);
   console.log(JSON.stringify({name:trial.name,status:summary.status,markerCalls:summary.markerCalls,audioSeconds:summary.audioSeconds,offsetFragments:summary.fragmentsWithOffsets,closures:summary.closures,errors:browser.errors}));
   await browser.evaluate('closeVoice()');
  }catch(error){summaries.push({name:trial.name,error:error.message});console.log(JSON.stringify({name:trial.name,error:error.message}));}
  finally{await browser.close();}
 }
 const filename=selected?'summary-'+selected+'.json':'summary.json';
 fs.writeFileSync(path.join(directory,filename),JSON.stringify({recordedAt:new Date().toISOString(),summaries},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
