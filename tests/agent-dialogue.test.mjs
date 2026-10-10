import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationSlots,converse,planningRequest} from '../lib/conversation.mjs';
import {discoverJourney,proposeJourneys,matchesRequiredName} from '../lib/journey.mjs';
import {writeReply,journeyReplyFacts} from '../lib/reply.mjs';
import {minute,instant} from '../lib/time.mjs';
const config={key:'test',base:'https://test.invalid',model:'test'};
const date='2026-10-10',activity={id:'kfc',label:'吃肯德基',query:'KFC',requiredNames:['KFC','Kentucky Fried Chicken'],duration:45,allowance:200};
const place=(id,name)=>({id,name,location:{latitude:59.33,longitude:18.06},rating:4,periods:null});
const origin=place('origin','T-Centralen'),kfc=place('kfc','KFC Kungsgatan');
const input={date,originQuery:'T-Central',start:'08:00',deadline:'24:00',budgetMode:'flexible',activities:[activity]};
const route=async()=>({minutes:10,walking:10,fare:{currencyCode:'SEK',units:'0'}});
const day={date,busy:[],own:[]};
test('end-of-day midnight is a valid deadline and resolves to the next date',()=>{
  assert.equal(minute('24:00'),1440);assert.throws(()=>minute('24:01'));
  const s=conversationSlots({activities:[activity],date,origin:'T-Central',budgetMode:'unlimited',start:'08:00',deadline:'24:00'});
  assert.equal(planningRequest(s).settings.deadline,'24:00');
  assert.equal(instant(date,1440),instant('2026-10-11',0));
});
test('delegated time is explicitly provisional and unknown budget is optional when ready',()=>{
  const s=conversationSlots({activities:[activity],date,origin:'T-Central',timeMode:'flexible'});
  const r=planningRequest(s);assert.equal(r.settings.timeMode,'flexible');assert.equal(r.settings.start,'10:00');assert.equal(r.settings.budgetMode,'flexible');assert.equal(r.settings.budget,null);
});
test('brand matching excludes alternatives and retries an exact search',async()=>{
  let calls=[];
  const d=await discoverJourney({...input,activities:[{...activity,query:'fast food'}]},{search:async q=>{calls.push(q);return q==='T-Central'?[origin]:q==='KFC'?[kfc]:[place('wrong',"McDonald's")];}});
  assert.deepEqual(d.pools.kfc.map(p=>p.id),['kfc']);assert.deepEqual(calls,['T-Central','fast food','KFC']);
  assert.equal(matchesRequiredName(place('wrong','KFCish Cafe'),activity),false);
});
test('no matching brand produces actionable failure rather than a substituted plan',async()=>{
  const d=await discoverJourney(input,{search:async q=>q==='T-Central'?[origin]:[place('wrong',"McDonald's")]});
  const r=await proposeJourneys(input,d,{route,day});assert.equal(r.plans.length,0);assert.match(r.reason,/KFC/);assert.doesNotMatch(r.reason,/Budget.*limit/);
  assert.equal(journeyReplyFacts(r).alternatives,0);
});
test('planner revalidates named requirements even if a candidate bypasses discovery',async()=>{
  const r=await proposeJourneys(input,{origin,origins:[origin],pools:{kfc:[place('wrong',"McDonald's")]}},{route,day});assert.equal(r.plans.length,0);
});
test('calendar gaps and uncertain location continuity are visible in grounded reply facts',async()=>{
  const busy={start:instant(date,490),end:instant(date,720)};
  const r=await proposeJourneys(input,{origin,origins:[origin],pools:{kfc:[kfc]}},{route,day:{...day,busy:[busy],retained:[busy]}});
  assert.ok(r.plans.length);assert.equal(r.plans[0].continuityUnverified,true);assert.ok(r.plans[0].gaps.some(g=>g.minutes>=120));
  const f=journeyReplyFacts(r);assert.equal(f.selected.continuityUnverified,true);assert.ok(f.requiredCaveats.some(s=>s.includes('cannot be saved')));assert.equal(f.calendarWritten,false);
});
test('clarification language uses validated state and cannot create a planning request prematurely',async()=>{
  let calls=0;
  const fetchImpl=async(_url,options)=>{const body=JSON.parse(options.body),name=body.tools[0].function.name;calls++;
    const args=name==='respond'?{message:'错误：已安排',action:'plan',patch:{activities:[activity],budgetMode:'flexible',date}}:{message:'好，先不定预算。你准备从哪里出发？'};
    if(name==='write_reply'){const facts=JSON.parse(body.messages.at(-1).content);assert.equal(facts.need,'origin');assert.equal(facts.state.budgetMode,'flexible');}
    return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})};};
  const r=await converse({text:'no budget planned yet'},config,{fetchImpl});assert.equal(calls,2);assert.equal(r.action,'reply');assert.match(r.message,/先不定预算/);assert.equal(r.request,undefined);
});
test('narration failure falls back without changing facts or blocking valid plans',async()=>{
  assert.equal(await writeReply({task:'test'},config,{fetchImpl:async()=>{throw Error('offline');},fallback:'已查到候选，详情见下方。'}),'已查到候选，详情见下方。');
});
test('reply facts distinguish user limits, total reserve, transport and suggested visit times',async()=>{
 const r=await proposeJourneys({...input,budgetMode:'unlimited',timeMode:'flexible'},{origin,origins:[origin],pools:{kfc:[kfc]}},{route,day});
 const f=journeyReplyFacts(r);assert.equal(f.userLimits.budget.ceilingSEK,null);assert.equal(f.userLimits.time.source,'assistant_proposal');
 assert.equal(f.estimates.transportFare,0);assert.equal(f.estimates.activitiesReserve,200);assert.equal(f.estimates.totalReserve,200);
 assert.equal(f.selected.stops[0].time.basis,'proposed_visit');assert.equal(f.calendarWritten,false);
});
test('a time-only update cannot silently change activity estimates or explicit names',async()=>{
  const slots={date,origin:'T-Central',budgetMode:'flexible',activities:[activity],start:'10:00',deadline:'20:00'};
  const args={action:'plan',message:'已处理',changedFields:['start','deadline','timeMode'],patch:{...slots,start:'08:00',deadline:'24:00',timeMode:'fixed',activities:[{...activity,duration:10,requiredNames:[]}]}};
  const fetchImpl=async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'respond',arguments:JSON.stringify(args)}}]}}]})});
  const r=await converse({text:'早8点到午夜',slots},config,{fetchImpl});assert.equal(r.slots.activityDefinitions.kfc.duration,45);assert.deepEqual(r.slots.activityDefinitions.kfc.requiredNames,activity.requiredNames);assert.equal(r.request.settings.deadline,'24:00');
});
test('narration rejects a time that does not exist in its grounded result',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'write_reply',arguments:JSON.stringify({message:'10:49 到大学参观。'})}}]}}]})});
  assert.equal(await writeReply({selected:{returnAt:'18:50'}},config,{fetchImpl,fallback:'候选详情见下方。'}),'候选详情见下方。');
});
