// Visible, user-operated speaker/microphone test. Stores metadata only by default.
const fs=require('node:fs');
const path=require('node:path');
const {launch,delay,ready}=require('./phase0-browser.cjs');
(async()=>{
 const browser=await launch({visible:true});
 try {
  await browser.cdp('Page.navigate',{url:'http://127.0.0.1:7860/?phase0=1&debugSync=1'});
  await ready(browser);
  await browser.evaluate(`document.getElementById('phase0-question').value='Please explain how to solve x + 2 = 5 and give another worked example. Write while explaining why the operations preserve equality.'; document.getElementById('phase0-panel').scrollIntoView({block:'start'});`);
  console.log('Speaker test is open. Waiting for the user to start the microphone and finish the test.');
  for(let i=0;i<900;i++) {
   await delay(1000);
   if(await browser.evaluate('Boolean(globalThis.inkPhase0Finished)'))break;
  }
  const report=await browser.evaluate('globalThis.inkPhase0Report?.()');
  if(report) {
   const directory=path.resolve(__dirname,'artifacts','phase0');fs.mkdirSync(directory,{recursive:true});
   fs.writeFileSync(path.join(directory,'speaker-device.json'),JSON.stringify(report,null,2));
   const local=report.events.filter(event=>event.type==='local_speech_confirmed');
   const remote=report.events.filter(event=>event.type==='interrupt');
   console.log(JSON.stringify({saved:true,localConfirmedCandidates:local.length,providerInterruptions:remote.length,annotations:report.events.filter(event=>event.type==='annotation').map(event=>event.label)}));
  }else console.log('No microphone session was started. Physical-device test remains pending.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
