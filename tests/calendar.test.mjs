import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createCalendar, eventId } from '../lib/calendar.mjs';
import { instant } from '../lib/time.mjs';
const config={clientId:'fake-client',clientSecret:'fake-secret',redirect:'http://127.0.0.1:4318/api/google/callback'};
function fixture(){const state=new Map();let token={access_token:'fake-access',expiresAt:Date.now()+3600000};const store={get:k=>state.get(k),put:(k,v)=>state.set(k,v),remove:k=>state.delete(k),tokens:v=>v===undefined?token:(token=v)};const events=new Map(),calls=[];let serial=0,failAt=null,loseAt=null;
  const fetchImpl=async(url,o={})=>{const u=new URL(url),method=o.method||'GET';calls.push({url,method,body:o.body,headers:o.headers});
    if(u.hostname==='oauth2.googleapis.com')return {ok:true,json:async()=>({access_token:'new-access',refresh_token:'refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar.events.owned'})};
    if(method==='GET'&&u.searchParams.has('timeMin'))return {ok:true,json:async()=>({items:[...events.values()]})};
    const id=u.pathname.split('/').at(-1);
    if(method==='GET')return events.has(id)?{ok:true,json:async()=>events.get(id)}:{ok:false,status:404};
    const e=JSON.parse(o.body);
    if(failAt===e.extendedProperties.private.kind)return {ok:false,status:503};
    if(method==='POST'&&events.has(e.id))return {ok:false,status:409};
    if(method==='PUT'&&o.headers['If-Match']!==events.get(id)?.etag)return {ok:false,status:412};
    const result={...e,etag:String(++serial),htmlLink:'https://calendar.google.com/calendar/event?eid='+e.id};events.set(e.id,result);if(loseAt===e.extendedProperties.private.kind){loseAt=null;throw new Error('response lost');}return {ok:true,json:async()=>result};
  };
  return {store,events,calls,calendar:createCalendar(config,store,fetchImpl),fail(kind){failAt=kind;},lose(kind){loseAt=kind;}};
}
const date='2026-10-10',stops=[{kind:'hair',placeId:'h',start:800,end:845},{kind:'movie',placeId:'m',start:1020,end:1140,locked:true}];
test('generic additions retain unrelated events, reject overlaps and keep readable titles on retries',async()=>{
  const f=fixture(),empty=await f.calendar.day(date);await f.calendar.write(date,stops,empty,'old');
  const expected=await f.calendar.day(date),old=JSON.stringify([...f.events.values()]);
  const museum={kind:'museum',label:'visit museum',placeId:'museum1',start:600,end:720,tentative:true};
  await assert.rejects(f.calendar.write(date,[{...museum,start:810,end:900}],expected,'overlap',['hair','movie']),/conflict/);
  assert.equal(JSON.stringify([...f.events.values()]),old);
  await f.calendar.write(date,[museum],expected,'new',['hair','movie']);
  assert.equal(f.events.get(eventId(date,'movie')).etag,expected.own.find(e=>e.kind==='movie').etag);
  assert.match(f.events.get(eventId(date,'museum')).summary,/visit museum/);
  const writes=f.calls.filter(c=>c.method!=='GET').length;
  await f.calendar.write(date,[museum],expected,'new',['hair','movie']);assert.equal(f.calls.filter(c=>c.method!=='GET').length,writes);
});
test('OAuth state is tied to cookie, one-time and PKCE; disconnect clears token',async()=>{
  const f=fixture(),s=f.calendar.begin(),u=new URL(s.url);assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  await assert.rejects(f.calendar.callback('code',s.state,'wrong'),/not match/);await assert.rejects(f.calendar.callback('code',s.state,s.state),/not match/);
  const good=f.calendar.begin();await f.calendar.callback('code',good.state,good.state);assert.equal(f.calendar.status().connected,true);assert.match(f.calls.at(-1).body.toString(),/code_verifier/);
  await assert.rejects(f.calendar.callback('code',good.state,good.state),/not match/);f.calendar.disconnect();assert.equal(f.calendar.status().connected,false);
});
test('Calendar reads do not write; stable ids, no invitations, repeat confirmation no duplicate',async()=>{
  const f=fixture(),day=await f.calendar.day(date);assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
  const first=await f.calendar.write(date,stops,day,'proposal1');assert.equal(first.length,2);assert.equal(f.events.size,2);
  assert.ok([...f.events.keys()].every(id=>/^[a-v0-9]+$/.test(id)));
  assert.ok(f.calls.filter(c=>c.method==='POST').every(c=>c.url.endsWith('sendUpdates=none')&&!JSON.parse(c.body).attendees));
  await f.calendar.write(date,stops,day,'proposal1');assert.equal(f.events.size,2);assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
  assert.equal((await f.calendar.day(date)).own.length,2);
});
test('calendar conflict and changed locked movie reject entire write before any mutation',async()=>{
  const f=fixture(),day=await f.calendar.day(date);f.events.set('external',{id:'external',start:{dateTime:instant(date,810)},end:{dateTime:instant(date,850)}});
  await assert.rejects(f.calendar.write(date,stops,day,'proposal1'),/New.*conflict/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
  f.events.clear();await f.calendar.write(date,stops,day,'proposal1');const before=f.calls.filter(c=>c.method!=='GET').length,current=await f.calendar.day(date);
  await assert.rejects(f.calendar.write(date,[{...stops[0],start:900,end:945},{...stops[1],start:1040,end:1160}],current,'proposal2'),/locked/i);
  assert.equal(f.calls.filter(c=>c.method!=='GET').length,before);
});
test('manual edits after preview are retained and partial writes retry without duplicates',async()=>{
  const f=fixture(),day=await f.calendar.day(date);f.fail('movie');let partial;
  try{await f.calendar.write(date,stops,day,'proposal1');}catch(e){partial=e.partial;}
  assert.equal(partial.length,1);f.fail(null);await f.calendar.write(date,stops,day,'proposal1');assert.equal(f.events.size,2);
  const preview=await f.calendar.day(date);f.events.get(eventId(date,'hair')).etag='manually-edited';
  await assert.rejects(f.calendar.write(date,stops,preview,'proposal2'),/modified/);
  assert.equal(f.events.get(eventId(date,'hair')).etag,'manually-edited');
});
test('all-day events block the Stockholm day; a title is read, but never a description or the guests',async()=>{
  const f=fixture();f.events.set('external',{id:'external',summary:'Board meeting',description:'Private notes',attendees:[{email:'guest@example.com'}],start:{date},end:{date:'2026-10-11'}});const d=await f.calendar.day(date);assert.equal(d.busy.length,1);assert.equal(d.busy[0].start,instant(date,0));
  assert.equal(d.busy[0].title,'Board meeting');assert.equal(d.busy[0].allDay,true);assert.ok(!JSON.stringify(d).includes('Private notes'));assert.ok(!JSON.stringify(d).includes('guest@example.com'));
});
test('lost successful response is reconciled on retry without another insertion',async()=>{
  const f=fixture(),day=await f.calendar.day(date);f.lose('hair');await assert.rejects(f.calendar.write(date,stops,day,'proposal1'),/not be fully confirmed/);assert.equal(f.events.size,1);
  const retried=await f.calendar.write(date,stops,day,'proposal1');assert.equal(retried.length,2);assert.equal(f.events.size,2);assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
});
test('persistent store survives reopen with encrypted tokens and stable event ids',()=>{
  const dir=mkdtempSync(join(tmpdir(),'daylight-test-'));let s;
  try{s=createStore(dir);s.tokens({access_token:'sensitive-test-value',refresh_token:'refresh-test'});s.put('event:x',{id:'x',etag:'1'});s.close();s=createStore(dir);assert.equal(s.tokens().access_token,'sensitive-test-value');assert.equal(s.get('event:x').id,'x');s.close();s=null;for(const file of readdirSync(dir).filter(n=>n.includes('sqlite')))assert.ok(!readFileSync(join(dir,file)).includes(Buffer.from('sensitive-test-value')));}
  finally{s?.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+'\\daylight-test-')||resolve(dir).startsWith(resolve(tmpdir())+'/daylight-test-'));rmSync(dir,{recursive:true,force:true});}
});
