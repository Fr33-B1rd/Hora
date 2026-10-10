import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { instant } from '../lib/time.mjs';
test('full HTTP loop: generate, preview, commit, persist, meeting repair, retry, and stale conflict',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'daylight-loop-')),base='http://127.0.0.1:14329',date='2026-10-10';let child;
  const start=async()=>{child=spawn(process.execPath,['--import','./tests/journey-provider.mjs','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14329',DAYLIGHT_DATA_DIR:dir,DAYLIGHT_TEST_PROVIDERS:'1',NEBIUS_API_KEY:'test-only',GOOGLE_MAPS_API_KEY:'test-only',GOOGLE_CLIENT_ID:'test-only',GOOGLE_CLIENT_SECRET:'test-only'},stdio:['ignore','pipe','pipe'],windowsHide:true});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Test server exited');})]);};
  const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  const provider=()=>JSON.parse(readFileSync(join(dir,'provider.json'),'utf8'));
  try{
    await start();const result=await post('/api/journey',{text:'T-Central，理发拉面电影',date,settings:{budget:1000}});assert.equal(result.status,200);assert.equal(result.plans.length,3);assert.equal(provider().writes,0);
    assert.equal((await post('/api/journey/preview',{id:result.id,choice:'0'})).status,400);
    const draftRepair=await post('/api/journey/replan',{id:result.id,choice:'0',meeting:{start:'13:15',end:'13:30'}});
    assert.ok(draftRepair.plans.length);assert.equal(draftRepair.changeBasis,'Original plan');assert.ok(draftRepair.changes[0].changes.some(c=>c.before&&c.operation==='Adjust'));assert.equal(provider().writes,0);
    const preview=await post('/api/journey/preview',{id:result.id,choice:'0',acknowledge:true,lockMovie:true});assert.equal(provider().writes,0);
    child.kill();await once(child,'exit');await start(); // Approval survives a local server restart.
    const commit=await post('/api/calendar/confirm',{id:preview.id});assert.equal(commit.status,200);assert.equal(commit.events.length,3);assert.equal(provider().writes,3);
    await post('/api/calendar/confirm',{id:preview.id});assert.equal(provider().writes,3);
    assert.ok(Object.values(provider().events).every(e=>e.summary.includes('Tentative')&&!e.attendees));
    const fresh=await post('/api/journey',{text:'T-Central，理发拉面电影',date,settings:{budget:1000}});assert.ok(fresh.plans.length);
    const first=result.plans[0].stops[0],fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    const repair=await post('/api/journey/replan',{id:fresh.id,choice:'0',meeting:{start:fmt(first.start),end:fmt(first.end)}});assert.ok(repair.plans.length);
    const movie=result.plans[0].stops.find(s=>s.kind==='movie');assert.equal(repair.plans[0].stops.find(s=>s.kind==='movie').start,movie.start);
    const next=await post('/api/journey/preview',{id:repair.id,choice:'0',acknowledge:true});const applied=await post('/api/calendar/confirm',{id:next.id});assert.equal(applied.status,200);assert.equal(Object.keys(provider().events).length,4);
    const before=provider().writes;await post('/api/calendar/confirm',{id:next.id});assert.equal(provider().writes,before);
    const pending=await post('/api/journey/preview',{id:repair.id,choice:'0',acknowledge:true});const state=provider();state.events.external={id:'external',start:{dateTime:instant(date,780)},end:{dateTime:instant(date,1200)}};writeFileSync(join(dir,'provider.json'),JSON.stringify(state));
    assert.equal((await post('/api/calendar/confirm',{id:pending.id})).status,400);assert.equal(provider().writes,before);
  }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}assert.ok(resolve(dir).startsWith(resolve(tmpdir()))&&dir.includes('daylight-loop-'));rmSync(dir,{recursive:true,force:true});}
});
