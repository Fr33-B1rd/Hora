import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DEFAULT} from '../public/planner.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('HTTP integration: honest demo status, bounded parser, private assets and origin isolation',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'daylight-http-test-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14318',NEBIUS_API_KEY:'',GOOGLE_MAPS_API_KEY:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',DAYLIGHT_DATA_DIR:directory},stdio:['ignore','pipe','pipe'],windowsHide:true});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'error').then(([e])=>{throw e;})]);
    const base='http://127.0.0.1:14318';
    const status=await fetch(base+'/api/status').then(r=>r.json());
    assert.equal(status.mode,'demo');assert.equal(status.model,null);
    const mapConfig=await fetch(base+'/api/maps/config').then(r=>r.json());assert.equal(mapConfig.key,process.env.GOOGLE_MAPS_BROWSER_KEY||'');
    const req={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Haircut, ramen and a film, budget 180, return by 7 pm',current:DEFAULT})};
    const result=await fetch(base+'/api/intent',req).then(r=>r.json());
    assert.equal(result.mode,'demo');assert.equal(result.constraints.budget,180);assert.equal(result.constraints.deadline,1140);
    const unsupported=await fetch(base+'/api/intent',{...req,body:JSON.stringify({text:'Buy cinema tickets'})}).then(r=>r.json());
    assert.equal(unsupported.supported,false);
    assert.equal((await fetch(base+'/.env')).status,404);
    assert.equal((await fetch(base+'/server.mjs')).status,404);
    assert.equal((await fetch(base+'/data/local.key')).status,404);
    assert.equal((await fetch(base+'/data/daylight.sqlite')).status,404);
    assert.equal(status.maps.configured,false);assert.equal(status.calendar.connected,false);
    assert.equal((await fetch(base+'/api/google/connect',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/calendar/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'made-up'})})).status,400);
    const noMaps=await fetch(base+'/api/live/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'origin',query:'Stockholm Centralstation'})}).then(r=>r.json());assert.match(noMaps.error,/not configured/);assert.equal(noMaps.places,undefined);
    assert.equal((await fetch(base+'/api/intent',{...req,headers:{...req.headers,Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(base+'/api/intent',{...req,body:JSON.stringify({text:'x'.repeat(2001)})})).status,400);
    const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/default-src 'self'/);
    for(const path of ['/voice-core.mjs','/voice-ui.mjs','/local-recognition.mjs']){const asset=await fetch(base+path);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);}
    assert.equal((await fetch(base+'/api/voice/transcribe',{...req,headers:{...req.headers,Origin:'https://example.com'}})).status,403);
    const invalidVoice=await fetch(base+'/api/voice/transcribe',{...req,body:JSON.stringify({audio:'bad',language:'en',mime:'audio/webm'})}).then(r=>r.json());assert.match(invalidVoice.error,/recording/i);
  }finally{child.kill();await once(child,'exit');assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&directory.includes('daylight-http-test-'));rmSync(directory,{recursive:true,force:true});}
});
