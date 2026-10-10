// Opt-in live model/maps/source/calendar reads. No write/preview/confirm endpoint.
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(!process.argv.includes('--live'))throw Error('Pass --live for read-only integration acceptance.');
let slots={},history=[],journeyId,choice;const turns=[];
async function turn(text){
 const started=Date.now();const r=await fetch('http://127.0.0.1:4318/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,history:history.slice(-12),slots,journeyId,choice}),signal:AbortSignal.timeout(210000)});
 const result=await r.json();turns.push({text,elapsedMs:Date.now()-started,status:r.status,result});
 await writeFile(new URL('../artifacts/agent-chain-live.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),scope:'Actual configured model, official sources, Maps, and calendar reads. No writes.',turns},null,2));
 console.log(JSON.stringify({turn:turns.length,status:r.status,message:result.message,stopReason:result.stopReason,activities:result.slots?.activities,evidence:!!result.slots?.evidenceId,plans:result.journey?.plans.length,actions:result.trace?.map(t=>({action:t.action,label:t.label,status:t.status,summary:t.summary}))}));
 assert.equal(r.status,200);slots=result.slots||slots;journeyId=result.journey?.id||journeyId;choice=result.choice||choice;history.push({role:'user',content:text},{role:'assistant',content:result.message.slice(0,1000)});return result;
}
const discovery=await turn('今天市区内有什么有趣的活动吗？');
assert.ok(discovery.cards?.some(c=>c.type==='event'));assert.ok(!discovery.trace.some(t=>t.action==='read_news'));
const request=await turn('今天我想去Engla Li音乐会，中午吃海鲜自助餐，去Gamla Stan的海边走走，购买一些纪念品，还需要去超市采购食材，帮我规划行程');
assert.equal(request.stopReason,'needs_input');assert.equal(request.slots.activities.length,5);assert.equal(request.slots.date,new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Stockholm'}).format(new Date()));
const plan=await turn('从 Gamla Stan 地铁站出发，预算不限，11:30出发，23:00前返回。请保留这五项活动。');
assert.equal(plan.slots.activities.length,5);assert.ok(plan.journey||plan.lastAttempt,'Must actually attempt planning or explicitly explain a concrete source blocker');
assert.equal(plan.slots.budgetMode,'unlimited');assert.equal(plan.slots.start,'11:30');assert.equal(plan.slots.deadline,'23:00');
const meal=Object.values(plan.slots.activityDefinitions).find(a=>a.label.includes('海鲜'));
assert.ok(meal?.windowStart&&meal?.windowEnd&&meal?.windowQuote?.includes('中午'),'The midday meal constraint must survive intake');
for(const a of Object.values(plan.slots.activityDefinitions).filter(a=>a.id!==meal.id&&!a.eventRef)){assert.equal(a.windowStart,null,'Freely schedulable activities must not get invented windows');assert.equal(a.windowEnd,null);}
assert.match(plan.message,/活动时间解释：/,'Broad time windows need a disclosed interpretation');
const source=Object.values((plan.journey||plan.lastAttempt).sourceChecks).find(e=>e.title==='Engla Li');assert.equal(source?.start,1260);assert.equal(source?.duration,60);
if(plan.lastAttempt)assert.match(plan.message,/还没有重新核对/,'A stale attempt must never be presented as the current plan');
assert.doesNotMatch(plan.message,/Mountain Goats/,'An unselected discovery suggestion cannot become a calendar conflict');
for(const p of plan.journey?.plans||[]){assert.equal(p.stops.length,5);const concert=p.stops.find(s=>s.verification?.reportedBy==='source');assert.ok(concert);assert.equal(concert.start,1260);assert.equal(concert.end,1320);}
assert.ok(!plan.trace.some(t=>t.action==='calendar_confirm'));
