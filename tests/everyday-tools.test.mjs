import test from 'node:test';
import assert from 'node:assert/strict';
import {groceryOffers,foodPreference,researchTopics,findTopic,everydayTools,everydayHandlers} from '../mcp/everyday-tools.mjs';

// A stand-in for the job scripts: records each call and answers like the real ones.
const scripts=(state={})=>{
  const calls=[],prefs={likes:[],dislikes:[],...state.prefs},topics=[...(state.topics||[])];
  const run=async(name,args)=>{
    calls.push([name,...args].join(' '));const [command,...rest]=args;
    if(name==='daylight_deals.py'){
      if(command==='current')return state.current||{date:'2026-10-10',offers:[],moreNotShown:0,leftOut:[],likes:[],dislikes:[],screenedByModel:false};
      if(command==='prefs')return prefs;
      if(command==='forget'){const before=prefs.likes.length+prefs.dislikes.length;for(const k of ['likes','dislikes'])prefs[k]=prefs[k].filter(p=>p.label!==rest[0]);return {forgot:rest[0],found:before!==prefs.likes.length+prefs.dislikes.length};}
      const kind=command==='like'?'likes':'dislikes',terms=[...new Set([rest[0].toLowerCase(),...(rest[2]||'').split(',').filter(Boolean)])].sort();
      prefs[kind].push({label:rest[0],terms});return {[kind]:prefs[kind]};
    }
    if(command==='list')return {topics};
    if(command==='add'){const t={id:rest[0].toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:rest[0],notes:[],added:'2026-10-10'};topics.push(t);return {added:t};}
    if(command==='remove'){topics.splice(topics.findIndex(t=>t.id===rest[0]),1);return {removed:rest[0]};}
    if(command==='note'){const t=topics.find(t=>t.id===rest[0]);t.notes.push(rest[1]);return {topic:t.name,notes:t.notes};}
    throw Error('unexpected '+command);
  };
  return {run,calls,prefs,topics};
};
const rag={id:'retrieval-augmented-generation',name:'retrieval-augmented generation',notes:[],added:'2026-10-01'};
const agents={id:'evaluating-llm-agents',name:'evaluating LLM agents',notes:[],added:'2026-10-02'};

test('every everyday tool has a handler and none can spend, book or write a calendar',()=>{
  assert.deepEqual(everydayTools.map(t=>t.name).sort(),Object.keys(everydayHandlers).sort());
  for(const tool of everydayTools){assert.equal(tool.inputSchema.additionalProperties,false);assert.doesNotMatch(tool.name,/book|pay|buy|calendar|schedule/);}
});

test('offers come back compact, liked first as the script ordered them, with what was left out and how to answer',async()=>{
  const s=scripts({current:{date:'2026-10-10',offers:[{title:'Laxfilé',price:79,was:99,percentOff:20,until:'2026-10-18',youLike:'salmon',category:'Fisk',link:'x',id:'1'},{title:'Purjolök',price:4.9,percentOff:50,needsLidlPlus:true,until:'2026-10-18'}],moreNotShown:28,leftOut:[{reason:'pork',count:3,examples:['Bacon']}],likes:['salmon'],dislikes:['pork'],screenedByModel:true}});
  const r=await groceryOffers({},s.run);
  assert.deepEqual(s.calls,['daylight_deals.py current --limit 8']);
  assert.deepEqual(r.offers[0],{name:'Laxfilé',priceKr:79,wasKr:99,percentOff:20,until:'2026-10-18',userLikes:'salmon'});
  assert.equal(r.offers[1].needsLidlPlus,true);assert.equal(r.moreNotShown,28);assert.deepEqual(r.leftOutForThisUser,[{because:'pork',count:3,examples:['Bacon']}]);
  assert.equal(r.preferencesApplied.rememberedFactsChecked,true);
  const guide=r.howToAnswer.join(' ');assert.match(guide,/no markdown/);assert.match(guide,/28 more/);assert.match(guide,/left out/);assert.doesNotMatch(guide,/NOT checked/);
});

test('when the small model could not check remembered facts the main model is told to; a search passes the word through',async()=>{
  const s=scripts();const r=await groceryOffers({find:'kyckling',limit:3},s.run);
  assert.deepEqual(s.calls,['daylight_deals.py current --limit 3 --find kyckling']);
  assert.match(r.howToAnswer.join(' '),/NOT checked/);assert.match(r.howToAnswer.join(' '),/Nothing matched/);
  assert.equal((await groceryOffers({},async()=>({error:'Could not read Lidl'}))).status,'unavailable');
});

