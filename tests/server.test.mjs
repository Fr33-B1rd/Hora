import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {planDay,persistPlan} from '../mcp/planner-server.mjs';
import {instant} from '../lib/time.mjs';

const root=new URL('..',import.meta.url);
const temp=prefix=>mkdtempSync(join(tmpdir(),prefix));
const clean=(dir,prefix)=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir()))&&dir.includes(prefix));rmSync(dir,{recursive:true,force:true});};
const launch=async(port,env,args=['server.mjs'])=>{
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,HERMES_API_KEY:'',NEBIUS_API_KEY:'',GOOGLE_MAPS_API_KEY:'',GOOGLE_MAPS_BROWSER_KEY:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',...env,PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Test server exited');})]);return child;
};
const stop=async child=>{if(child?.exitCode===null){child.kill();await once(child,'exit');}};
const poster=base=>async(path,data,headers={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};

test('the server exposes the page and nothing private, refuses other origins, and removed routes are gone',async()=>{
  const dir=temp('daylight-http-test-'),base='http://127.0.0.1:14318',post=poster(base);let child;
  try{
    child=await launch(14318,{DAYLIGHT_DATA_DIR:dir,DAYLIGHT_HERMES_HOME:join(dir,'hermes')});
    const status=await fetch(base+'/api/status').then(r=>r.json());
    assert.equal(status.city,'Stockholm');assert.equal(status.maps.configured,false);assert.equal(status.calendar.connected,false);
    const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/default-src 'self'/);
    for(const path of ['/daylight.mjs','/journey-map.mjs','/route-geometry.mjs']){const asset=await fetch(base+path);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);}
    assert.equal((await fetch(base+'/privacy.html')).status,200);
    for(const path of ['/.env','/server.mjs','/data/local.key','/data/daylight.sqlite','/data/plans/latest.json','/legacy.html','/app.mjs'])assert.equal((await fetch(base+path)).status,404,path);
    for(const path of ['/api/agent','/api/chat','/api/journey','/api/intent','/api/live/plan','/api/voice/transcribe'])assert.equal((await post(path,{})).status,404,path);
    assert.equal((await post('/api/google/connect',{},{Origin:'https://example.com'})).status,403);
    assert.equal((await post('/api/assistant',{message:'hi'},{Origin:'https://example.com'})).status,403);
    assert.equal((await fetch(base+'/api/plans/latest')).status,404);
    assert.equal((await post('/api/calendar/confirm',{id:'made-up'})).status,400);
    // With no assistant configured the page is told so, rather than given an invented answer.
    const assistant=await fetch(base+'/api/assistant/status').then(r=>r.json());assert.equal(assistant.configured,false);
    assert.ok((await post('/api/assistant',{message:'hi'})).status>=400);
    const profile=await fetch(base+'/api/profile').then(r=>r.json());assert.deepEqual(profile.memory.user.entries,[]);assert.match(profile.jobsError,/not configured/);
  }finally{await stop(child);clean(dir,'daylight-http-test-');}
});

test('a checked plan reaches the calendar only through an acknowledged preview and one explicit confirmation',async()=>{
  const dir=temp('daylight-loop-'),base='http://127.0.0.1:14329',post=poster(base),date='2026-10-10';let child;
  const start=async()=>{child=await launch(14329,{DAYLIGHT_DATA_DIR:dir,DAYLIGHT_TEST_PROVIDERS:'1',GOOGLE_CLIENT_ID:'test-only',GOOGLE_CLIENT_SECRET:'test-only'},['--import','./tests/calendar-provider.mjs','server.mjs']);};
  const provider=()=>JSON.parse(readFileSync(join(dir,'provider.json'),'utf8'));
  const at=(id,name)=>({id,name,location:{latitude:59.33,longitude:18.06},periods:null});
  const world=()=>{const places=[at('slussen','Slussen'),at('museum','Stadsmuseet'),at('sushi','Råkultur')];
    return {maps:{search:async q=>/slussen/i.test(q)?[places[0]]:/sushi/i.test(q)?[places[2]]:[places[1]],details:async id=>places.find(p=>p.id===id),route:async()=>({minutes:12,walking:5,mode:'transit',lines:['T14'],fare:{currencyCode:'SEK',units:'43'}})},
      calendarDay:async d=>({date:d,connected:false,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'fixture',evidence:[]};};
  try{
    // The planner tool server (a separate process in production) saves the plan it checked.
    const planned=await planDay({date,from:'Slussen',activities:[{name:'Visit a museum'},{name:'Sushi',search:'sushi restaurant'}]},world,record=>persistPlan(record,join(dir,'plans')));
    assert.equal(planned.status,'planned');
    await start();
    const latest=await fetch(base+'/api/plans/latest').then(r=>r.json());
    assert.match(latest.id,/^plan-/);assert.ok(latest.plans.length);assert.equal(latest.origin.name,'Slussen');assert.equal(latest.request.from,'Slussen');
    const choice=latest.plans[0].id;
    assert.equal((await post('/api/journey/preview',{id:latest.id,choice})).status,400);
    assert.equal((await post('/api/journey/preview',{id:latest.id,choice:'nope',acknowledge:true})).status,400);
    const preview=await post('/api/journey/preview',{id:latest.id,choice,acknowledge:true});
    assert.equal(preview.status,200);assert.equal(preview.changes.length,2);assert.match(preview.notice,/Nothing is booked/);assert.equal(provider().writes,0);
    await stop(child);await start(); // The approval the user is looking at survives a server restart.
    const commit=await post('/api/calendar/confirm',{id:preview.id});
    assert.equal(commit.status,200);assert.equal(commit.events.length,2);assert.equal(provider().writes,2);
    assert.ok(Object.values(provider().events).every(e=>e.summary.includes('Tentative')&&!e.attendees));
    await post('/api/calendar/confirm',{id:preview.id});assert.equal(provider().writes,2);
    // Something new in the calendar between preview and confirmation stops the write.
    await fetch(base+'/api/plans/latest');
    const pending=await post('/api/journey/preview',{id:latest.id,choice,acknowledge:true});assert.equal(pending.status,200);
    const state=provider();state.events.external={id:'external',start:{dateTime:instant(date,0)},end:{dateTime:instant(date,1439)}};writeFileSync(join(dir,'provider.json'),JSON.stringify(state));
    assert.equal((await post('/api/calendar/confirm',{id:pending.id})).status,400);assert.equal(provider().writes,2);
    assert.equal((await post('/api/journey/preview',{id:latest.id,choice,acknowledge:true})).status,400);
  }finally{await stop(child);clean(dir,'daylight-loop-');}
});
