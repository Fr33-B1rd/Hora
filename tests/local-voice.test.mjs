import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalRecognition} from '../public/local-recognition.mjs';
import {validateAudio,createSpeech} from '../lib/speech.mjs';
import {voiceCommand} from '../public/voice-core.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function setup(overrides={}){
  let stopped=0;const requests=[],recorders=[],events=[];
  const stream={getTracks:()=>[{stop(){stopped++;}}]};
  class Recorder{static isTypeSupported(t){return t.startsWith('audio/webm');}constructor(s,o){this.state='inactive';this.options=o;recorders.push(this);}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['x'.repeat(120)])});this.onstop();}}
  const Recognition=createLocalRecognition({getUserMedia:async()=>stream,Recorder,encode:async()=>Buffer.alloc(120).toString('base64'),fetcher:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({text:'Select the second plan'})};},...overrides});
  const r=new Recognition();r.onstart=()=>events.push('start');r.onend=()=>events.push('end');r.onerror=e=>events.push(e.error);r.onresult=e=>events.push(e.results[0][0].transcript);
  return {r,stream,requests,recorders,events,stopped:()=>stopped};
}
test('local recording releases microphone before uploading only to localhost, then yields final draft',async()=>{
  const f=setup();assert.equal(f.recorders.length,0);await f.r.start();assert.equal(f.stopped(),0);assert.equal(f.requests.length,0);
  f.r.stop();assert.ok(f.stopped()>0);await tick();assert.equal(f.requests[0].url,'/api/voice/transcribe');
  assert.equal(JSON.parse(f.requests[0].options.body).language,'en');assert.deepEqual(f.events,['start','Select the second plan','end']);
});
test('cancel during permission prompt releases a late stream and never records or uploads',async()=>{
  let grant;const f=setup({getUserMedia:()=>new Promise(r=>{grant=r;})});const started=f.r.start();f.r.abort();grant(f.stream);await started;
  assert.equal(f.recorders.length,0);assert.equal(f.requests.length,0);assert.equal(f.stopped(),1);
});
test('cancel during transcription aborts the request and suppresses late text',async()=>{
  let reply,signal;const f=setup({fetcher:(u,o)=>{signal=o.signal;return new Promise(r=>{reply=r;});}});await f.r.start();f.r.stop();await tick();f.r.abort();
  assert.equal(signal.aborted,true);reply({ok:true,json:async()=>({text:'Confirm write'})});await tick();assert.deepEqual(f.events,['start']);
});
test('recording permission and local service errors remain distinct',async()=>{
  const denied=setup({getUserMedia:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'});}});await denied.r.start();assert.deepEqual(denied.events,['not-allowed']);
  const broken=setup({fetcher:async()=>{throw Error();}});await broken.r.start();broken.r.stop();await tick();assert.deepEqual(broken.events,['start','local-network']);assert.ok(broken.stopped()>0);
});
test('local service bounds audio and languages without loading absent models',async()=>{
  const valid={audio:Buffer.alloc(100).toString('base64'),language:'en',mime:'audio/webm;codecs=opus'};
  assert.equal(validateAudio(valid).language,'en');
  for(const change of [{audio:'bad'},{audio:'A'.repeat(5600000)},{language:'xx'},{mime:'text/plain'}])assert.throws(()=>validateAudio({...valid,...change}));
  const service=createSpeech();assert.equal(service.status().configured,false);await assert.rejects(service.transcribe(valid),/not installed/);
  assert.deepEqual(voiceCommand('Select plan two.',[{id:'a'},{id:'b'}]),{type:'select',id:'b'});
  assert.deepEqual(voiceCommand('Select the second plan.',[{id:'a'},{id:'b'}]),{type:'select',id:'b'});
});
