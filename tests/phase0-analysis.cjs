const numberWords=n=>{
 const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
 if(n<20)return small[n];
 if(n<100)return ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'][Math.floor(n/10)]+(n%10?' '+small[n%10]:'');
 if(n<1000)return small[Math.floor(n/100)]+' hundred'+(n%100?' '+numberWords(n%100):'');
 return String(n);
};
function normalize(text) {
 return String(text).toLowerCase().replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,'$1 over $2')
  .replace(/\^(?:\{2\}|2(?!\d))|²/g,' squared ').replace(/\^(?:\{3\}|3(?!\d))|³/g,' cubed ')
  .replace(/\+/g,' plus ').replace(/[−-]/g,' minus ').replace(/=/g,' equals ')
  .replace(/[×*]/g,' times ').replace(/[÷/]/g,' over ')
  .replace(/\b\d+\b/g,match=>numberWords(Number(match))).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
}
function distribution(values) {
 const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
 const quantile=q=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]:null;
 const middle=Math.floor(sorted.length/2);
 const median=sorted.length?(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2):null;
 return {count:sorted.length,min:sorted[0]??null,median,p95:quantile(.95),max:sorted.at(-1)??null};
}
function analyze(report) {
 if(!report)return {status:'no_report'};
 const events=report.events||[];
 const audio=events.filter(event=>event.type==='audio');
 const transcripts=events.filter(event=>event.type==='output_text');
 const tools=events.filter(event=>event.type==='tool');
 const scheduled=events.filter(event=>event.type==='audio_scheduled');
 const markers=events.filter(event=>event.type==='marker_cue');
 const offsets=transcripts.filter(event=>event.startOffset!=null&&event.endOffset!=null);
 const textByEpoch=new Map();
 for(const event of events) {
   if(event.type==='output_text')textByEpoch.set(event.epoch,(textByEpoch.get(event.epoch)||'')+(event.text||''));
   if(event.type==='turn_end')textByEpoch.set(event.epoch,(textByEpoch.get(event.epoch)||'')+' ');
 }
 let previousTranscriptSample=0;
 const transcriptAdvances=transcripts.map(fragment=>{const advance=fragment.streamSample-previousTranscriptSample;previousTranscriptSample=fragment.streamSample;return advance;});
 const matches=markers.map(marker=>{
   const anchor=normalize(marker.anchor_text),text=normalize(textByEpoch.get(marker.epoch)||'');
   let count=0,position=0;
   while(anchor&&(position=text.indexOf(anchor,position))>=0){count++;position+=anchor.length;}
   return {cueId:marker.cueId,anchor:marker.anchor_text,normalizedAnchor:anchor,
     occurrences:count,requestedOccurrence:marker.occurrence||1,ambiguous:count>1,
     matched:count>=(marker.occurrence||1)};
 });
 const chunkDelays=scheduled.map(range=>{
   const received=audio.find(chunk=>chunk.epoch===range.generation&&chunk.streamSample===range.epochFromSample);
   return received?(range.startContextTime-received.contextTime)*1000:NaN;
 });
 const gaps=scheduled.slice(1).map((range,i)=>{
   const previous=scheduled[i];
   if(previous.generation!==range.generation)return NaN;
   return (range.startContextTime-previous.startContextTime-(previous.toSample-previous.fromSample)/previous.rate)*1000;
 }).filter(value=>value>20);
 const requests=events.filter(event=>event.type==='user_request');
 const first=report.diagnostics?.stats||{};
 return {status:audio.length?'audio_received':'no_audio',model:events.find(event=>event.type==='setup')?.model,
   audioChunks:audio.length,audioSeconds:audio.reduce((sum,event)=>sum+event.samples/event.rate,0),
   firstReceiveMs:requests.length&&audio.length?audio[0].receivedAtMs-requests[0].receivedAtMs:null,
   firstAudibleEstimateMs:requests.length&&first.firstAudibleEstimateMs?first.firstAudibleEstimateMs-requests[0].receivedAtMs:null,
   chunkStartDelayMs:distribution(chunkDelays),scheduledGapsOver20Ms:distribution(gaps),
   peakQueueSeconds:first.peakQueueSeconds,transcriptFragments:transcripts.length,
   fragmentWordCounts:distribution(transcripts.map(event=>event.words)),fragmentsWithOffsets:offsets.length,
   zeroAdvanceTranscriptFragments:transcriptAdvances.filter(value=>value===0).length,
   observedTranscriptFields:[...new Set(transcripts.flatMap(event=>event.fields||[]))],
   tools:tools.length,toolsWhileAudioPlaying:tools.filter(event=>event.heard).length,
   markerCalls:markers.length,anchorMatchCount:matches.filter(match=>match.matched).length,anchorMatches:matches,
   goAwayEvents:events.filter(event=>event.type==='go_away').length,
   resumptionUpdates:events.filter(event=>event.type==='resumption').map(event=>({resumable:event.resumable,hasHandle:event.hasHandle})),
   closures:events.filter(event=>event.type==='socket_closed').map(event=>({code:event.code,reason:event.reason})),
   transcriptText:transcripts.map(event=>event.text||'').join(''),
   timingAccuracy:'not measured against independent audio alignment',
 };
}
module.exports={normalize,distribution,analyze};
