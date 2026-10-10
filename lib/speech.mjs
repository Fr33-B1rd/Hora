import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export function validateAudio({audio,language='en',mime}={}){
  if(language!=='en')throw Error('This version supports English speech input.');
  if(typeof mime!=='string'||!/^audio\/(webm|ogg|mp4|wav|x-wav|mpeg)(;.*)?$/.test(mime))throw Error('This audio format is not supported.');
  if(typeof audio!=='string'||audio.length<40||audio.length>5592408||!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)||audio.length%4)throw Error('The recording is empty or too large, please use 60  seconds.');
  const bytes=Buffer.from(audio,'base64');
  if(bytes.length>4*1024*1024||bytes.toString('base64')!==audio)throw Error('Recording format or size incorrect.');
  return {audio,language};
}

export function createSpeech({python,modelDir,worker=fileURLToPath(new URL('./transcribe.py',import.meta.url)),spawnWorker=spawn}={}){
  const configured=!!python&&!!modelDir&&existsSync(python)&&existsSync(join(modelDir,'model.bin'));
  let child,ready=false,boot,pending,busy=false,lastError='';
  function fail(message){
    ready=false;lastError=message;
    const proc=child;child=null;proc?.kill();
    if(boot){clearTimeout(boot.timer);boot.reject(Error(message));boot=null;}
    if(pending){clearTimeout(pending.timer);pending.reject(Error(message));pending=null;}
  }
  function start(){
    if(!configured)return Promise.reject(Error('Local speech is not installed; run  setup-voice.ps1。'));
    if(ready)return Promise.resolve();
    if(boot)return boot.promise;
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    boot={promise,resolve,reject,timer:setTimeout(()=>fail('Native voice startup timeout, please retry.'),60000)};
    lastError='';let buffer='';
    const proc=spawnWorker(python,['-u',worker,modelDir],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,HF_HUB_OFFLINE:'1',PYTHONIOENCODING:'utf-8'}});child=proc;
    proc.stderr.on('data',()=>{}); // Do not log audio, transcripts, or local paths.
    proc.stdin.on('error',()=>{if(child===proc)fail('Native voice service interrupted, please retry.');});
    proc.on('error',()=>{if(child===proc)fail('Unable to start native voice component.');});
    proc.on('exit',()=>{if(child===proc)fail('Native voice service exited, please retry.');});
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data',chunk=>{
      if(child!==proc)return;buffer+=chunk;
      let index;while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let value;
        try{value=JSON.parse(line);}catch{fail('Native voice returned unreadable result.');return;}
        if(value.ready&&boot){ready=true;clearTimeout(boot.timer);boot.resolve();boot=null;}
        else if(boot){fail(value.error||'Native voice load failed.');return;}
        else if(pending){const p=pending;pending=null;clearTimeout(p.timer);value.error?p.reject(Error(value.error)):p.resolve(value);}
      }
    });
    return promise;
  }
  return {
    status:()=>({provider:'local',configured,ready,busy,error:lastError}),
    warm:()=>start(),
    async transcribe(input,signal){
      const valid=validateAudio(input);
      if(busy)throw Error('Another recording is being transcribed, please try again later.');
      if(signal?.aborted)throw Error('Transcription cancelled.');
      busy=true;const abort=()=>fail('Transcription cancelled.');signal?.addEventListener('abort',abort,{once:true});
      try{
        await start();if(signal?.aborted)throw Error('Transcription cancelled.');
        const result=await new Promise((resolve,reject)=>{
          pending={resolve,reject,timer:setTimeout(()=>fail('Native transcription timeout, please use a shorter recording.'),120000)};
          child.stdin.write(JSON.stringify(valid)+'\n');
        });
        return {...result,provider:'local'};
      }finally{busy=false;signal?.removeEventListener('abort',abort);}
    },
    close(){fail('Native voice service closed.');}
  };
}
