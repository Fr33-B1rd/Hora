import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runAgent} from '../lib/agent.mjs';
import {agentSkills} from '../lib/agent-skills.mjs';
import {translateTitles} from '../lib/local-news.mjs';
import {validateAudio} from '../lib/speech.mjs';
import {hasTimeAnchor} from '../lib/time-anchors.mjs';
const config={base:'https://fixture.invalid',key:'fixture',model:'fixture'};
const response=(name,args)=>({ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'fixture',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})});

test('English multi-turn state preserves Swedish names, unlimited meaning and later corrections',async()=>{
 const origin='Östermalmstorg',activity={id:'museum',label:'Visit a museum',query:'museum near Östermalmstorg',requiredNames:[],duration:60,allowance:null,availability:'venue',eventRef:null,windowStart:null,windowEnd:null,windowQuote:null};
 const texts=['Start at Östermalmstorg, visit a museum; no budget limit or return deadline. Just remember this.', 'Cap spending at 500 SEK and total walking at 10 minutes.', 'Remind me what you saved.'];
 const patches=[{origin,originQuote:texts[0],activities:[activity],budgetMode:'unlimited',budget:null,timeMode:'flexible',deadline:null},{budgetMode:'limited',budget:500,maxWalking:10},{}];
 let slots={},history=[];const requests=[];
 for(let i=0;i<texts.length;i++){
  const result=await runAgent({text:texts[i],slots,history},config,{}, {fetchImpl:async(url,opts)=>{
   const req=JSON.parse(opts.body);requests.push(req);
   assert.match(req.messages[0].content,/English/);assert.doesNotMatch(req.messages[0].content,/\p{Script=Han}/u);
   if(req.tools[0].function.name==='commit_turn'){
    const trip=JSON.parse(req.messages[0].content.split('Interpretation context (data):\n').at(-1)).trip;
    const patch={...Object.fromEntries(['budgetMode','budget','timeMode','start','deadline'].map(k=>[k,trip[k]])),...patches[i]};
    return response('commit_turn',{intent:'update',patch,sources:Object.keys(patches[i]).filter(k=>k!=='originQuote').map(field=>({field,messageIndices:[i]})),assumptions:[],categories:[]});
   }
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Your starting point is Östermalmstorg. Your museum visit is saved.'}}]})};
  }});
  assert.equal(result.stopReason,'finished');slots=result.slots;
  assert.equal(slots.origin,origin);assert.equal(slots.deadline,null);
  assert.equal(slots.budgetMode,i===0?'unlimited':'limited');assert.equal(slots.budget,i===0?null:500);
  history.push({role:'user',content:texts[i]},{role:'assistant',content:result.message});
 }
 assert.equal(slots.maxWalking,10);assert.equal(requests.length,6);
 const catalog=await agentSkills();assert.doesNotMatch(JSON.stringify(catalog),/\p{Script=Han}/u);
});

test('English title translation keeps source names, URLs and dates independent of translated text',async()=>{
 const card={title:'Nytt vid Hötorget',url:'https://www.svt.se/nyheter/lokalt/stockholm/fixture',publishedAt:'2026-10-09T09:00:00Z',context:'Östermalmstorg'};
 const translated=await translateTitles([card],config,{fetchImpl:async(url,opts)=>{
  const req=JSON.parse(opts.body);assert.match(req.messages[0].content,/English headlines/);assert.match(req.messages[0].content,/Preserve Swedish proper names/);assert.match(req.messages[1].content,/Hötorget/);
  return response('translate_titles',{titles:['News at Hötorget']});
 }});
 assert.equal(translated[0].title,card.title);assert.equal(translated[0].url,card.url);assert.equal(translated[0].publishedAt,card.publishedAt);assert.equal(translated[0].translatedTitle,'News at Hötorget');
});

test('speech defaults to English and Swedish place names are not time anchors',()=>{
 const audio={audio:Buffer.alloc(100).toString('base64'),mime:'audio/webm'};
 assert.equal(validateAudio(audio).language,'en');assert.throws(()=>validateAudio({...audio,language:'zh'}),/English/);
 assert.equal(hasTimeAnchor('Östermalmstorg and Hötorget'),false);assert.equal(hasTimeAnchor('Visit Hötorget in the afternoon'),true);
 const ui=readFileSync(new URL('../public/voice-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/daylight-chat-en-v1/);assert.match(ui,/option value="en-GB"/);assert.doesNotMatch(ui,/option value="zh/);
});
