import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChecks, checkFor, calendarEvidence } from '../lib/verification.mjs';
import { proposeJourneys } from '../lib/journey.mjs';
import { instant } from '../lib/time.mjs';
const date='2026-10-10';
const place=(id,n)=>({id,location:{latitude:59.33+n*.001,longitude:18.06},rating:4,periods:[{open:{day:0,hour:0}}]});
const origin=place('o',0),discovery={origin,origins:[origin],pools:{hair:[place('h',1),place('h2',2)],ramen:[place('r',2)],movie:[place('m',3)]}};
const day={date,own:[],busy:[]},route=async()=>({minutes:10,walking:10,lines:[],fare:{currencyCode:'SEK',units:'0'}});
const plan={stops:[{kind:'hair',placeId:'h'},{kind:'ramen',placeId:'r'},{kind:'movie',placeId:'m'}]};
const rows=()=>plan.stops.map(s=>({...s,price:s.kind==='hair'?400:s.kind==='ramen'?200:250,priceSource:'test price list',timeStatus:s.kind==='movie'?'checked':'unverified',start:'17:00',duration:120,title:'test screening',timeSource:'test cinema schedule'}));

test('verification requires acknowledgment, sources and matching venue; zero price is distinct from unknown',()=>{
  assert.throws(()=>validateChecks(rows(),plan,date,false),/confirm/i);
  const bad=rows();bad[0].priceSource='';assert.throws(()=>validateChecks(bad,plan,date,true),/source/);
  bad[0].priceSource='test';bad[0].placeId='other';assert.throws(()=>validateChecks(bad,plan,date,true),/not match/);
  const r=rows();r[0].price=0;r[1].price='';const items=validateChecks(r,plan,date,true);
  assert.equal(items.hair.price,0);assert.equal(items.ramen,undefined);
  assert.equal(checkFor(items,'movie','m','2026-10-11'),null);assert.equal(checkFor(items,'movie','wrong',date),null);
  assert.equal(items.movie.reportedBy,'user');assert.ok(items.movie.checkedAt);
});

test('verified prices and fixed showtime constrain route planning and survive meeting repair',async()=>{
  const checks=validateChecks(rows(),plan,date,true);
  const result=await proposeJourneys({date},discovery,{day,route,checks});assert.ok(result.plans.length);
  for(const p of result.plans){assert.equal(p.reservedTotal,850);assert.equal(p.budgetVerified,true);const m=p.stops.find(s=>s.kind==='movie');assert.equal(m.start,1020);assert.equal(m.locked,true);assert.equal(m.tentative,true);assert.equal(p.stops.find(s=>s.kind==='hair').placeId,'h');}
  const repair=await proposeJourneys({date},discovery,{day,route,checks,meeting:{kind:'meeting',start:810,end:840}});assert.ok(repair.plans.length);assert.equal(repair.plans[0].stops.find(s=>s.kind==='movie').start,1020);
  assert.equal((await proposeJourneys({date,budget:800},discovery,{day,route,checks})).plans.length,0);
  assert.equal((await proposeJourneys({date},discovery,{day,route,checks,meeting:{kind:'meeting',start:1030,end:1060}})).plans.length,0);
  const noFare=await proposeJourneys({date},discovery,{day,route:async()=>({...await route(),fare:null}),checks});assert.equal(noFare.plans[0].budgetVerified,false);
});

test('booked is user-reported, not an agent booking; committed time cannot be overwritten',async()=>{
  const r=rows();r[2].timeStatus='booked';const checks=validateChecks(r,plan,date,true);
  const result=await proposeJourneys({date},discovery,{day,route,checks});const m=result.plans[0].stops.find(s=>s.kind==='movie');assert.equal(m.tentative,false);assert.match(calendarEvidence(m),/User reported/);assert.match(calendarEvidence(m),/does not make reservations or purchase tickets/);
  const locked={...day,own:[{kind:'movie',placeId:'m',start:instant(date,1000),end:instant(date,1120),locked:true}]};
  await assert.rejects(proposeJourneys({date},discovery,{day:locked,route,checks}),/conflicts with a locked/);
});

