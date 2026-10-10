import test from 'node:test';
import assert from 'node:assert/strict';
import {journeySettings,discoverJourney,proposeJourneys,scopeJourneyDay} from '../lib/journey.mjs';
import {activityDefinitions,precedenceRules} from '../lib/activities.mjs';
import {instant} from '../lib/time.mjs';
const date='2026-10-10',activities=[{id:'museum',label:'visit museum',query:'museum',duration:120,allowance:250},{id:'chinese',label:'eat Chinese food',query:'Chinese restaurant',duration:60,allowance:300}];
const place=(id,n)=>({id,name:id,location:{latitude:59.33+n*.001,longitude:18.06+n*.001},periods:[{open:{day:0,hour:0}}],rating:4});
const origin=place('origin',0),discovery={origin,origins:[origin],pools:{museum:[place('museum-a',2),place('museum-b',3)],chinese:[place('food-a',1),place('food-b',4)]}};
const day={date,own:[],busy:[]},route=async()=>({minutes:10,walking:4,meters:400,mode:'walk',lines:[],fare:{currencyCode:'SEK',units:'0'}});
const input={date,start:'09:00',deadline:'20:00',activities,budgetMode:'unlimited',precedence:[{before:'museum',after:'chinese'}]};
test('generic discovery retains query specificity and accepts unrelated categories',async()=>{
  const calls=[];await discoverJourney(input,{search:async(query,type)=>{calls.push({query,type});return [origin];}});
  assert.ok(calls.some(x=>x.query==='Chinese restaurant'&&x.type===null));assert.ok(calls.some(x=>x.query==='museum'));
  const defs=activityDefinitions([{id:'books',label:'逛书店',query:'independent bookstore',duration:45,allowance:100},{id:'coffee',label:'咖啡',query:'specialty coffee',duration:30,allowance:60}]);assert.equal(defs.length,2);
  assert.throws(()=>activityDefinitions([{...activities[0],id:'__proto__'}]),/ID/);
  assert.throws(()=>precedenceRules([{before:'museum',after:'chinese'},{before:'chinese',after:'museum'}],['museum','chinese']),/conflicts/);
});
test('unlimited costs and explicit precedence are enforced across all three alternatives and replans',async()=>{
  const high={...input,allowances:{museum:20000,chinese:30000}};
  const r=await proposeJourneys(high,discovery,{route,day});assert.equal(r.constraints.budget,null);assert.equal(r.plans.length,3);
  for(const p of r.plans){assert.deepEqual(p.stops.map(s=>s.kind),['museum','chinese']);assert.equal(p.reservedTotal,50000);assert.equal(p.stops[0].label,'visit museum');}
  assert.equal((await proposeJourneys({...high,budgetMode:'limited',budget:1000},discovery,{route,day})).plans.length,0);
  const repaired=await proposeJourneys(high,discovery,{route,day,meeting:{kind:'meeting',placeId:'',start:600,end:630}});assert.ok(repaired.plans.length);assert.ok(repaired.plans.every(p=>p.stops[0].kind==='museum'));

});
test('unrelated existing commitments block travel/activity time and remain outside the new plan',async()=>{
  const existing={kind:'movie',placeId:'old',start:instant(date,600),end:instant(date,720),locked:true};
  const scoped=scopeJourneyDay({...day,own:[existing]},['museum','chinese']);assert.equal(scoped.retained.length,1);assert.equal(scoped.own.length,0);
  const r=await proposeJourneys(input,discovery,{route,day:scoped});assert.ok(r.plans.length);assert.ok(r.plans.every(p=>p.stops[0].start>=720));
});
test('soft walking preference requires no number; hard cap still rejects excessive walking',async()=>{
  assert.equal(journeySettings({...input,lowWalking:true}).maxWalking,null);
  const soft=await proposeJourneys({...input,lowWalking:true},discovery,{route,day});assert.ok(soft.plans.length);
  const hard=await proposeJourneys({...input,lowWalking:true,maxWalking:11},discovery,{route,day});assert.equal(hard.plans.length,0);
});


test('five activities preserve a lunchtime window and a fixed late performance within route budget',async()=>{
  const ids=['concert','lunch','waterfront','souvenirs','groceries'];
  const defs=ids.map(id=>({id,label:id,query:id,duration:id==='concert'?60:40,allowance:100,...(id==='lunch'?{windowStart:'12:00',windowEnd:'14:00'}:{})}));
  const pools=Object.fromEntries(ids.map((id,i)=>[id,[place(id,i+1)]]));let calls=0;
  const result=await proposeJourneys({date,start:'11:30',deadline:'23:00',budgetMode:'unlimited',activities:defs,precedence:[]},{origin,origins:[origin],pools},{day,route:async(...args)=>{calls++;return route(...args);},locks:[{kind:'concert',placeId:'concert',start:1260,duration:60}],maxCalls:36});
  assert.ok(result.plans.length);assert.ok(calls<=36);
  for(const p of result.plans){assert.equal(p.stops.length,5);assert.equal(p.stops.find(s=>s.kind==='concert').start,1260);const lunch=p.stops.find(s=>s.kind==='lunch');assert.ok(lunch.start>=720&&lunch.end<=840);}
});
