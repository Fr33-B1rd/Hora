import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readProfile,editMemory,editFood,removeTopic,listJobs,jobAction,describeSchedule} from '../lib/profile.mjs';

async function home(){
  const dir=await mkdtemp(join(tmpdir(),'daylight-profile-'));
  await mkdir(join(dir,'memories'));await mkdir(join(dir,'daylight'));
  await writeFile(join(dir,'memories/USER.md'),'User hates pork.\n§\nUser works on agent evaluation.');
  await writeFile(join(dir,'daylight/deals.json'),JSON.stringify({seen:{'1@2026-10-05':'2026-10-10'},likes:[{label:'mango',terms:['mango'],since:'2026-10-10'}],dislikes:[],cache:{date:'2026-10-10',deals:[]}}));
  await writeFile(join(dir,'daylight/research.json'),JSON.stringify({topics:[{id:'rag',name:'retrieval-augmented generation',query:'all:rag',notes:['skip surveys'],added:'2026-10-10'}],seen:{x:'2026-10-10'},lastBatch:{date:'2026-10-10'}}));
  return dir;
}

test('the profile shows memory, food preferences and research topics from the files the assistant uses',async()=>{
  const dir=await home();
  try{
    const p=await readProfile(dir);
    assert.deepEqual(p.memory.user.entries,['User hates pork.','User works on agent evaluation.']);assert.equal(p.memory.user.limit,1375);assert.deepEqual(p.memory.notes.entries,[]);
    assert.deepEqual(p.food.likes.map(l=>l.label),['mango']);assert.equal(p.food.offersChecked,'2026-10-10');
    assert.deepEqual(p.research.topics.map(t=>[t.id,t.notes]),[['rag',['skip surveys']]]);assert.equal(p.research.lastDigest,'2026-10-10');
    const empty=await mkdtemp(join(tmpdir(),'daylight-empty-'));
    try{assert.deepEqual((await readProfile(empty)).food,{likes:[],dislikes:[],offersChecked:null});}finally{await rm(empty,{recursive:true});}
  }finally{await rm(dir,{recursive:true});}
});

test('memory entries can be added and removed; a stale removal or an overfull memory is refused',async()=>{
  const dir=await home();
  try{
    await editMemory(dir,{file:'user',action:'add',text:'  Prefers   morning\nappointments § '});
    assert.equal(await readFile(join(dir,'memories/USER.md'),'utf8'),'User hates pork.\n§\nUser works on agent evaluation.\n§\nPrefers morning appointments');
    await assert.rejects(editMemory(dir,{file:'user',action:'remove',index:0,text:'User loves pork.'}),{status:409});
    await editMemory(dir,{file:'user',action:'remove',index:0,text:'User hates pork.'});
    assert.deepEqual((await readProfile(dir)).memory.user.entries,['User works on agent evaluation.','Prefers morning appointments']);
    await assert.rejects(editMemory(dir,{file:'user',action:'add',text:'x'.repeat(301)}),/1–300/);
    for(let i=0;i<4;i++)await editMemory(dir,{file:'user',action:'add',text:String(i).repeat(290)});
    await assert.rejects(editMemory(dir,{file:'user',action:'add',text:'9'.repeat(290)}),/Memory is full/);
    await assert.rejects(editMemory(dir,{file:'secrets',action:'add',text:'x'}),/Unknown memory file/);
  }finally{await rm(dir,{recursive:true});}
});

test('food preferences are stored in the tracker’s own format without disturbing what was already sent',async()=>{
  const dir=await home();
  try{
    await editFood(dir,{action:'add',kind:'dislikes',label:'Pork',terms:'fläsk, Bacon ,kotlett'});
    await editFood(dir,{action:'add',kind:'dislikes',label:'mango'});  // moving a like to a dislike replaces it
    const state=JSON.parse(await readFile(join(dir,'daylight/deals.json'),'utf8'));
    assert.deepEqual(state.dislikes.map(p=>[p.label,p.terms]),[['Pork',['bacon','fläsk','kotlett','pork']],['mango',['mango']]]);assert.deepEqual(state.likes,[]);
    assert.deepEqual(state.seen,{'1@2026-10-05':'2026-10-10'});assert.equal(state.cache.date,'2026-10-10');
    await editFood(dir,{action:'remove',label:'pork'});
    assert.deepEqual((await readProfile(dir)).food.dislikes.map(p=>p.label),['mango']);
    await assert.rejects(editFood(dir,{action:'add',kind:'neutral',label:'x'}),/Unknown action/);
  }finally{await rm(dir,{recursive:true});}
});

test('a research topic can be removed once; the list of seen papers is kept',async()=>{
  const dir=await home();
  try{
    await removeTopic(dir,{id:'rag'});
    const state=JSON.parse(await readFile(join(dir,'daylight/research.json'),'utf8'));
    assert.deepEqual(state.topics,[]);assert.deepEqual(state.seen,{x:'2026-10-10'});
    await assert.rejects(removeTopic(dir,{id:'rag'}),{status:409});
  }finally{await rm(dir,{recursive:true});}
});

test('scheduled jobs are listed in plain terms and can only be paused, resumed or run',async()=>{
  const hermes={url:'http://hermes.invalid',key:'k'},calls=[];
  const job={id:'dbf8ed3e98e6',name:'daylight-research-feed',schedule:{expr:'0 8 * * *'},deliver:'telegram',enabled:true,state:'scheduled',next_run_at:'2026-10-11T08:00:00+08:00',last_run_at:null,last_status:'ok',latest_execution:{delivery_outcome:'delivered'}};
  const fetchImpl=async(url,opts={})=>{calls.push([opts.method||'GET',url,opts.headers.Authorization]);return {ok:true,json:async()=>({jobs:[job,{...job,id:'67dca12a5ac6',name:'something-else',schedule:{expr:'*/5 * * * *'},enabled:false,state:'paused'},{...job,id:'08efdc70b13f',name:'one-off',state:'completed',enabled:false}]})};};
  const {jobs,error}=await listJobs(hermes,{fetchImpl});
  assert.equal(error,null);assert.equal(calls[0][1],'http://hermes.invalid/api/jobs?include_disabled=true');assert.equal(jobs[0].deliver,'Telegram');assert.deepEqual(jobs.map(j=>[j.title,j.schedule,j.paused,j.lastOutcome]),[['Research digest','Every day at 08:00',false,'delivered'],['something-else','*/5 * * * *',true,'delivered']]);
  assert.equal(describeSchedule('30 7 * * *'),'Every day at 07:30');
  await jobAction(hermes,{id:'dbf8ed3e98e6',action:'pause'},{fetchImpl});
  assert.deepEqual(calls.at(-1),['POST','http://hermes.invalid/api/jobs/dbf8ed3e98e6/pause','Bearer k']);
  await assert.rejects(jobAction(hermes,{id:'dbf8ed3e98e6',action:'delete'},{fetchImpl}),/Unknown job or action/);
  await assert.rejects(jobAction(hermes,{id:'../x',action:'run'},{fetchImpl}),/Unknown job or action/);
  assert.match((await listJobs(hermes,{fetchImpl:async()=>{throw Error('down');}})).error,/not running/);
  assert.match((await listJobs({url:'x',key:''})).error,/not configured/);
});
