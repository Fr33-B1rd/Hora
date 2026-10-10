import test from 'node:test';
import assert from 'node:assert/strict';
import { instant, dayBounds, intersects } from '../lib/time.mjs';
import { buildPlans } from '../lib/live-planner.mjs';
import { createMaps } from '../lib/maps.mjs';
import { interpret } from '../lib/model.mjs';
const input=()=>({date:'2026-10-10',start:'13:00',deadline:'20:00',origin:'central',budget:1000,transport:'transit',activities:[{kind:'hair',placeId:'h',duration:45,price:350,earliest:'10:00',latest:'19:00',confirmedWindow:true},{kind:'ramen',placeId:'r',duration:45,price:160,earliest:'11:00',latest:'21:00',confirmedWindow:true},{kind:'movie',placeId:'m',duration:120,price:180,earliest:'12:00',latest:'23:00',fixed:'17:00',locked:true,confirmedWindow:true}]});
const route=async()=>({minutes:15,walking:5,meters:900,fare:null,lines:[]});
test('Stockholm summer/winter offsets and DST gaps, overlaps, 23/25 hour days',()=>{
  assert.equal(instant('2026-07-01',780),'2026-07-01T11:00:00.000Z');
  assert.equal(instant('2026-12-01',780),'2026-12-01T12:00:00.000Z');
  assert.throws(()=>instant('2026-03-29',150),/daylight saving/);assert.throws(()=>instant('2026-10-25',150),/daylight saving/);
  for(const [date,h] of [['2026-03-29',23],['2026-10-25',25]]){const b=dayBounds(date);assert.equal((Date.parse(b.timeMax)-Date.parse(b.timeMin))/3600000,h);}
});
test('real planner re-queries time-dependent transit and never claims unknown fares meet budget',async()=>{
  const i=input(),busy=[{start:instant(i.date,850),end:instant(i.date,900)}],calls=[];
  const r=await buildPlans(i,{route:async(a,b,t,m)=>{calls.push([a,b,t,m]);return route();},busy});
  assert.ok(r.plans.length);assert.ok(calls.every(c=>c[2].endsWith('Z')));
  for(const p of r.plans){assert.equal(p.total,null);assert.equal(p.budgetVerified,false);assert.equal(p.stops.find(s=>s.kind==='movie').start,1020);assert.ok(p.homeAt<=1200);for(const s of [...p.stops,...p.legs.map(l=>({start:l.depart,end:l.arrive}))])assert.ok(!busy.some(b=>intersects({start:instant(i.date,s.start),end:instant(i.date,s.end)},b)));}
  assert.ok(calls.some(c=>Date.parse(c[2])>=Date.parse(instant(i.date,900))));assert.ok(r.routeCalls<=36);
});
test('no fake fallback for impossible locks, closed windows, budget or route failure',async()=>{
  const i=input();assert.equal((await buildPlans({...i,budget:100},{route})).plans.length,0);
  assert.equal((await buildPlans(i,{route,busy:[{start:instant(i.date,1000),end:instant(i.date,1100)}]})).plans.length,0);
  await assert.rejects(buildPlans(i,{route,locks:[{kind:'movie',placeId:'other',start:1020,duration:120}]}),/Locked/);
  await assert.rejects(buildPlans(i,{route:async()=>{throw new Error('provider offline');}}),/provider offline/);
  i.activities[0].confirmedWindow=false;await assert.rejects(buildPlans(i,{route}),/verify/i);
});
test('Google requests use field masks and single-leg transit at actual departure',async()=>{
  const calls=[];const maps=createMaps('test-key',async(url,opts)=>{calls.push({url,...opts,body:JSON.parse(opts.body)});return {ok:true,json:async()=>url.includes('searchText')?{places:[{id:'p',displayName:{text:'Place'},location:{latitude:59.3,longitude:18},regularOpeningHours:{weekdayDescriptions:['Monday: 10–18']}}]}:{routes:[{duration:'601s',distanceMeters:1234,legs:[{steps:[{travelMode:'WALK',staticDuration:'120s'},{travelMode:'TRANSIT',staticDuration:'481s'}]}]}]}};});
  const p=await maps.search('ramen','ramen_restaurant');assert.equal(p[0].id,'p');assert.match(calls[0].headers['X-Goog-FieldMask'],/attributions/);
  const r=await maps.route('a','b','2026-10-10T11:00:00Z','transit');assert.equal(r.minutes,11);assert.equal(r.walking,2);assert.equal(r.fare,null);assert.equal(calls[1].body.departureTime,'2026-10-10T11:00:00Z');assert.equal(calls[1].body.intermediates,undefined);
  await maps.route('a','b','2026-10-10T11:00:00Z','walk');assert.equal(calls[2].body.departureTime,undefined);
});
test('model tool output is validated, no external action tools are exposed',async()=>{
  const config={key:'fake',base:'https://example.test/v1',model:'fake'},current={budget:900,start:780,deadline:1200,transport:'transit',activities:['hair']};let request;
  const fetchImpl=async(u,o)=>{request=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'propose_constraints',arguments:JSON.stringify({supported:true,message:'Budget800',constraints:{...current,budget:800},date:'2026-10-10'})}}]}}]})};};
  const r=await interpret('Budget800',current,config,{live:true,date:'2026-10-10',fetchImpl});assert.equal(r.constraints.budget,800);assert.equal(r.date,'2026-10-10');assert.deepEqual(request.tools.map(t=>t.function.name),['propose_constraints']);
  await assert.rejects(interpret('x',current,config,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'done'}}]})})}),/constraint proposal/);
});
test('transit schedule includes initial waiting and walking after alighting',async()=>{
  const maps=createMaps('fake',async()=>({ok:true,json:async()=>({routes:[{duration:'600s',legs:[{steps:[{travelMode:'TRANSIT',transitDetails:{stopDetails:{departureTime:'2026-10-10T11:20:00Z',arrivalTime:'2026-10-10T11:30:00Z'}}},{travelMode:'WALK',staticDuration:'300s'}]}]}]})}));
  assert.equal((await maps.route('a','b','2026-10-10T11:00:00Z','transit')).minutes,35);
});

