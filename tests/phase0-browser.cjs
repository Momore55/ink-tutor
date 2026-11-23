// Isolated test browser. Never attaches to the user's personal browser profile.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(browser) {
  let last;
  for(let i=0;i<450;i++) {
    const state=await browser.evaluate(`({url:location.href,ready:typeof globalThis.inkPhase0Report==='function'})`);
    last=state;
    if(state.url.startsWith('chrome-error:'))throw Error('Ink Tutor server is not reachable at http://127.0.0.1:7860/. Restart voice_server.py and leave its PowerShell window open.');
    if(browser.errors.length)throw Error(browser.errors.join('\n'));
    if(state.ready)return;
    await delay(100);
  }
  const details=await browser.evaluate(`({state:document.readyState,panel:!!document.getElementById('phase0-panel'),scripts:[...document.scripts].map(s=>s.src)})`);
  throw Error('Phase 0 page did not finish initialization. No Live trial was sent. '+JSON.stringify({last,details}));
}
async function launch({visible=false,source='' }={}) {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ink-phase0-'));
  const args=['--disable-gpu','--no-first-run','--disable-background-networking',
    '--autoplay-policy=no-user-gesture-required','--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'];
  if(!visible)args.unshift('--headless=new');
  const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args,{windowsHide:!visible,stdio:'ignore'});
  let socket;
  const close=async()=>{
    socket?.close();browser.kill();
    await delay(600);
    if(path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('ink-phase0-')) {
      try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:4,retryDelay:300});}catch{}
    }
  };
  try {
    const active=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(active);i++)await delay(100);
    const port=fs.readFileSync(active,'utf8').split('\n')[0];
    const targets=await(await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(3000)})).json();
    socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let sequence=0;const pending=new Map(),errors=[];
    socket.onmessage=({data})=>{
      const message=JSON.parse(data);
      if(message.id){
        const request=pending.get(message.id);if(!request)return;
        pending.delete(message.id);clearTimeout(request.timer);
        if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);
      }
      if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    };
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},15000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
    });
    const evaluate=async expression=>{
      const response=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
      return response.result?.value;
    };
    await cdp('Runtime.enable');await cdp('Page.enable');
    await cdp('Network.enable');await cdp('Network.setCacheDisabled',{cacheDisabled:true});
    if(source)await cdp('Page.addScriptToEvaluateOnNewDocument',{source});
    return {cdp,evaluate,errors,close,delay};
  }catch(error){await close();throw error;}
}
module.exports={launch,delay,ready};
