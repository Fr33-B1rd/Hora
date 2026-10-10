// Real model; controlled fictional Maps, sources and calendar fixtures. Never external writes.
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {runAgent} from '../lib/agent.mjs';
import {instant,intersects} from '../lib/time.mjs';
if(!process.argv.includes('--live-model'))throw Error('Pass --live-model to use the configured model with fictional test providers.');
const config={key:process.env.NEBIUS_API_KEY,model:process.env.NEBIUS_MODEL,base:process.env.NEBIUS_BASE_URL};
const lowEffort=process.argv.includes('--low-effort');
const fetchImpl=lowEffort?(url,opts)=>fetch(url,{...opts,body:JSON.stringify({...JSON.parse(opts.body),chat_template_kwargs:{enable_thinking:true,low_effort:true}})}):fetch;
assert.ok(config.key&&config.model&&config.base,'Model configuration required');
const date='2026-10-10',location={latitude:59.33,longitude:18.06};
const place=(id,name)=>({id,name,location,periods:[{open:{day:0,hour:0}}],website:'https://fixture.invalid/'+id});
const places=[place('station','Test Station'),place('museum','Test Museum'),place('food','Test Chinese Restaurant'),place('library','Test Library')];
let busy=[],previous,slots={},history=[],choice='0';const saved=[],turns=[];
const services={maps:{search:async q=>{const s=q.toLowerCase();return /station|车站/.test(s)?[places[0]]:/museum|博物馆/.test(s)?[places[1]]:/library|图书馆/.test(s)?[places[3]]:[places[2]];},details:async id=>places.find(p=>p.id===id),route:async()=>({minutes:10,walking:3,mode:'transit',fare:{currencyCode:'SEK',units:'20'}})},calendarDay:async()=>({date,connected:true,busy,own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:v=>{saved.push(v);return 'fixture-'+saved.length;},readPlaceWebsite:async url=>({url,text:'Fictional test source: Public museum, public library and Chinese restaurant. Open all day for this controlled test.',links:[],checkedAt:new Date().toISOString()})};
async function turn(text){
 const started=Date.now(),r=await runAgent({text,slots,history:history.slice(-12),journeyId:previous?'fixture-'+saved.length:undefined,choice},config,{...services,previous},{fetchImpl});
 turns.push({text,elapsedMs:Date.now()-started,result:r});
 await writeFile(new URL('../artifacts/planning-repair-model'+(lowEffort?'-low-effort':'')+'.json',import.meta.url),JSON.stringify({scope:'REAL configured model; ALL places, routes, source text and calendar intervals are fictional fixtures. No Google writes or reads.',lowEffort,turns},null,2));
 console.log(JSON.stringify({turn:turns.length,stop:r.stopReason,message:r.message,actions:r.trace.map(t=>({action:t.action,status:t.status,summary:t.summary}))}));
 slots=r.slots;choice=r.choice;if(r.journey)previous=saved.at(-1);history.push({role:'user',content:text},{role:'assistant',content:r.message.slice(0,1000)});return r;
}
const first=await turn('请规划2026年10月10日从 Test Station 出发逛博物馆、然后吃中餐的行程。钱这方面不用卡额度，出发和返回时间你看着安排，全天累计步行最多25分钟。不写日历。');
assert.equal(first.slots.budgetMode,'unlimited');assert.equal(first.slots.timeMode,'flexible');assert.equal(first.slots.maxWalking,25);assert.equal(first.slots.activities.length,2);assert.ok(first.journey?.plans.length,'Must actually plan, not repeat intake');assert.ok(first.slots.precedence.length,'Explicit activity order must be retained');
const chosen=first.journey.plans[0],s=chosen.stops[0];busy=[{start:instant(date,s.start),end:instant(date,s.end)}];
const revised=await turn('临时多了一个线上会议，已在日历里。请重新查空闲时间，把刚才的行程排开会议，其他偏好照旧。');
assert.ok(revised.journey?.plans.length);assert.equal(revised.slots.maxWalking,25);assert.equal(revised.slots.budgetMode,'unlimited');assert.ok(revised.slots.precedence.length);
for(const p of revised.journey.plans)assert.match(p.stops[0].label,/博物馆/);
for(const p of revised.journey.plans)for(const v of [...p.stops,...p.legs.map(l=>({start:l.depart,end:l.arrive}))])assert.ok(!intersects({start:instant(date,v.start),end:instant(date,v.end)},busy[0]));
const changed=await turn('把博物馆改为图书馆吧，还是先逛再吃中餐。其余不变；费用不必封顶。');
assert.equal(changed.slots.activities.length,2);assert.ok(Object.values(changed.slots.activityDefinitions).some(a=>/图书馆/.test(a.label)));assert.ok(!Object.values(changed.slots.activityDefinitions).some(a=>/博物馆/.test(a.label)));assert.equal(changed.slots.maxWalking,25);assert.equal(changed.slots.budgetMode,'unlimited');assert.ok(changed.journey?.plans.length);
console.log('PASS: live model preserved unlimited budget, delegated timing, low walking, meeting avoidance and changed activity over three turns. Fictional providers; no writes.');