test('a stated preference is stored with its match words; a withdrawn one is removed and memory is flagged for correction',async()=>{
  const s=scripts();
  const stored=await foodPreference({action:'avoid',food:'pork',terms:['Fläsk','bacon','fläsk']},s.run);
  assert.deepEqual(s.calls,['daylight_deals.py dislike pork --terms fläsk,bacon']);
  assert.equal(stored.avoids,'pork');assert.deepEqual(stored.matchWords,['bacon','fläsk','pork']);assert.match(stored.howToAnswer.join(' '),/memory tool/);
  const thin=await foodPreference({action:'like',food:'salmon'},s.run);assert.equal(thin.likes,'salmon');assert.match(thin.howToAnswer.join(' '),/Swedish product words/);
  const gone=await foodPreference({action:'forget',food:'pork'},s.run,async()=>['User hates pork.','User lives in Stockholm.']);
  assert.equal(gone.status,'forgotten');assert.deepEqual(gone.stillStored,{likes:['salmon'],avoids:[]});
  assert.deepEqual(gone.memoryEntriesNowOutOfDate,['User hates pork.']);assert.match(gone.howToAnswer.join(' '),/Remove or replace each/);
  const clean=await foodPreference({action:'forget',food:'tofu'},s.run,async()=>[]);
  assert.equal(clean.status,'was_not_stored');assert.equal(clean.memoryEntriesNowOutOfDate,undefined);
  await assert.rejects(foodPreference({action:'avoid',food:' '},s.run),/Name the food/);await assert.rejects(foodPreference({action:'ban',food:'x'},s.run),/action/);
});

test('a topic named loosely is found by id, name, abbreviation or its words, and never guessed when unclear',()=>{
  const topics=[rag,agents,{id:'rag-benchmarks',name:'RAG benchmarks'}];
  assert.deepEqual(findTopic(topics,'retrieval-augmented-generation').map(t=>t.id),[rag.id]);
  assert.deepEqual(findTopic(topics,'Retrieval-Augmented Generation').map(t=>t.id),[rag.id]);
  assert.deepEqual(findTopic([rag,agents],'RAG').map(t=>t.id),[rag.id]);
  assert.deepEqual(findTopic(topics,'the LLM agents topic').map(t=>t.id),[agents.id]);
  assert.deepEqual(findTopic(topics,'protein design'),[]);assert.deepEqual(findTopic(topics,''),[]);
  assert.equal(findTopic(topics,'rag').length,1); // the abbreviation of one topic wins over a word in another's name
});

test('topics can be listed, added once, given a preference and stopped; the schedule is never involved',async()=>{
  const s=scripts({topics:[rag,agents]});
  assert.deepEqual((await researchTopics({action:'list'},s.run)).topics.map(t=>t.name),[rag.name,agents.name]);
  const added=await researchTopics({action:'add',topic:'diffusion models for protein design',categories:['q-bio.BM']},s.run);
  assert.equal(added.status,'added');assert.ok(s.calls.includes('daylight_research.py add diffusion models for protein design --category q-bio.BM'));assert.match(added.howToAnswer.join(' '),/Do not state a clock time/);
  assert.equal((await researchTopics({action:'add',topic:'Evaluating LLM agents'},s.run)).status,'already_followed');
  const noted=await researchTopics({action:'note',topic:'RAG',note:'skip survey papers; prefers new benchmarks'},s.run);
  assert.equal(noted.status,'saved');assert.deepEqual(s.topics[0].notes,['skip survey papers; prefers new benchmarks']);assert.deepEqual(s.topics[1].notes,[]);assert.match(noted.howToAnswer.join(' '),/Do not fetch/);
  const stopped=await researchTopics({action:'remove',topic:'retrieval-augmented generation'},s.run);
  assert.equal(stopped.status,'stopped');assert.ok(!s.topics.some(t=>t.id===rag.id));assert.ok(s.topics.some(t=>t.id===agents.id));
  const missing=await researchTopics({action:'remove',topic:'quantum computing'},s.run);assert.equal(missing.status,'no_such_topic');assert.equal(missing.followed.length,2);
  assert.ok(!s.calls.some(c=>/feed|cron/.test(c)));
  await assert.rejects(researchTopics({action:'note',topic:'agents'},s.run),/preference/);
});
