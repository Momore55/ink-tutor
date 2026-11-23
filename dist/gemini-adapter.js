/* Normalize provider events and fence an interrupted turn until turnComplete. */
(function (root) {
  class Adapter {
    constructor() { this.fenced=false; this.cancelledCalls=new Set(); this.epoch=0; this.samplesReceived=0; this.sampleRate=24000; this.messageId=0; }
    fence() { this.fenced=true; }
    normalize(message, epoch = this.epoch) {
      if(epoch!==this.epoch){this.epoch=epoch;this.samplesReceived=0;}
      const messageId=++this.messageId;
      const receivedAtMs=performance.now();
      const initialSample=this.samplesReceived;
      const fields=Object.keys(message.serverContent||{});
      const events=[];
      if(message.error) events.push({kind:'error',message:message.error.message||'Gemini returned an error.'});
      if(message.setupComplete) events.push({kind:'ready'});
      if(message.goAway)events.push({kind:'go_away',timeLeft:message.goAway.timeLeft});
      if(message.sessionResumptionUpdate)events.push({kind:'resumption',resumable:Boolean(message.sessionResumptionUpdate.resumable),hasHandle:Boolean(message.sessionResumptionUpdate.newHandle)});
      if(message.usageMetadata)events.push({kind:'usage',usage:message.usageMetadata});
      const content=message.serverContent;
      if(content?.inputTranscription?.text) events.push({kind:'input_text',text:content.inputTranscription.text,startOffset:content.inputTranscription.startOffset,endOffset:content.inputTranscription.endOffset,streamSample:this.samplesReceived});
      if(content?.interrupted) { this.fenced=true; events.push({kind:'interrupt'}); }
      if(message.toolCallCancellation) {
        for(const id of message.toolCallCancellation.ids||[]) {
          this.cancelledCalls.add(id);
          if(this.cancelledCalls.size>128)this.cancelledCalls.delete(this.cancelledCalls.values().next().value);
        }
        events.push({kind:'cancel_tools',ids:message.toolCallCancellation.ids||[]});
      }
      if(!this.fenced) {
        for(const call of message.toolCall?.functionCalls||[]) {
          if(!this.cancelledCalls.has(call.id)) events.push({kind:'tool',call});
        }
        for(const part of content?.modelTurn?.parts||[]) {
          if(part.inlineData) {
            const {data,mimeType}=part.inlineData;
            const match=/^audio\/pcm(?:;\s*rate=(\d+))(?:;\s*channels=(\d+))?$/.exec(mimeType||'');
            if(!match || (match[2]&&match[2]!=='1')) {events.push({kind:'error',message:'Unsupported native audio format: '+mimeType});continue;}
            if(typeof data!=='string'||data.length>Number(match[1])*8+8) {events.push({kind:'error',message:'Audio chunk exceeds the decoding limit.'});continue;}
            const bytes=Uint8Array.from(atob(data),char=>char.charCodeAt(0));
            events.push({kind:'audio',bytes,rate:Number(match[1]),streamSample:this.samplesReceived});
            this.sampleRate=Number(match[1]);
            this.samplesReceived+=bytes.length/2;
          }
        }
        if(content?.outputTranscription?.text)events.push({kind:'output_text',text:content.outputTranscription.text,startOffset:content.outputTranscription.startOffset,endOffset:content.outputTranscription.endOffset,streamSample:this.samplesReceived});
      }
      if(content?.generationComplete)events.push({kind:'generation_end'});
      if(content?.turnComplete) { events.push({kind:'turn_end',fenced:this.fenced}); this.fenced=false; }
      return events.map(event=>({epoch:this.epoch,messageId,receivedAtMs,streamSample:event.kind==='tool'?initialSample:this.samplesReceived,sampleRate:this.sampleRate,coDelivered:events.length>1,fields,...event}));
    }
  }
  root.InkGemini = { Adapter };
})(globalThis);
