import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('verification HTTP: atomic save, stale preview rejection, persistence, calendar metadata and repair',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'daylight-verify-')),base='http://127.0.0.1:14331',date='2026-10-10';let child;
 const start=async()=>{child=spawn(process.execPath,['--import','./tests/journey-provider.mjs','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14331',DAYLIGHT_DATA_DIR:dir,DAYLIGHT_TEST_PROVIDERS:'1',NEBIUS_API_KEY:'test-only',GOOGLE_MAPS_API_KEY:'test-only',GOOGLE_CLIENT_ID:'test-only',GOOGLE_CLIENT_SECRET:'test-only'},stdio:['ignore','pipe','pipe'],windowsHide:true});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server exit');})]);};
 const post=async(p,b)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,...await r.json()};};
 const state=()=>JSON.parse(readFileSync(join(dir,'provider.json'),'utf8'));
 try{
  await start();const generated=await post('/api/journey',{text:'理发拉面电影',date,settings:{budget:1000}});
  const stale=await post('/api/journey/preview',{id:generated.id,choice:'0',acknowledge:true});
  const checks=generated.plans[0].stops.map(s=>({...s,price:s.kind==='hair'?400:s.kind==='ramen'?200:250,priceSource:'测试价格来源',timeStatus:s.kind==='movie'?'booked':'unverified',start:'17:00',duration:120,title:'测试电影',timeSource:'测试订单，非真实购票'}));
  const invalid=await post('/api/journey/verify',{id:generated.id,choice:'0',checks:checks.map(s=>({...s,price:9000})),acknowledge:true});assert.equal(invalid.status,400);assert.equal(state().writes,0);
  const saved=await post('/api/journey/verify',{id:generated.id,choice:'0',checks,acknowledge:true});assert.equal(saved.status,200,saved.error);assert.equal(saved.checkRevision,1);assert.ok(saved.plans[0].budgetVerified);
  assert.equal((await post('/api/calendar/confirm',{id:stale.id})).status,400);assert.equal(state().writes,0);
  assert.equal((await post('/api/journey/preview',{id:generated.id,choice:'0',acknowledge:true})).status,400);
  child.kill();await once(child,'exit');await start();
  const restored=await post('/api/journey',{text:'理发拉面电影',date,settings:{budget:1000}});assert.equal(restored.checkRevision,1);assert.equal(restored.checks.movie.timeStatus,'booked');
  const preview=await post('/api/journey/preview',{id:restored.id,choice:'0',acknowledge:true});assert.equal(preview.status,200);
  const commit=await post('/api/calendar/confirm',{id:preview.id});assert.equal(commit.status,200,commit.error);const movie=Object.values(state().events).find(e=>e.extendedProperties.private.kind==='movie');assert.ok(!movie.summary.includes('Tentative'));assert.match(movie.description,/User reported ticket purchased/);assert.match(movie.description,/250 SEK/);assert.doesNotMatch(movie.description,/测试价格来源/);
  const n=state().writes;await post('/api/calendar/confirm',{id:preview.id});assert.equal(state().writes,n);
  const repaired=await post('/api/journey/replan',{id:restored.id,choice:'0',meeting:{start:'13:15',end:'13:45'}});assert.equal(repaired.status,200,repaired.error);assert.ok(repaired.plans.length);assert.equal(repaired.plans[0].stops.find(s=>s.kind==='movie').start,1020);
  const rp=await post('/api/journey/preview',{id:repaired.id,choice:'0',acknowledge:true});const updated=await post('/api/calendar/confirm',{id:rp.id});assert.equal(updated.status,200,updated.error);assert.equal(Object.keys(state().events).length,4);
 }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}assert.ok(resolve(dir).startsWith(resolve(tmpdir()))&&dir.includes('daylight-verify-'));rmSync(dir,{recursive:true,force:true});}
});
