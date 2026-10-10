import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeJourneys} from '../lib/journey.mjs';
import {instant} from '../lib/time.mjs';
const date='2026-10-10';
const origin={id:'station',name:'Station',location:{latitude:59.33,longitude:18.06},periods:null};
const venue={...origin,id:'venue',name:'Venue'};
const input={date,start:'10:00',deadline:'18:00',budgetMode:'unlimited',timeMode:'flexible',activities:[{id:'visit',label:'参观',query:'Venue',duration:60,allowance:200,requiredNames:[]}]};
const discovery={origin,origins:[origin],pools:{visit:[venue]}};
const day={date,own:[],busy:[]};
const route=async()=>({minutes:10,walking:8,mode:'transit',fare:null});

test('fixed calendar conflict identifies activity and times without querying routes or moving commitments',async()=>{
 const lock={kind:'visit',placeId:'venue',start:660,duration:60};
 const busy=[{start:instant(date,675),end:instant(date,690)}];
 const r=await proposeJourneys(input,discovery,{route:async()=>assert.fail('no routes needed'),day:{...day,busy},locks:[lock]});
 assert.equal(r.plans.length,0);assert.equal(r.routeCalls,0);
 const d=r.diagnostics.find(d=>d.code==='fixed_calendar');
 assert.equal(d.activity,'visit');assert.equal(d.start,'11:00');assert.equal(d.busyStart,'11:15');assert.equal(d.busyEnd,'11:30');
 assert.match(d.message,/adjusting the order of other activities cannot/);assert.ok(r.repairOptions.every(o=>o.requiresDecision));
 assert.deepEqual(busy,[{start:instant(date,675),end:instant(date,690)}]);assert.equal(lock.start,660);
});
test('cross-day conflicts retain the date in their explanation',async()=>{
 const r=await proposeJourneys(input,discovery,{route,day:{...day,busy:[{start:date+'T00:00:00Z',end:date+'T23:59:00Z'}]}});
 assert.equal(r.plans.length,0);assert.match(r.reason,/2026-10-11 01:59/);assert.match(r.reason,/existing calendar arrangements/);
});
test('failed opening, walking and budget checks retain concrete values and appropriate repair options',async()=>{
 const closed={...discovery,pools:{visit:[{...venue,periods:[{open:{day:6,hour:17,minute:45},close:{day:6,hour:18}}]}]}};
 const hours=await proposeJourneys(input,closed,{route,day});
 assert.equal(hours.routeCalls,0);assert.match(hours.reason,/17:45–18:00/);assert.match(hours.reason,/60\s+minutes/);
 const walk=await proposeJourneys({...input,maxWalking:5},discovery,{route,day});
 assert.ok(walk.diagnostics.some(d=>d.code==='walking'&&d.walking===16&&d.limit===5));assert.ok(walk.repairOptions.some(o=>o.action==='compare_closer_places'));
 const cost=await proposeJourneys({...input,budgetMode:'limited',budget:100},discovery,{route,day});
 assert.ok(cost.diagnostics.some(d=>d.code==='budget'&&d.reservedTotal===350&&d.limit===100));
 assert.match(cost.repairOptions.find(o=>o.id==='cost').explanation,/cannot.*lowering cost estimates/);
});
test('limited search is not exhaustive infeasibility and targeted replan reuses exact routes',async()=>{
 let actual=0;const cache=new Map(),counted=async(...args)=>{actual++;return route(...args);};
 const r=await proposeJourneys(input,discovery,{route:counted,day,maxCalls:1,routeCache:cache});
 assert.equal(r.plans.length,0);assert.equal(r.searchStats.exhaustive,false);assert.equal(r.searchStats.exhausted,true);assert.ok(r.diagnostics.some(d=>d.code==='search_limit'));
 const repaired=await proposeJourneys(input,discovery,{route:counted,day,maxCalls:6,routeCache:cache});
 assert.ok(repaired.plans.length);assert.equal(actual,r.routeCalls+repaired.routeCalls);assert.equal(cache.size,actual);assert.ok(repaired.routeCalls<4);
 assert.equal(repaired.constraints.deadline,input.deadline);
 const cached=await proposeJourneys(input,discovery,{route:async()=>assert.fail('cached results must work at zero query allowance'),day,maxCalls:0,routeCache:cache});
 assert.ok(cached.plans.length);assert.equal(cached.routeCalls,0);
});
test('fixed sessions outside the trip window and overlapping sessions fail before routing',async()=>{
 const one=await proposeJourneys({...input,deadline:'11:00'},discovery,{route:async()=>assert.fail(),day,locks:[{kind:'visit',placeId:'venue',start:660,duration:60}]});
 assert.ok(one.diagnostics.some(d=>d.code==='fixed_window'));assert.equal(one.repairOptions[0].requiresDecision,false);
 const two=await proposeJourneys({...input,activities:[...input.activities,{...input.activities[0],id:'other',label:'第二项'}]}, {...discovery,pools:{visit:[venue],other:[venue]}},{route:async()=>assert.fail(),day,locks:[{kind:'visit',placeId:'venue',start:660,duration:60},{kind:'other',placeId:'venue',start:690,duration:30}]});
 assert.ok(two.diagnostics.some(d=>d.code==='fixed_overlap'));assert.equal(two.routeCalls,0);
});
