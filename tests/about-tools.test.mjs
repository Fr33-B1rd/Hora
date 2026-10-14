import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {aboutHora,aboutTools,aboutHandlers} from '../mcp/about-tools.mjs';

const jobs=[{name:'daylight-research-feed'},{name:'daylight-grocery-deals'},{name:'daylight-job-matches'}].map((j,i)=>({id:'j'+i,...j}));
async function home(files={}){
  const dir=await mkdtemp(join(tmpdir(),'daylight-about-'));
  await mkdir(join(dir,'daylight'),{recursive:true});await mkdir(join(dir,'cron'),{recursive:true});
  for(const [name,value] of Object.entries(files))await writeFile(join(dir,name),JSON.stringify(value));
  return dir;
}
const by=(r,name)=>r.abilities.find(a=>a.name===name);

test('the tool is declared with a handler and takes no input',()=>{
  assert.deepEqual(aboutTools.map(t=>t.name),Object.keys(aboutHandlers));assert.deepEqual(aboutTools[0].inputSchema.properties,{});
});

test('a fresh install says who she is and, for each thing not set up, the one step that sets it up',async()=>{
  const dir=await home({'cron/jobs.json':{jobs}});
  try{
    const r=await aboutHora({home:dir,calendarConnected:()=>false,page:'https://hora.example'});
    assert.equal(r.name,'Hora');assert.equal(r.abilities.length,7);
    assert.match(by(r,'Job watch').setUp,/upload your CV on the web page \(https:\/\/hora\.example/);assert.equal(by(r,'Job watch').ready,false);
    assert.match(by(r,'Research digest').setUp,/Track new papers on/);assert.match(by(r,'Calendar').setUp,/connect Google Calendar/);
    assert.equal(by(r,'Day planner').ready,true);assert.ok(r.abilities.every(a=>a.try.length));
    const guide=r.howToAnswer.join(' ');assert.match(guide,/as Hora/);assert.match(guide,/Do not list your general tools/);assert.match(guide,/In a group chat, leave out/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('what is set up is reported as ready, with what it is doing now; a paused job is not ready',async()=>{
  const dir=await home({'cron/jobs.json':{jobs:jobs.map(j=>j.name==='daylight-grocery-deals'?{...j,enabled:false}:j)},
    'daylight/research.json':{topics:[{id:'rag',name:'retrieval-augmented generation'}]},
    'daylight/deals.json':{dislikes:[{label:'pork'}],likes:[{label:'salmon'}]},
    'daylight/jobs.json':{cv:{name:'cv.pdf',text:'…'},prefs:{roles:['data scientist']}}});
  try{
    const r=await aboutHora({home:dir,calendarConnected:()=>true});
    assert.equal(by(r,'Job watch').ready,true);assert.equal(by(r,'Job watch').setUp,null);
    assert.equal(by(r,'Research digest').now,'following retrieval-augmented generation');
    assert.equal(by(r,'Grocery offers').now,'avoiding pork; favouring salmon');assert.equal(by(r,'Grocery offers').ready,false);
    assert.equal(by(r,'Calendar').ready,true);
  }finally{await rm(dir,{recursive:true,force:true});}
  const cvOnly=await home({'cron/jobs.json':{jobs},'daylight/jobs.json':{cv:{name:'cv',text:'x'},prefs:{roles:[]}}});
  try{assert.match(by(await aboutHora({home:cvOnly,calendarConnected:()=>false}),'Job watch').setUp,/tell me the kind of role/);}finally{await rm(cvOnly,{recursive:true,force:true});}
});
