import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {generateKeyPairSync,createVerify} from 'node:crypto';
import {validateAudio,createSpeech} from '../lib/speech.mjs';
import {acceptable,plainLine,closingQuestion,spokenLine,createGoogleSpeech,waitingPhrase,acknowledgements} from '../lib/voice.mjs';

const clip=Buffer.alloc(600,7).toString('base64');
// A stand-in for the Python worker: says it is ready, then answers each request line.
function worker(answer=request=>({text:'any jobs for me today',seconds:1.9}),{ready=true}={}){
  const spawned=[];
  const spawnWorker=(python,args)=>{
    const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stdout.setEncoding=()=>{};proc.stderr=new EventEmitter();proc.killed=false;proc.kill=()=>{proc.killed=true;};
    proc.stdin=new EventEmitter();proc.stdin.write=line=>{const request=JSON.parse(line);spawned.at(-1).requests.push(request);setImmediate(()=>proc.stdout.emit('data',JSON.stringify(answer(request))+'\n'));};
    spawned.push({python,args,proc,requests:[]});
    setImmediate(()=>proc.stdout.emit('data','a stray library line\n'+JSON.stringify(ready?{ready:true}:{error:'The speech model could not be loaded on this server.'})+'\n'));
    return proc;
  };
  return {spawned,spawnWorker};
}

test('a recording is checked before it reaches the listener',()=>{
  assert.equal(validateAudio({audio:clip,mime:'audio/webm;codecs=opus'}),clip);
  assert.throws(()=>validateAudio({audio:clip,mime:'video/mp4'}),/format/);
  assert.throws(()=>validateAudio({audio:'short',mime:'audio/webm'}),/empty or too long/);
  assert.throws(()=>validateAudio({audio:'!'.repeat(80),mime:'audio/webm'}),/empty or too long/);
  assert.throws(()=>validateAudio({audio:'A'.repeat(2800004),mime:'audio/webm'}),/empty or too long/);
});

test('the listener starts once, passes the hints, answers in turn and reports when it is not set up',async()=>{
  const w=worker(),speech=createSpeech({python:'/venv/bin/python',model:'base.en',spawnWorker:w.spawnWorker,exists:()=>true});
  assert.deepEqual(speech.status(),{configured:true,ready:false,model:'base.en',error:''});
  assert.deepEqual(await speech.transcribe({audio:clip,mime:'audio/webm',hints:'Slussen, Fridhemsplan'}),{text:'any jobs for me today',seconds:1.9});
  await speech.transcribe({audio:clip,mime:'audio/webm'});
  assert.equal(w.spawned.length,1);assert.deepEqual(w.spawned[0].args.slice(-1),['base.en']);
  assert.equal(w.spawned[0].requests[0].hints,'Slussen, Fridhemsplan');assert.equal(w.spawned[0].requests[0].audio,clip);assert.equal(speech.status().ready,true);
  speech.close();assert.equal(w.spawned[0].proc.killed,true);
  const off=createSpeech({python:'',spawnWorker:w.spawnWorker});
  assert.equal(off.status().configured,false);await assert.rejects(off.transcribe({audio:clip,mime:'audio/webm'}),e=>e.status===503&&/not set up/.test(e.message));
  const broken=worker(undefined,{ready:false}),bad=createSpeech({python:'/p',spawnWorker:broken.spawnWorker,exists:()=>true});
  await assert.rejects(bad.transcribe({audio:clip,mime:'audio/webm'}),/could not be loaded/);
  const misheard=createSpeech({python:'/p',spawnWorker:worker(()=>({error:'That recording could not be read. Please try again.'})).spawnWorker,exists:()=>true});
  await assert.rejects(misheard.transcribe({audio:clip,mime:'audio/webm'}),/could not be read/);
});

const written='Lidl Sverige’s weekly offers:\n- Kiwi gold 16 kr (was 29.70), until 11 Oct\n- Zucchini 11 kr, until 11 Oct\n28 more offers exist.\nLeft out 15 pork items, as you asked.';
test('a spoken line may not bring in a number, a link or markup the written answer lacks',()=>{
  assert.equal(acceptable('I found this week’s offers and left out the pork. Want the full list?',written),'I found this week’s offers and left out the pork. Want the full list?');
  assert.equal(acceptable('There are 28 more offers.',written),'There are 28 more offers.');
  assert.equal(acceptable('Kiwi is 12 kr this week.',written),null);
  assert.equal(acceptable('See https://lidl.se for more.',written),null);assert.equal(acceptable('**Offers** are up.',written),null);
  assert.equal(acceptable('x'.repeat(261),written),null);assert.equal(acceptable('  ',written),null);
});

