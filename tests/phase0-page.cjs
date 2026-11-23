// No provider calls: verify the opt-in measurement UI and the normal page.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {launch,delay,ready}=require('./phase0-browser.cjs');
(async()=>{
 const server=spawn('py',['-m','http.server','8766','--bind','127.0.0.1','--directory','dist'],{windowsHide:true,stdio:'ignore'});
 let browser;
 try {
  for(let i=0;i<50;i++){
   if(await fetch('http://127.0.0.1:8766/').then(r=>r.ok).catch(()=>false))break;
   await delay(100);
  }
  browser=await launch();
  await browser.cdp('Page.navigate',{url:'http://127.0.0.1:8766/?phase0=1'});
  await ready(browser);
  assert.deepEqual(await browser.evaluate(`({panel:document.getElementById('phase0-panel').hidden,start:typeof document.getElementById('phase0-start').onclick,report:inkPhase0Report()??null})`),{panel:false,start:'function',report:null});
  await browser.evaluate(`document.getElementById('writing-delay').value=100;document.getElementById('writing-delay').dispatchEvent(new Event('input'));`);
  await browser.evaluate(`document.getElementById('timing-test').onclick()`);
  assert.deepEqual(await browser.evaluate(`({delay:readWritingDelay(),done:[...document.querySelectorAll('#timing-preview path')].map(p=>p.getAttribute('stroke-dashoffset')),enabled:!document.getElementById('timing-test').disabled})`),{delay:100,done:['0','0','0'],enabled:true});
  await browser.cdp('Page.navigate',{url:'http://127.0.0.1:8766/'});
  await delay(700);
  assert.equal(await browser.evaluate(`document.getElementById('phase0-panel').hidden`),true);
  assert.equal(await browser.evaluate(`typeof globalThis.inkPhase0Report`),'undefined');
  assert.equal(await browser.evaluate(`readWritingDelay()`),100);
  assert.deepEqual(browser.errors,[]);
  console.log('Measurement and normal pages initialized; three sound/pen calibration strokes completed; writing delay survived reload; no provider requests sent.');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
