// Opt-in replay of the observed dialogue. Uses live read services, never writes Calendar.
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(!process.argv.includes('--live'))throw Error('Pass --live for read-only acceptance.');
let slots={},history=[];const turns=process.argv.includes('--resume')?JSON.parse(await readFile(new URL('../artifacts/event-venue-live.json',import.meta.url),'utf8')).turns:[];
for(const t of turns){slots=t.result.slots;history.push({role:'user',content:t.text},{role:'assistant',content:t.result.message.slice(0,1000)});}
async function turn(text){
 const start=Date.now();const response=await fetch('http://127.0.0.1:4318/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,history,slots}),signal:AbortSignal.timeout(210000)});
 const result=await response.json();turns.push({text,elapsedMs:Date.now()-start,status:response.status,result});
 await writeFile(new URL('../artifacts/event-venue-live.json',import.meta.url),JSON.stringify({scope:'Live model, sources, Maps and calendar reads only.',turns},null,2));
 console.log(JSON.stringify({turn:turns.length,status:response.status,stopReason:result.stopReason,message:result.message,actions:result.trace?.map(t=>({action:t.action,status:t.status,summary:t.summary}))}));
 assert.equal(response.status,200);slots=result.slots;history.push({role:'user',content:text},{role:'assistant',content:result.message.slice(0,1000)});return result;
}
if(!turns.length)await turn('今天斯德哥尔摩有什么有趣的活动？');
const text='我想去City Walk, 吃海鲜自助餐，买一些纪念品，去KTH参观一下，还要去超市购买食材，帮我规划一下行程';
const request=turns[1]?.result||await turn(text);
assert.ok(request.slots.task.requests.includes(text),'Clarification must retain the complete request even while structured fields are incomplete');
const result=await turn('从Fridhemsplan地铁站出发，时间没有hard limit');
assert.equal(result.slots.activities.length,5);assert.match(result.slots.origin,/Hags/i);
assert.ok(result.journey||result.lastAttempt,'Must reach actual planning, not ask the user to translate a venue name');
const checked=result.journey||result.lastAttempt;
const walk=Object.values(checked.sourceChecks).find(c=>c.title.startsWith('City Walk'));
assert.equal(walk.start,1050);assert.equal(walk.duration,60);assert.equal(walk.venueMatch.method,'localized_name_and_coordinates');
assert.ok(!result.trace.some(t=>t.status==='error'&&/不符/.test(t.summary)&&/Starts by Östermalm Saluhall/.test(t.summary)));
console.log('PASS: all five activities retained, source meeting point resolved, actual planning attempted; no writes.');
