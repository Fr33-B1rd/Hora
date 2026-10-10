import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('agent HTTP produces a previewable plan but cannot confirm calendar writes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'daylight-agent-')),base='http://127.0.0.1:14347';
  const child=spawn(process.execPath,['--import','./tests/journey-provider.mjs','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14347',DAYLIGHT_DATA_DIR:dir,DAYLIGHT_TEST_PROVIDERS:'1',NEBIUS_API_KEY:'test-only',GOOGLE_MAPS_API_KEY:'test-only',GOOGLE_CLIENT_ID:'test-only',GOOGLE_CLIENT_SECRET:'test-only',VOICE_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Test server exited');})]);
    const out=await post('/api/agent',{text:'from T-Centralen 出发安排书店并保存'});
    assert.equal(out.status,200);assert.equal(out.stopReason,'finished');assert.ok(out.journey.plans.length);
    assert.deepEqual(out.skills,['plan-outing','calendar-review']);assert.ok(out.trace.some(t=>t.status==='error'&&t.summary.includes('not authorized')));
    assert.equal((await post('/api/journey/preview',{id:out.journey.id,choice:out.choice})).status,400);
    const preview=await post('/api/journey/preview',{id:out.journey.id,choice:out.choice,acknowledge:true});assert.equal(preview.status,200);assert.ok(preview.id);
    const draft=await post('/api/agent',{text:'from T-Centralen Depart session-fixture'});
    assert.equal(draft.journey.plans[0].availabilityPending.length,1);
    const blocked=await post('/api/journey/preview',{id:draft.journey.id,choice:draft.choice,acknowledge:true});
    assert.equal(blocked.status,400);assert.match(blocked.error,/route draft/);
    const stop=draft.journey.plans[0].stops[0];
    const verified=await post('/api/journey/verify',{id:draft.journey.id,choice:draft.choice,acknowledge:true,checks:[{kind:stop.kind,placeId:stop.placeId,timeStatus:'checked',title:'Fixture session',timeSource:'Fictional schedule for isolated test',start:'14:00',duration:45}]});
    assert.equal(verified.status,200);assert.deepEqual(verified.plans[0].availabilityPending,[]);
    assert.equal((await post('/api/journey/preview',{id:verified.id,choice:verified.plans[0].id,acknowledge:true})).status,200);
    const job=await post('/api/agent/run',{text:'from T-Centralen 出发安排书店'});assert.equal(job.status,202);assert.ok(job.id);
    let snapshot;for(let i=0;i<100;i++){snapshot=await (await fetch(base+'/api/agent/run?id='+job.id)).json();if(snapshot.status==='done')break;await new Promise(r=>setTimeout(r,20));}
    assert.equal(snapshot.status,'done');assert.equal(snapshot.result.stopReason,'finished');assert.ok(snapshot.events.some(e=>e.phase==='tool_done'));
    assert.ok(snapshot.result.timings.length);assert.equal(snapshot.checkpoint,undefined);
    assert.equal(JSON.parse(readFileSync(join(dir,'provider.json'),'utf8')).writes,0);
  }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}rmSync(dir,{recursive:true,force:true});}
});
