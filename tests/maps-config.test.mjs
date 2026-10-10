import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('map config exposes only browser key, refuses server-key reuse, and keeps credentials private',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'daylight-map-config-'));
  try{for(const browserKey of ['browser-test','server-secret']){
    const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14334',DAYLIGHT_DATA_DIR:directory,GOOGLE_MAPS_API_KEY:'server-secret',GOOGLE_MAPS_BROWSER_KEY:browserKey,NEBIUS_API_KEY:'private-model',GOOGLE_CLIENT_SECRET:'private-oauth'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    try{
      await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server exited');})]);
      const response=await fetch('http://127.0.0.1:14334/api/maps/config'),raw=await response.text();
      assert.equal(JSON.parse(raw).key,browserKey==='server-secret'?'':browserKey);assert.doesNotMatch(raw,/server-secret|private-model|private-oauth/);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.match(response.headers.get('content-security-policy'),/script-src 'self' https:\/\/maps.googleapis.com https:\/\/maps.gstatic.com;/);
      assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
      for(const asset of ['/journey-map.mjs','/route-geometry.mjs'])assert.equal((await fetch('http://127.0.0.1:14334'+asset)).status,200);
    }finally{child.kill();await once(child,'exit');}
  }}finally{assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&directory.includes('daylight-map-config-'));rmSync(directory,{recursive:true,force:true});}
});
