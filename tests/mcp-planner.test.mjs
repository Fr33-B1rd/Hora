import test from 'node:test';
import assert from 'node:assert/strict';
import {respond,planDay,tools} from '../mcp/planner-server.mjs';

const at=(id,name,periods=null)=>({id,name,location:{latitude:59.33,longitude:18.06},periods});
const world=()=>{const origin=at('slussen','Slussen'),museum=at('museum','Stadsmuseet'),sushi=at('sushi','Råkultur'),closed=at('closed','Vasamuseet',[]);
  return {maps:{search:async q=>/slussen/i.test(q)?[origin]:/vasa/i.test(q)?[closed]:/sushi/i.test(q)?[sushi]:[museum],details:async id=>[origin,museum,sushi,closed].find(p=>p.id===id),route:async()=>({minutes:12,walking:5,mode:'transit',lines:['T14'],fare:{currencyCode:'SEK',units:'43'}})},
    calendarDay:async date=>({date,connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'fixture',evidence:[]};};
const request={date:'2026-10-10',from:'Slussen',activities:[{name:'Visit a museum'},{name:'Sushi',search:'sushi restaurant'}]};

test('the tool server speaks the protocol: initialize, list tools, call, unknown tool, notifications',async()=>{
  const init=await respond({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});
  assert.equal(init.result.protocolVersion,'2025-06-18');assert.ok(init.result.capabilities.tools);assert.match(init.result.instructions,/Today is \d{4}-\d\d-\d\d/);
  assert.equal(await respond({jsonrpc:'2.0',method:'notifications/initialized'}),null);
  const listed=(await respond({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools;
  assert.deepEqual(listed.map(t=>t.name),['plan_day','find_events','local_news']);
  assert.ok(!listed.some(t=>/write|book|pay|confirm/i.test(t.name)));assert.deepEqual(tools[0].inputSchema.required,['date','from','activities']);
  const called=await respond({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'echo',arguments:{a:1}}},{echo:async a=>({got:a})});
  assert.deepEqual(JSON.parse(called.result.content[0].text),{got:{a:1}});
  const failed=await respond({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'boom'}},{boom:async()=>{throw Error('no route');}});
  assert.equal(failed.result.isError,true);assert.equal(failed.result.content[0].text,'no route');
  assert.equal((await respond({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'nope'}})).error.code,-32602);
});

test('plan_day returns checked plans and applies no limit the caller did not give',async()=>{
  const r=await planDay(request,world);
  assert.equal(r.status,'planned');assert.equal(r.from,'Slussen');assert.ok(r.plans.length>=1);
  assert.deepEqual(r.plans[0].stops.map(s=>s.venue).sort(),['Råkultur','Stadsmuseet']);assert.match(r.plans[0].backAt,/^\d\d:\d\d$/);
  assert.deepEqual(r.limitsApplied,{leaveAt:null,backBy:null,budgetSEK:null});assert.equal(r.calendarChecked,true);assert.equal(r.calendarWritten,false);
});

test('with no leave time given, the plan does not set off early just to wait at the first stop',async()=>{
  const lunch=()=>{const w=world(),opens12=[0,1,2,3,4,5,6].map(d=>({open:{day:d,hour:12,minute:0},close:{day:d,hour:22,minute:0}}));return {...w,maps:{...w.maps,search:async q=>/slussen/i.test(q)?[at('slussen','Slussen')]:[at('sushi','Råkultur',opens12)],details:async()=>at('sushi','Råkultur',opens12)}};};
  const open=await planDay({date:'2026-10-10',from:'Slussen',activities:[{name:'Sushi'}]},lunch);
  assert.match(open.plans[0].stops[0].start,/^12:0\d$/);assert.ok(open.plans[0].legs[0].depart>='11:30',open.plans[0].legs[0].depart);assert.deepEqual(open.plans[0].waits,[]);
  const fixed=await planDay({date:'2026-10-10',from:'Slussen',leaveAt:'10:00',activities:[{name:'Sushi'}]},lunch);
  assert.equal(fixed.plans[0].legs[0].depart,'10:00');
});

test('times, order and limits in the call are requirements, never relaxed as assumptions',async()=>{
  const timed=await planDay({...request,keepOrder:true,leaveAt:'12:00',backBy:'18:00',budgetSEK:800,activities:[{name:'Sushi',search:'sushi restaurant',earliest:'13:00',latest:'14:00'},{name:'Visit a museum'}]},world);
  assert.equal(timed.status,'planned');assert.equal(timed.plans[0].stops[0].activity,'Sushi');assert.equal(timed.plans[0].stops[0].start,'13:00');
  assert.deepEqual(timed.limitsApplied,{leaveAt:'12:00',backBy:'18:00',budgetSEK:800});
  const impossible=await planDay({...request,leaveAt:'12:00',backBy:'18:00',activities:[{name:'Sushi',search:'sushi restaurant',earliest:'20:00',latest:'21:00'}]},world);
  assert.equal(impossible.status,'nothing_fits');assert.equal(impossible.plans.length,0);assert.ok(impossible.blockers.length||impossible.why);
});

test('a closed venue blocks a visit but not a meeting point; a missing place is reported, not invented',async()=>{
  const visit={date:'2026-10-10',from:'Slussen',activities:[{name:'Go inside Vasamuseet',place:'Vasamuseet'}]};
  assert.equal((await planDay(visit,world)).status,'nothing_fits');
  assert.equal((await planDay({...visit,activities:[{name:'Meet a friend outside Vasamuseet',place:'Vasamuseet',meetingPoint:true,earliest:'18:30'}]},world)).status,'planned');
  const empty=()=>({...world(),maps:{...world().maps,search:async q=>/slussen/i.test(q)?[at('slussen','Slussen')]:[]}});
  const r=await planDay(request,empty);assert.equal(r.status,'not_planned');assert.match(r.reason,/No activity location selected/);
});
