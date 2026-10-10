import test from 'node:test';
import assert from 'node:assert/strict';
import { openingWindows, journeySettings, proposeJourneys, planChanges } from '../lib/journey.mjs';
import { instant, intersects } from '../lib/time.mjs';
const date='2026-10-10';
const place=(id,n)=>({id,name:id,location:{latitude:59.33+n*.001,longitude:18.06+n*.001},rating:4+n*.1,periods:[{open:{day:0,hour:0}}]});
const origin=place('origin',0),pools={hair:[place('h1',1),place('h2',2)],ramen:[place('r1',2),place('r2',3)],movie:[place('m1',3),place('m2',4)]},discovery={origin,origins:[origin],pools};
const empty={date,own:[],busy:[]},route=async()=>({minutes:10,walking:3,meters:1000,fare:null,lines:[]});
test('walking limit applies to every route leg, including return, and survives settings',async()=>{
  assert.equal(journeySettings({date,maxWalking:11}).maxWalking,11);
  const rejected=await proposeJourneys({date,maxWalking:11},discovery,{route,day:empty});
  assert.equal(rejected.plans.length,0);assert.match(rejected.reason,/walking/i);
  const allowed=await proposeJourneys({date,maxWalking:12},discovery,{route,day:empty});
  assert.ok(allowed.plans.length);assert.ok(allowed.plans.every(p=>p.walking<=12));
  assert.throws(()=>journeySettings({date,maxWalking:-1}),/walking/i);
});
test('weekly openings: split hours, closed day, overnight and missing evidence',()=>{
  assert.equal(openingWindows({},date),null);assert.deepEqual(openingWindows({periods:[]},date),[]);
  assert.deepEqual(openingWindows({periods:[{open:{day:5,hour:22},close:{day:6,hour:2}}]},date),[[0,120]]);
  assert.deepEqual(openingWindows({periods:[{open:{day:6,hour:10},close:{day:6,hour:12}},{open:{day:6,hour:15},close:{day:6,hour:18}}]},date),[[600,720],[900,1080]]);
  assert.deepEqual(openingWindows({periods:[{open:{day:6,hour:22},close:{day:0,hour:2}}]},'2026-10-11'),[[0,120]]);
});
test('three distinct suggestions use real route adapter, and never claim allowances are prices',async()=>{
  const r=await proposeJourneys({date},discovery,{route,day:empty});assert.equal(r.plans.length,3);assert.ok(r.routeCalls<=36);
  assert.equal(new Set(r.plans.map(p=>JSON.stringify(p.stops.map(s=>[s.placeId,s.start])))).size,3);
  for(const p of r.plans){assert.equal(p.budgetVerified,false);assert.equal(p.transportCost,null);assert.ok(p.homeAt<=1200);assert.ok(p.reservedTotal<=1000);assert.ok(p.stops.every(s=>s.tentative));}
  assert.equal((await proposeJourneys({date,budget:50},discovery,{route,day:empty})).plans.length,0);
  await assert.rejects(proposeJourneys({date},discovery,{route:async()=>{throw Error('provider down');},day:empty}),/provider down/);
});
test('replanning avoids a meeting, preserves committed movie, and shows actual diffs',async()=>{
  const initial=(await proposeJourneys({date},discovery,{route,day:empty})).plans[0];
  const own=initial.stops.map(s=>({...s,start:instant(date,s.start),end:instant(date,s.end),locked:s.kind==='movie'}));
  const day={...empty,own},first=initial.stops[0],meeting={kind:'meeting',start:first.start,end:first.end,placeId:'',locked:true};
  const repaired=await proposeJourneys({date},discovery,{route,day,meeting});assert.ok(repaired.plans.length);
  const movie=initial.stops.find(s=>s.kind==='movie');
  for(const p of repaired.plans){const m=p.stops.find(s=>s.kind==='movie');assert.equal(m.start,movie.start);assert.equal(m.placeId,movie.placeId);for(const s of [...p.stops,...p.legs.map(l=>({start:l.depart,end:l.arrive}))])assert.ok(!intersects({start:instant(date,s.start),end:instant(date,s.end)},{start:instant(date,meeting.start),end:instant(date,meeting.end)}));}
  assert.ok(planChanges(repaired.plans[0],day,meeting).some(c=>c.operation==='Adjust'));
  assert.equal((await proposeJourneys({date},discovery,{route,day,meeting:{...meeting,start:movie.start,end:movie.end}})).plans.length,0);
});
test('unknown hours remain unknown, known closed venues cannot be recommended',async()=>{
  const d=structuredClone(discovery);d.pools.hair.forEach(p=>p.periods=[]);
  assert.equal((await proposeJourneys({date},d,{route,day:empty})).plans.length,0);
  d.pools.hair.forEach(p=>p.periods=null);const r=await proposeJourneys({date},d,{route,day:empty});assert.ok(r.plans.length);assert.equal(r.plans[0].stops.find(s=>s.kind==='hair').windowKnown,false);
  assert.throws(()=>journeySettings({date,allowances:{hair:-1}}),/reserve/i);
});
