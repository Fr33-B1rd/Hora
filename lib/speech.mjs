// Hearing: speech to text on this server, through one long-lived Python worker
// (lib/transcribe.py, faster-whisper). Nothing is sent to a speech service, and
// neither audio nor transcripts are logged.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function validateAudio({audio,mime}={}){
  if(typeof mime!=='string'||!/^audio\/(webm|ogg|mp4|wav|x-wav|mpeg)(;.*)?$/.test(mime))throw fail('This audio format is not supported.');
  if(typeof audio!=='string'||audio.length<40||audio.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)||audio.length%4)throw fail('The recording is empty or too long.');
  return audio;
}

export function createSpeech({python,model='base.en',hints='',worker=fileURLToPath(new URL('./transcribe.py',import.meta.url)),spawnWorker=spawn,exists=existsSync}={}){
  const configured=!!python&&exists(python);
  let child=null,ready=false,boot=null,pending=null,busy=false,lastError='';
  function stop(message){
    ready=false;lastError=message;
    const proc=child;child=null;proc?.kill();
    if(boot){clearTimeout(boot.timer);boot.reject(fail(message,503));boot=null;}
    if(pending){clearTimeout(pending.timer);pending.reject(fail(message,503));pending=null;}
  }
  function start(){
    if(!configured)return Promise.reject(fail('Voice input is not set up on this server.',503));
    if(ready)return Promise.resolve();
    if(boot)return boot.promise;
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});
    boot={promise,resolve,reject,timer:setTimeout(()=>stop('Voice input took too long to start.'),90000)};
    lastError='';let buffer='';
    const proc=spawnWorker(python,['-u',worker,model],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});child=proc;
    proc.stderr.on('data',()=>{}); // never log audio, transcripts or paths
    proc.stdin.on('error',()=>{if(child===proc)stop('Voice input stopped unexpectedly.');});
    proc.on('error',()=>{if(child===proc)stop('Voice input could not be started on this server.');});
    proc.on('exit',()=>{if(child===proc)stop('Voice input stopped unexpectedly.');});
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data',chunk=>{
      if(child!==proc)return;buffer+=chunk;
      let index;while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;let value;
        try{value=JSON.parse(line);}catch{continue;} // a library's stray line, not an answer
        if(value.ready&&boot){ready=true;clearTimeout(boot.timer);boot.resolve();boot=null;}
        else if(boot&&value.error){stop(value.error);return;}
        else if(pending){const p=pending;pending=null;clearTimeout(p.timer);value.error?p.reject(fail(value.error)):p.resolve(value);}
      }
    });
    return promise;
  }
  return {
    status:()=>({configured,ready,model:configured?model:null,error:lastError}),
    warm:()=>start().catch(()=>{}),
    async transcribe(input){
      const audio=validateAudio(input);
      if(busy)throw fail('Still working on the previous recording. Try again in a moment.',429);
      busy=true;
      try{
        await start();
        return await new Promise((resolve,reject)=>{
          pending={resolve,reject,timer:setTimeout(()=>stop('Voice input took too long. Try a shorter sentence.'),45000)};
          child.stdin.write(JSON.stringify({audio,hints:String(input.hints||hints).slice(0,600)})+'\n');
        });
      }finally{busy=false;}
    },
    close(){stop('Voice input was shut down.');}
  };
}
