/* Async drawing delegation runs independently of the native voice connection. */
(function(root){
  async function capture(){
    const clone=document.getElementById('board').cloneNode(true);
    const background=document.createElementNS('http://www.w3.org/2000/svg','rect');
    background.setAttribute('width','900');background.setAttribute('height','620');background.setAttribute('fill','#203f37');clone.prepend(background);
    clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
    try{
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      canvas.getContext('2d').drawImage(image,0,0,640,360);return canvas.toDataURL('image/png').split(',')[1];
    }finally{URL.revokeObjectURL(url);}
  }
  function start(session,args,scene,onChange){
    if(typeof args?.intent!=='string'||!args.intent.trim()||args.intent.length>4000||typeof args.narration!=='string'||!args.narration.trim()||args.narration.length>4000)throw Error('Supply visual intent and the planned spoken narration.');
    session.canvasJobs??=new Map();
    if(session.canvasJobs.size>=12)throw Error('Canvas job limit reached. Start a new class.');
    const id='canvas_'+(++session.boardSequence),generation=session.sync.generation;
    const segment=session.sync.openSegment(id);
    const job={id,generation,status:'drawing',strokeCount:0,actionIds:[],targetIds:[],abort:new AbortController()};
    session.canvasJobs.set(id,job);onChange(job);
    const apply=raw=>{
      if(job.abort.signal.aborted||session.sync.generation!==generation)return;
      const stroke=InkStroke.validate(raw);stroke.id=id+'_'+stroke.id.slice(0,40);
      const elapsed=segment.played/(segment.rate||24000)*1000;
      if(segment.ended&&segment.played>=segment.samples&&segment.samples)throw Error('The illustration arrived after its narration. Ask to draw it again.');
      if(stroke.onsetOffsetMs<elapsed){
        const requested=stroke.onsetOffsetMs;stroke.onsetOffsetMs=elapsed+50;
        session.sync.log('late_vector_rebased',{jobId:id,requestedOnsetMs:requested,appliedOnsetMs:stroke.onsetOffsetMs,timing:'approximate'});
      }
      if(segment.ended&&segment.rate){
        const available=segment.samples/segment.rate*1000-stroke.onsetOffsetMs;
        if(available<16)throw Error('Not enough narration remains for this stroke.');
        stroke.durationMs=Math.min(stroke.durationMs,available);
      }
      const action=InkStroke.action(stroke),result=session.sync.prepare(segment,action,(input,g)=>scene.prepare(input,g));
      job.actionIds.push(result.actionId);job.targetIds.push(result.targetId);job.strokeCount++;onChange(job);
    };
    job.done=(async()=>{
      try{
        const image=await capture();if(job.abort.signal.aborted)return;
        const response=await fetch('/canvas-actions',{method:'POST',headers:{'Content-Type':'application/json'},signal:job.abort.signal,
          body:JSON.stringify({intent:args.intent,narration:args.narration,board:scene.snapshot(),image})});
        if(!response.ok)throw Error('Canvas specialist unavailable. Check that the updated server is running.');
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',total=0,sawDone=false;
        const consume=line=>{
          if(!line.trim())return;
          const event=JSON.parse(line);
          if(event.type==='stroke')apply(event.stroke);
          if(event.type==='error')throw Error(event.message);
          if(event.type==='done')sawDone=true;
        };
        try{
          while(true){
            const {value,done}=await reader.read();if(done)break;
            total+=value.byteLength;if(total>1_000_000)throw Error('Canvas response exceeds limit.');
            buffer+=decoder.decode(value,{stream:true});let end;
            while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}
          }
          buffer+=decoder.decode();if(buffer.trim())consume(buffer);
        }finally{await reader.cancel().catch(()=>{});}
        if(job.abort.signal.aborted){if(job.status!=='removed')job.status='cancelled';return;}
        if(!sawDone||!job.strokeCount)throw Error('The illustration stream did not finish.');
        job.status='prepared';
      }catch(error){
        if(job.status!=='removed'){job.status=job.abort.signal.aborted?'cancelled':'error';job.error=job.status==='error'?error.message:undefined;}
      }finally{onChange(job);}
    })();
    return job;
  }
  root.InkCanvas={start,capture};
})(globalThis);
