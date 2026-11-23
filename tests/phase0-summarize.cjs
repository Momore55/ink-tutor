// Recompute derived metrics from retained raw evidence; never rewrite raw trials.
const fs=require('node:fs');
const path=require('node:path');
const {analyze}=require('./phase0-analysis.cjs');
const directory=path.resolve(__dirname,'artifacts','phase0');
const summaries=[];
for(const file of fs.readdirSync(directory).filter(name=>!name.startsWith('summary')&&name.endsWith('.json'))){
 const report=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
 if(!report.events||!report.diagnostics)continue;
 summaries.push({file,test:report.test||null,...analyze(report)});
}
fs.writeFileSync(path.join(directory,'summary-evidence.json'),JSON.stringify({analyzedAt:new Date().toISOString(),summaries},null,2));
console.log(JSON.stringify(summaries.map(r=>({file:r.file,audioSeconds:r.audioSeconds,markers:r.markerCalls,matched:r.anchorMatchCount,offsets:r.fragmentsWithOffsets,closures:r.closures}))));
