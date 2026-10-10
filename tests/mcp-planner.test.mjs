import test from 'node:test';
import assert from 'node:assert/strict';
import {respond,planDay,persistPlan,tools} from '../mcp/planner-server.mjs';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
  assert.deepEqual(listed.map(t=>t.name),['plan_day','find_events','local_news','grocery_offers','food_preference','research_topics']);
  assert.ok(!listed.some(t=>/write|book|pay|confirm/i.test(t.name)));assert.deepEqual(tools[0].inputSchema.required,['date','from','activities','userWords']);
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
  assert.match(r.howToAnswer.join(' '),/option 1 only/);assert.match(r.howToAnswer.join(' '),/cannot add it to a calendar/);assert.match(r.howToAnswer[0],/no markdown/);
});

test('with no leave time given, the plan does not set off early just to wait at the first stop',async()=>{
  const lunch=()=>{const w=world(),opens12=[0,1,2,3,4,5,6].map(d=>({open:{day:d,hour:12,minute:0},close:{day:d,hour:22,minute:0}}));return {...w,maps:{...w.maps,search:async q=>/slussen/i.test(q)?[at('slussen','Slussen')]:[at('sushi','Råkultur',opens12)],details:async()=>at('sushi','Råkultur',opens12)}};};
  const open=await planDay({date:'2026-10-10',from:'Slussen',activities:[{name:'Sushi'}]},lunch);
  assert.match(open.plans[0].stops[0].start,/^12:0\d$/);assert.ok(open.plans[0].legs[0].depart>='11:30',open.plans[0].legs[0].depart);assert.deepEqual(open.plans[0].waits,[]);
  const fixed=await planDay({date:'2026-10-10',from:'Slussen',leaveAt:'10:00',activities:[{name:'Sushi'}]},lunch);
  assert.equal(fixed.plans[0].legs[0].depart,'10:00');
});

test('a checked plan is saved for the web app with everything a map and a calendar preview need',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'daylight-plans-'));
  try{
    await planDay(request,world,record=>persistPlan(record,dir));
    const saved=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));
    assert.match(saved.id,/^plan-/);assert.deepEqual(saved.request,request);assert.ok(Date.parse(saved.createdAt));
    assert.ok(saved.entry.result.plans.length);assert.equal(saved.entry.result.origin.name,'Slussen');assert.ok(saved.entry.result.places.museum);assert.equal(saved.entry.input.date,'2026-10-10');assert.ok(saved.entry.day);
    assert.deepEqual((await readdir(dir)).sort(),['latest.json',saved.id+'.json'].sort());
    for(let i=0;i<12;i++)await persistPlan({id:'plan-'+String(i).padStart(3,'0'),entry:{}},dir);
    assert.equal((await readdir(dir)).filter(f=>f.startsWith('plan-')).length,10);
    const failing=await planDay(request,world,async()=>{throw Error('disk full');});assert.equal(failing.status,'planned');
  }finally{await rm(dir,{recursive:true});}
});

test('an activity whose words are a real place’s name is held to that place; a kind of place is not',async()=>{
  const {namedVenues}=await import('../mcp/planner-server.mjs');
  const maps={search:async q=>/moderna/i.test(q)?[at('mm','Moderna Museet')]:/vasa/i.test(q)?[at('v','Vasa Museum Stockholm')]:/sushi/i.test(q)?[at('s','Sushi Bar Söder')]:/broken/i.test(q)?(()=>{throw Error('offline');})():[at('x','Stadsmuseet')]};
  const out=await namedVenues([{name:'Moderna Museet'},{name:'vasa museum'},{name:'a museum'},{name:'sushi bar'},{name:'museum'},{name:'Art gallery',search:'gallery Södermalm'},{name:'Meet Anna',meetingPoint:true},{name:'Råkultur dinner',place:'Råkultur'},{name:'broken place'}],maps);
  assert.deepEqual(out.map(a=>a.place||null),['Moderna Museet','vasa museum',null,null,null,null,null,'Råkultur',null]);
});

test('an order or a return time in the user’s own words is enforced when the call left it out, and nothing else is inferred',async()=>{
  const {statedInWords}=await import('../mcp/planner-server.mjs');
  const two=[{name:'ramen'},{name:'museum'}],read=(userWords,extra={})=>{const r=statedInWords({activities:two,userWords,...extra});return [r.keepOrder===true,r.backBy||null];};
  assert.deepEqual(read('first ramen at 12:30, then Moderna Museet. I must be back at T-Centralen by 17:00.'),[true,'17:00']);
  assert.deepEqual(read('ramen and a museum, home before 6pm'),[false,'18:00']);
  assert.deepEqual(read('Museum followed by ramen; done by 9.30 p.m.'),[true,'21:30']);
  assert.deepEqual(read('ramen and a museum, back by 5'),[false,null]);           // morning or afternoon is not stated
  assert.deepEqual(read('a museum before 17:00 and ramen after'),[false,null]);     // “before” here limits the museum, not the return
  assert.deepEqual(read('I get back from work by 15:00; ramen and a museum'),[false,'15:00']);  // known over-read: this “back” is not the outing’s
  assert.deepEqual(read('ramen at 12:30 and a museum'),[false,null]);
  assert.deepEqual(read('back by 17:00',{backBy:'16:00'}),[false,'16:00']);         // what the call says is never overridden
  assert.equal(statedInWords({activities:[{name:'ramen'}],userWords:'first ramen'}).keepOrder,undefined);
  assert.deepEqual(statedInWords({activities:two}).activities,two);
  // Through the planner: the order in the words holds even though keepOrder was not passed.
  const r=await planDay({...request,userWords:'First sushi, then a museum.',activities:[{name:'Sushi',search:'sushi restaurant'},{name:'Visit a museum'}]},world);
  assert.equal(r.status,'planned');assert.ok(r.plans.every(p=>p.stops[0].activity==='Sushi'));
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