test('without a model, or when its line is refused, a plain honest line is used; a question is spoken as the question',async()=>{
  assert.equal(plainLine(written),'Here’s what I found. The details are on the screen.');
  assert.equal(plainLine('Noted, no pork from now on.'),'Noted, no pork from now on.');
  // A question to the user is spoken word for word, and no model is asked to rephrase it.
  const proposal='I’d add “Meeting with Anna” tomorrow from 10:00 to 11:00. It overlaps with Board meeting. Shall I add it anyway?';
  assert.equal(closingQuestion(proposal),'The details are on the screen. Shall I add it anyway?');assert.equal(closingQuestion('Where will you start from?'),'Where will you start from?');assert.equal(closingQuestion('Added.'),null);
  let asked=0;const never={fetchImpl:async()=>{asked++;throw Error('must not be called');}};
  assert.deepEqual(await spokenLine({asked:'add it',written:proposal},{key:'k',base:'https://model.test/v1',model:'m'},never),{line:'The details are on the screen. Shall I add it anyway?',by:'rule'});assert.equal(asked,0);
  assert.deepEqual(await spokenLine({asked:'hi',written:'Hello! Nice to hear from you.'},null),{line:'Hello! Nice to hear from you.',by:'rule'});
  const reply=content=>({fetchImpl:async(url,options)=>{reply.sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content}}]})};}});
  const model={key:'k',base:'https://model.test/v1/',model:'nemotron'};
  assert.deepEqual(await spokenLine({asked:'offers?',written},model,reply('“I found this week’s offers and left out the pork.”')),{line:'I found this week’s offers and left out the pork.',by:'model'});
  assert.match(reply.sent.messages[0].content,/Never state anything that is not in the written answer/);assert.match(reply.sent.messages[1].content,/Kiwi gold 16 kr/);
  assert.equal((await spokenLine({asked:'offers?',written},model,reply('Kiwi is only 9 kr!'))).by,'rule');
  assert.equal((await spokenLine({asked:'offers?',written},model,{fetchImpl:async()=>{throw Error('offline');}})).line,'Here’s what I found. The details are on the screen.');
});

test('every progress step has something to say, and the acknowledgements are short',()=>{
  assert.equal(waitingPhrase('mcp__daylight__job_matches'),'I’m going through the job postings.');assert.equal(waitingPhrase('memory'),'Still working on it.');assert.equal(waitingPhrase(undefined),'Still working on it.');
  assert.ok(acknowledgements.length>=3&&acknowledgements.every(a=>a.length<=30));
});

test('the voice signs in with the service account, speaks a short line once and reuses it, and explains refusals',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const calls=[];let status=200;
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(url.includes('oauth2')){
      const assertion=new URLSearchParams(options.body.toString()).get('assertion'),[head,claims,signature]=assertion.split('.');
      assert.ok(createVerify('RSA-SHA256').update(head+'.'+claims).verify(publicKey,signature,'base64url'));
      const claim=JSON.parse(Buffer.from(claims,'base64url'));assert.equal(claim.iss,'voice@project.iam.gserviceaccount.com');assert.equal(claim.exp-claim.iat,3600);assert.match(claim.scope,/cloud-platform/);
      return {ok:true,json:async()=>({access_token:'token-1',expires_in:3600})};
    }
    return status===200?{ok:true,status,json:async()=>({audioContent:'TVAz'})}:{ok:false,status,json:async()=>({})};
  };
  const voice=createGoogleSpeech({credentials:{client_email:'voice@project.iam.gserviceaccount.com',private_key:privateKey},voice:'en-GB-Chirp3-HD-Aoede',fetchImpl});
  assert.deepEqual(voice.status(),{configured:true,voice:'en-GB-Chirp3-HD-Aoede',error:''});
  assert.equal(await voice.say('  On it. '),'TVAz');assert.equal(await voice.say('On it.'),'TVAz');assert.equal(await voice.say('Let me check.'),'TVAz');
  assert.equal(calls.filter(c=>c.url.includes('oauth2')).length,1);assert.equal(calls.filter(c=>c.url.includes('texttospeech')).length,2);
  const sent=JSON.parse(calls[1].options.body);assert.deepEqual(sent.voice,{languageCode:'en-GB',name:'en-GB-Chirp3-HD-Aoede'});assert.equal(sent.input.text,'On it.');assert.equal(calls[1].options.headers.Authorization,'Bearer token-1');
  await assert.rejects(voice.say('x'.repeat(301)),/short line/);await assert.rejects(voice.say(' '),/short line/);
  status=403;await assert.rejects(voice.say('Something new.'),/not enabled for this project/);
  const off=createGoogleSpeech({});assert.equal(off.status().configured,false);await assert.rejects(off.say('On it.'),e=>e.status===503);
  assert.match(createGoogleSpeech({credentialsFile:'/no/such/file.json'}).status().error,/could not be read/);
});