test('Stockholm interpretation accepts SEK and a departure query without inventing a place',async()=>{
  const current={budget:1000,start:780,deadline:1200,transport:'transit',activities:['hair','ramen','movie']};
  const config={key:'fake',base:'https://example.test/v1',model:'fake'};
  let request,originQuery='T-Central车站';
  const fetchImpl=async(u,o)=>{request=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'propose_constraints',arguments:JSON.stringify({supported:true,message:'已理解',constraints:current,originQuery,date:'2026-10-10'})}}]}}]})};};
  const text='I am currently atT-CentralStation, wanting a haircut, ramen, and a movie, budget 1000 Swedish kronor, leaving at 1 PM and returning before 8 PM.';
  const r=await interpret(text,current,config,{live:true,date:'2026-10-10',fetchImpl});
  assert.equal(r.originQuery,'T-Central车站');assert.equal(r.constraints.budget,1000);
  assert.equal(r.constraints.start,780);assert.equal(r.constraints.deadline,1200);
  assert.match(request.messages[0].content,/Stockholm, Europe\/Stockholm, budget in SEK/);
  assert.doesNotMatch(request.messages[0].content,/fictional Shanghai/);
  assert.ok(request.tools[0].function.parameters.properties.originQuery);
  assert.equal(r.placeId,undefined);
  originQuery={placeId:'invented'};
  await assert.rejects(interpret(text,current,config,{live:true,fetchImpl}),/invalid departure location/);
  originQuery='x'.repeat(201);
  await assert.rejects(interpret(text,current,config,{live:true,fetchImpl}),/invalid departure location/);
  originQuery=undefined;
  assert.equal((await interpret('预算不变',current,config,{live:true,fetchImpl})).originQuery,'');
  await interpret('预算不变',current,config,{fetchImpl});
  assert.equal(request.tools[0].function.parameters.properties.originQuery,undefined);
});
