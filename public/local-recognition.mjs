// SpeechRecognition-compatible adapter backed only by this localhost server.
// No browser cloud recognition and no automatic cloud fallback.
export function createLocalRecognition({getUserMedia,Recorder,fetcher=fetch,encode=blobToBase64}={}){
  if(!getUserMedia||!Recorder)return undefined;
  return class LocalRecognition {
    lang='en-GB';closed=false;stream=null;recorder=null;request=null;chunks=[];size=0;
    async start(){
      try{
        const stream=await getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
        if(this.closed){stream.getTracks().forEach(t=>t.stop());return;}
        this.stream=stream;
        const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>Recorder.isTypeSupported(t));
        if(!mime)throw Error('format');
        const r=new Recorder(stream,{mimeType:mime,audioBitsPerSecond:64000});this.recorder=r;
        r.ondataavailable=e=>{if(this.closed||!e.data.size)return;this.size+=e.data.size;if(this.size>4*1024*1024){this.error('audio-too-large');return;}this.chunks.push(e.data);};
        r.onerror=()=>this.error('audio-capture');
        r.onstop=()=>{this.release();void this.transcribe(mime);};
        r.start(250);this.onstart?.();
      }catch(e){if(!this.closed)this.error(e.name==='NotAllowedError'?'not-allowed':e.name==='NotFoundError'?'audio-capture':'local-recording');}
    }
    release(){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;}
    stop(){if(this.closed)return;if(!this.recorder){this.abort();this.onend?.();return;}if(this.recorder.state!=='inactive')this.recorder.stop();this.release();}
    abort(){this.closed=true;this.request?.abort();this.request=null;if(this.recorder?.state==='recording')this.recorder.stop();this.release();this.chunks=[];}
    error(error,message){this.abort();this.onerror?.({error,message});}
    async transcribe(mime){
      if(this.closed)return;
      const blob=new Blob(this.chunks,{type:mime});this.chunks=[];
      if(blob.size<100){this.error('no-speech');return;}
      const request=new AbortController();this.request=request;
      try{
        const audio=await encode(blob);if(this.closed)return;
        const response=await fetcher('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio,mime,language:this.lang.split('-')[0]}),signal:request.signal});
        const value=await response.json();if(this.closed)return;
        if(!response.ok){this.error('local-transcription',value.error);return;}
        if(!value.text?.trim()){this.error('no-speech');return;}
        this.onresult?.({results:[Object.assign([{transcript:value.text}],{isFinal:true})]});
        this.closed=true;this.request=null;this.onend?.();
      }catch{if(!this.closed)this.error('local-network');}
    }
  };
}
function blobToBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});}
