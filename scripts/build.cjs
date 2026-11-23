const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..'),destination=path.join(root,'dist');
const files=['index.html','style.css','app.js','live-config.js','board-math.js','learning-state.js','mic-capture.js',
 'playback-sync.js','board-scene.js','gemini-adapter.js','phase0-probe.js','audio-output.js','audio-playback-worklet.js','stroke-protocol.js','canvas-jobs.js'];
fs.mkdirSync(destination,{recursive:true});for(const file of files)fs.copyFileSync(path.join(root,file),path.join(destination,file));
console.log('Prepared '+files.length+' frontend files in dist.');
