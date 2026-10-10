import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReplyReader,protectState,seedState,readState,clockTimes,ungroundedTimes,everyReply,used,searchedWeb} from '../evals/harness.mjs';
import {cases} from '../evals/cases.mjs';

test('the stream reader collects text, started tools and usage across split chunks',()=>{
  const reader=createReplyReader();
  const stream=['event: hermes.tool.progress\ndata: {"tool": "terminal", "label": "python3 ~/.hermes/scripts/daylight_deals.py current", "status": "running"}\n\n',
    'event: hermes.tool.progress\ndata: {"tool": "terminal", "status": "completed"}\n\n',
    'data: {"choices": [{"delta": {"reasoning_content": "thinking"}}]}\n\n','data: {"choices": [{"delta": {"content": "Lax "}}]}\n\ndata: {"choi','ces": [{"delta": {"content": "79 kr"}}]}\n\n',
    'data: {"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1200}}\n\ndata: [DONE]\n\n'];
  for(const part of stream)reader.push(part);
  const reply=reader.done();
  assert.equal(reply.text,'Lax 79 kr');assert.equal(reply.tools.length,1);assert.equal(reply.usage.prompt_tokens,1200);
  assert.ok(used(reply,/daylight_deals\.py\s+current/));assert.equal(searchedWeb(reply),false);
});

test('the user’s state is put back exactly, including after an interrupted run, and absent files stay absent',async()=>{
  const home=await mkdtemp(join(tmpdir(),'daylight-eval-home-')),backup=join(await mkdtemp(join(tmpdir(),'daylight-eval-backup-')),'copy');
  try{
    await mkdir(join(home,'memories'),{recursive:true});await mkdir(join(home,'daylight'),{recursive:true});
    await writeFile(join(home,'memories/USER.md'),'User lives in Stockholm.');
    await writeFile(join(home,'daylight/deals.json'),JSON.stringify({seen:{a:1},likes:[],dislikes:[{label:'pork',terms:['fläsk']}],cache:{date:'2026-10-10',deals:[{title:'Laxfilé'}]}}));
    const guard=await protectState(home,backup);assert.equal(guard.recovered,false);
    const real=await readState(home);
    await seedState(home,{deals:{seen:real.deals.seen,cache:real.deals.cache},research:{}},{memory:['User is vegetarian.','User likes jazz.'],likes:[{label:'salmon',terms:['lax']}],topics:[{id:'rag',name:'retrieval augmented generation'}]});
    const seeded=await readState(home);
    assert.match(seeded.memory,/vegetarian\.\n§\nUser likes jazz/);assert.deepEqual(seeded.dislikes,[]);assert.equal(seeded.likes[0].label,'salmon');
    assert.deepEqual(seeded.offers,['Laxfilé']);assert.equal(seeded.topics[0].query,'all:retrieval AND all:augmented AND all:generation');
    // A second run starting while the first one's copy is still there restores it first.
    const second=await protectState(home,backup);assert.equal(second.recovered,true);
    assert.equal(await readFile(join(home,'memories/USER.md'),'utf8'),'User lives in Stockholm.');
    await seedState(home,{deals:{},research:{}},{memory:['changed']});
    assert.equal(await second.restore(),true);
    assert.equal(await readFile(join(home,'memories/USER.md'),'utf8'),'User lives in Stockholm.');
    assert.equal(JSON.parse(await readFile(join(home,'daylight/deals.json'),'utf8')).dislikes[0].label,'pork');
    assert.deepEqual((await readdir(join(home,'memories'))).sort(),['USER.md']);assert.deepEqual(await readdir(join(home,'daylight')),['deals.json']);
  }finally{await rm(home,{recursive:true,force:true});await rm(join(backup,'..'),{recursive:true,force:true});}
});

test('times in a reply are checked against what the planner produced',()=>{
  const record={request:{backBy:'17:00',activities:[{earliest:'12:30'}]},entry:{result:{plans:[{stops:[{start:668,end:728}],legs:[{depart:645,arrive:663}],homeAt:817}]}}};
  assert.deepEqual(clockTimes('Leave at 10:45, arrive 11.08; 3 kr, version 2.5'),['10:45','11:08']);
  assert.deepEqual(ungroundedTimes('Leave 10:45, museum 11:08–12:08, back 13:37, before 17:00.',record),[]);
  assert.deepEqual(ungroundedTimes('Museum at 11:00, back by 13:37.',record),['11:00']);
});

test('the checks on every reply catch chat-unfriendly output and leaked internals, and pass a plain answer',()=>{
  const problems=text=>everyReply.map(check=>check({text})).filter(Boolean);
  assert.deepEqual(problems('Lidl has salmon at 79 kr until Sunday.\n- Gurka 8,90 kr'),[]);
  assert.equal(problems('').length,1);assert.equal(problems('[SILENT]').length,1);
  assert.equal(problems('**Offers**\nGurka 8 kr').length,1);assert.equal(problems('## Offers').length,1);assert.equal(problems('| a | b |').length,1);
  assert.equal(problems('I ran daylight_deals.py for you.').length,1);assert.equal(problems('x'.repeat(1501)).length,1);
});

test('every case has a unique id, something to say and a check that reports problems as text',()=>{
  assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);assert.ok(cases.length>=20);
  const reply={text:'ok',tools:[],usage:null},state={memory:'',likes:[],dislikes:[],topics:[],offers:[]};
  for(const c of cases){
    assert.ok(c.turns.length&&c.turns.every(t=>t.say),c.id);
    const found=c.check({replies:c.turns.map(()=>reply),last:reply,state,before:state,plan:null});
    assert.ok(Array.isArray(found)&&found.every(p=>typeof p==='string'),c.id);
  }
  // A reply of just “ok” that leaves the seeded world untouched must not satisfy any case that requires an action.
  const untouched=c=>({...state,memory:(c.seed?.memory||[]).join(' '),likes:c.seed?.likes||[],dislikes:c.seed?.dislikes||[],topics:(c.seed?.topics||[]).map(t=>({...t,notes:[]}))});
  const lazy=cases.filter(c=>!c.check({replies:c.turns.map(()=>reply),last:reply,state:untouched(c),before:untouched(c),plan:null}).length).map(c=>c.id);
  assert.deepEqual(lazy,['small-talk']);
});
