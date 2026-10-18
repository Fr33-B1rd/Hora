import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {createCalendar} from '../lib/calendar.mjs';
import {instant} from '../lib/time.mjs';
import {calendarDay,calendarPropose,calendarConfirm,saysYes,eventsOf,calendarTools,calendarHandlers} from '../mcp/calendar-tools.mjs';
import {planDay} from '../mcp/planner-server.mjs';

const date='2026-11-03',T0=Date.parse('2026-11-01T09:00:00Z');
// A Google Calendar that lives in memory: lists, creates, and refuses a duplicate id as Google does.
function world({connected=true,events=[]}={}){
  const dir=mkdtempSync(join(tmpdir(),'daylight-caltools-')),store=createStore(dir),calls=[],held=new Map(events.map(e=>[e.id,e]));
  if(connected)store.tokens({access_token:'test-only',expiresAt:Date.now()+3600000});
  const ok=x=>({ok:true,status:200,json:async()=>x});
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url),method=options.method||'GET';calls.push(method+' '+u.pathname.split('/').at(-1));
    if(method==='GET')return ok(u.searchParams.has('timeMin')?{items:[...held.values()]}:held.get(u.pathname.split('/').at(-1)));
    const body=JSON.parse(options.body);if(held.has(body.id))return {ok:false,status:409};
    held.set(body.id,{...body,htmlLink:'https://calendar.google.com/calendar/event?eid='+body.id});return ok(held.get(body.id));
  };
  return {services:{store,calendar:createCalendar({clientId:'x',clientSecret:'y',redirect:'http://127.0.0.1/callback'},store,fetchImpl)},calls,held,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
const event=(id,summary,from,to)=>({id,summary,start:{dateTime:instant(date,from)},end:{dateTime:instant(date,to)}});
const writes=w=>w.calls.filter(c=>c.startsWith('POST')||c.startsWith('PUT')).length;

test('the calendar tools have handlers and closed inputs, and none can invite, delete or pay',()=>{
  assert.deepEqual(calendarTools.map(t=>t.name).sort(),Object.keys(calendarHandlers).sort());
  for(const tool of calendarTools){assert.equal(tool.inputSchema.additionalProperties,false);assert.doesNotMatch(tool.name,/invite|delete|remove|pay|book/);}
});

test('only a plain yes counts as a confirmation',()=>{
  for(const yes of ['Yes','yes please','Yep, add it','ok','Sure!','go ahead','Confirm','sounds good','That’s right','ja'])assert.equal(saysYes(yes),true,yes);
  for(const no of ['No','no thanks','yes but make it 11','Yes, but not on Tuesday','wait','ok change it to 3pm','Actually move it','maybe','what time is it?','','hmm','don’t','nej','yes '+'x'.repeat(130)])assert.equal(saysYes(no),false,no);
});

test('a day is read with titles and times in order; a disconnected calendar says where to connect',async()=>{
  const w=world({events:[event('b','Lunch with Sam',720,780),event('a','Dentist',600,660),{id:'c',summary:'Conference',start:{date},end:{date:'2026-11-04'}},{id:'d',status:'cancelled',summary:'Gone',start:{dateTime:instant(date,800)},end:{dateTime:instant(date,860)}}]});
  try{
    const r=await calendarDay({date},w.services);
    assert.deepEqual(r.events,[{title:'Conference',allDay:true},{title:'Dentist',start:'10:00',end:'11:00'},{title:'Lunch with Sam',start:'12:00',end:'13:00'}]);
    assert.equal(writes(w),0);await assert.rejects(calendarDay({date:'tomorrow'},w.services),/Invalid date/);
  }finally{w.close();}
  const off=world({connected:false});
  try{const r=await calendarDay({date},off.services);assert.equal(r.status,'not_connected');assert.match(r.howToAnswer.join(' '),/What I know/);
    assert.equal((await calendarPropose({title:'x',date,start:'10:00',end:'11:00'},off.services,T0)).status,'not_connected');}finally{off.close();}
});

test('proposing writes nothing and names what it would overlap; bad input is refused before anything is stored',async()=>{
  const w=world({events:[event('a','Dentist',600,660)]});
  try{
    const p=await calendarPropose({title:'  Lunch with Sam ',date,start:'10:30',end:'11:30',location:'Kajsas Fisk'},w.services,T0);
    assert.equal(p.status,'awaiting_confirmation');assert.match(p.proposalId,/^ev-[0-9a-f]{12}$/);assert.equal(p.nothingWrittenYet,true);
    assert.deepEqual(p.wouldAdd,{title:'Lunch with Sam',date,start:'10:30',end:'11:30',location:'Kajsas Fisk'});
    assert.deepEqual(p.overlapsWith,[{title:'Dentist',start:'10:00',end:'11:00'}]);assert.match(p.howToAnswer.join(' '),/name each overlapping event/);assert.match(p.howToAnswer.join(' '),/only in a later turn/);
    assert.equal(writes(w),0);
    assert.deepEqual((await calendarPropose({title:'Walk',date,start:'11:00',end:'12:00'},w.services,T0)).overlapsWith,[]);  // touching is not overlapping
    await assert.rejects(calendarPropose({title:'x',date,start:'11:00',end:'10:00'},w.services,T0),/end must be after/);
    await assert.rejects(calendarPropose({title:' ',date,start:'10:00',end:'11:00'},w.services,T0),/title/);
    await assert.rejects(calendarPropose({title:'x',date:'2026-10-01',start:'10:00',end:'11:00'},w.services,T0),/past/);
    await assert.rejects(calendarPropose({title:'x',date,start:'10am',end:'11:00'},w.services,T0),/HH:MM/);
  }finally{w.close();}
});

test('an event is written only by a clear yes in a later turn, once, and never after expiry',async()=>{
  const w=world();
  try{
    const p=await calendarPropose({title:'Meeting with Anna',date,start:'10:00',end:'11:00',notes:'Bring slides'},w.services,T0);
    const confirm=(userSaid,after,id=p.proposalId)=>calendarConfirm({proposalId:id,userSaid},w.services,T0+after);
    assert.equal((await confirm('yes',1000)).status,'too_soon');                          // the same turn: the user cannot have answered yet
    assert.equal((await confirm('no, leave it',30000)).status,'not_confirmed');
    assert.equal((await confirm('yes but at 11',30000)).status,'not_confirmed');
    assert.equal((await confirm('yes',30000,'ev-000000000000')).status,'no_such_proposal');
    assert.equal(writes(w),0);
    const done=await confirm('Yes please',30000);
    assert.equal(done.status,'added');assert.equal(done.written,true);assert.deepEqual(done.added,{title:'Meeting with Anna',date,start:'10:00',end:'11:00'});assert.match(done.link,/calendar\.google\.com/);
    assert.equal(writes(w),1);
    const saved=[...w.held.values()][0];
    assert.equal(saved.summary,'Meeting with Anna');assert.equal(saved.description,'Bring slides');assert.equal(saved.start.dateTime,instant(date,600));assert.equal(saved.attendees,undefined);assert.match(saved.id,/^da2[0-9a-f]{40}$/);
    assert.equal((await confirm('yes',60000)).status,'already_added');assert.equal(writes(w),1);
    // The planner treats it as busy time and can name it.
    assert.deepEqual(eventsOf(await w.services.calendar.day(date)),[{title:'Meeting with Anna',start:'10:00',end:'11:00'}]);
    const late=await calendarPropose({title:'Late',date,start:'15:00',end:'16:00'},w.services,T0);
    assert.equal((await calendarConfirm({proposalId:late.proposalId,userSaid:'yes'},w.services,T0+16*60000)).status,'expired');assert.equal(writes(w),1);
  }finally{w.close();}
});

test('a retry after an ambiguous failure does not add the event twice',async()=>{
  const w=world();
  try{
    const p=await calendarPropose({title:'Call',date,start:'09:00',end:'09:30'},w.services,T0);
    await w.services.calendar.add({title:'Call',date,start:540,end:570},p.proposalId);   // the first attempt reached Google, but its answer was lost
    const done=await calendarConfirm({proposalId:p.proposalId,userSaid:'ok'},w.services,T0+20000);
    assert.equal(done.status,'added');assert.equal(w.held.size,1);
  }finally{w.close();}
});

test('a plan names what is already in the calendar that day so the reply can say it was fitted around it',async()=>{
  const at=(id,name)=>({id,name,location:{latitude:59.33,longitude:18.06},periods:null});
  const busy=[{start:instant(date,780),end:instant(date,900),title:'Board meeting'}];
  const make=()=>({maps:{search:async q=>/slussen/i.test(q)?[at('slussen','Slussen')]:[at('museum','Stadsmuseet')],details:async id=>at(id,id),route:async()=>({minutes:12,walking:5,mode:'transit',lines:['T14'],fare:{currencyCode:'SEK',units:'43'}})},
    calendarDay:async d=>({date:d,connected:true,busy,own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'fixture',evidence:[]});
  const r=await planDay({date,from:'Slussen',userWords:'a museum',activities:[{name:'Visit a museum'}]},make);
  assert.equal(r.status,'planned');assert.deepEqual(r.alreadyInCalendar,[{title:'Board meeting',start:'13:00',end:'15:00'}]);
  assert.match(r.howToAnswer.join(' '),/fitted around them/);
  const stop=r.plans[0].stops[0];assert.ok(stop.end<='13:00'||stop.start>='15:00',JSON.stringify(stop));
  const free=await planDay({date,from:'Slussen',userWords:'a museum',activities:[{name:'Visit a museum'}]},()=>({...make(),calendarDay:async d=>({date:d,connected:false,busy:[],own:[]})}));
  assert.deepEqual(free.alreadyInCalendar,[]);assert.doesNotMatch(free.howToAnswer.join(' '),/fitted around/);
});

test('in a group the owner’s day stays private, a meeting may be proposed without naming what it clashes with, and only the owner’s own yes writes it',async()=>{
  const w=world({events:[event('a','Therapy',1020,1080)]});
  const group=(id,said)=>({source:'telegram',group:true,chatId:'-555',speaker:{name:id==='111'?'Z':'H',id},said,owners:['111']});
  try{
    const day=await calendarDay({date},w.services,group('222','what is on'));
    assert.equal(day.status,'private');assert.doesNotMatch(JSON.stringify(day),/Therapy/);
    const p=await calendarPropose({title:'Hora project meeting',date,start:'17:00',end:'18:00',location:'H’s place'},w.services,T0,group('222','yes'));
    assert.equal(p.status,'awaiting_confirmation');assert.equal(p.ownerIsBusyThen,true);
    assert.doesNotMatch(JSON.stringify(p),/Therapy/);assert.match(p.howToAnswer.join(' '),/never what it is/);
    const notOwner=await calendarConfirm({proposalId:p.proposalId,userSaid:'yes'},w.services,T0+60000,group('222','yes'));
    assert.equal(notOwner.status,'owner_only');assert.equal(writes(w),0);
    const unknown=await calendarConfirm({proposalId:p.proposalId,userSaid:'yes'},w.services,T0+60000,{...group(null,'yes'),speaker:{name:null,id:null}});
    assert.equal(unknown.status,'owner_only');
    // The model claimed a yes, but the owner's recorded message was not one.
    const hedged=await calendarConfirm({proposalId:p.proposalId,userSaid:'yes'},w.services,T0+60000,group('111','yes but at 18'));
    assert.equal(hedged.status,'not_confirmed');assert.equal(writes(w),0);
    const owner=await calendarConfirm({proposalId:p.proposalId,userSaid:'yes'},w.services,T0+60000,group('111','yes'));
    assert.equal(owner.status,'added');assert.equal(writes(w),1);
  }finally{w.close();}
});
