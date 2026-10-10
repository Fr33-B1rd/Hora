import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('chat gathers slots, issues a plan token, and generates bounded routes without calendar writes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'daylight-chat-')),base='http://127.0.0.1:14337';
  const child=spawn(process.execPath,['--import','./tests/journey-provider.mjs','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14337',VOICE_DISABLED:'1',DAYLIGHT_DATA_DIR:dir,DAYLIGHT_TEST_PROVIDERS:'1',NEBIUS_API_KEY:'test',GOOGLE_MAPS_API_KEY:'test',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Test server exited');})]);
    const first=await post('/api/chat',{text:JSON.stringify({activities:['movie','ramen','hair'],date:'2026-10-10'})});
    assert.equal(first.status,200);assert.match(first.message,/depart/i);assert.equal(first.planToken,undefined);
    const ready=await post('/api/chat',{slots:first.slots,text:JSON.stringify({budget:1000,origin:'T-Central Stockholm',start:'13:00',deadline:'20:00',lowWalking:true,maxWalking:40})});
    assert.equal(ready.action,'plan');assert.ok(ready.planToken);
    const journey=await post('/api/journey',{planToken:ready.planToken,settings:{budget:900,start:'10:00'}});
    assert.equal(journey.status,200);assert.equal(journey.constraints.budget,1000);assert.equal(journey.constraints.start,'13:00');assert.equal(journey.constraints.maxWalking,40);assert.ok(journey.plans.length);assert.ok(journey.plans.every(p=>p.walking<=40));
    assert.equal((await post('/api/journey',{planToken:'invalid'})).status,400);
    assert.equal(JSON.parse(readFileSync(join(dir,'provider.json'),'utf8')).writes,0);
    // Same-day generic itinerary: old commitments stay in the calendar and block time.
    const oldPreview=await post('/api/journey/preview',{id:journey.id,choice:'0',acknowledge:true,lockMovie:true});
    const oldCommit=await post('/api/calendar/confirm',{id:oldPreview.id});assert.equal(oldCommit.status,200);
    const before=JSON.parse(readFileSync(join(dir,'provider.json'),'utf8'));
    const generic=await post('/api/chat',{text:JSON.stringify({date:'2026-10-10',origin:'T-Central',budgetMode:'unlimited',start:'08:00',deadline:'20:00',activities:[{id:'museum',label:'visit museum',query:'museum',duration:60,allowance:200},{id:'chinese',label:'eat Chinese food',query:'Chinese restaurant',duration:60,allowance:300}],precedence:[{before:'museum',after:'chinese'}]})});
    assert.ok(generic.planToken);
    const next=await post('/api/journey',{planToken:generic.planToken});assert.equal(next.status,200);assert.equal(next.retainedCount,3);assert.equal(next.constraints.budget,null);assert.equal(next.constraints.budgetMode,'unlimited');assert.ok(next.plans.length);
    for(const p of next.plans)assert.deepEqual(p.stops.map(s=>s.kind),['museum','chinese']);
    const preview=await post('/api/journey/preview',{id:next.id,choice:'0',acknowledge:true});assert.equal(preview.status,200);assert.equal(preview.changes.length,2);assert.match(preview.changes[0].label,/museum/);
    assert.equal((await post('/api/calendar/confirm',{id:preview.id})).status,200);
    const after=JSON.parse(readFileSync(join(dir,'provider.json'),'utf8'));for(const [id,event] of Object.entries(before.events))assert.deepEqual(after.events[id],event);
    assert.equal(Object.keys(after.events).length,5);
    const explained=await post('/api/journey/explain',{id:next.id,choice:'0'});assert.equal(explained.status,200);assert.match(explained.message,/candidate/);
    const spanning=await post('/api/chat',{text:JSON.stringify({date:'2026-10-10',origin:'T-Central',budgetMode:'unlimited',start:'12:00',deadline:'24:00',activities:[{id:'coffee',label:'喝咖啡',query:'coffee shop',duration:120,allowance:100}]})});
    const blocked=await post('/api/journey',{planToken:spanning.planToken});assert.equal(blocked.status,200);assert.ok(blocked.plans.length);assert.equal(blocked.plans[0].continuityUnverified,true);
    const denied=await post('/api/journey/preview',{id:blocked.id,choice:'0',acknowledge:true});assert.equal(denied.status,400);assert.match(denied.error,/connection/);
    assert.equal(JSON.parse(readFileSync(join(dir,'provider.json'),'utf8')).writes,after.writes);

    await post('/api/calendar/confirm',{id:preview.id});assert.equal(JSON.parse(readFileSync(join(dir,'provider.json'),'utf8')).writes,after.writes);

  }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}assert.ok(resolve(dir).startsWith(resolve(tmpdir()))&&dir.includes('daylight-chat-'));rmSync(dir,{recursive:true,force:true});}
});

