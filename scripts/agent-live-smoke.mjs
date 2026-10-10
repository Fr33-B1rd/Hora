// Opt-in: real configured model, fictional provider observations, no calendar writes.
// node --env-file=.env scripts/agent-live-smoke.mjs --live
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {runAgent} from '../lib/agent.mjs';
if(!process.argv.includes('--live'))throw Error('Pass --live to opt into configured model usage.');
const config={key:process.env.NEBIUS_API_KEY,base:process.env.NEBIUS_BASE_URL,model:process.env.NEBIUS_MODEL};
const origin={id:'fixture-station',name:'T-Centralen',location:{latitude:59.33,longitude:18.06},hours:['Daily 10:00–19:00'],periods:null};
const right={...origin,id:'fixture-books',name:'Northstar Books'},wrong={...origin,id:'fixture-other',name:'Different Bookshop'};
let activitySearches=0,routeCalls=0;const queries=[],actions=[];
const result=await runAgent({text:'这是隔离验收，地点数据都是测试数据。明天从 T-Centralen 去 Northstar Books 书店逛一个小时，必须是这家店。预算不限，出发和返回时间你来安排。请查到符合名称的店并生成行程。'},config,{
  maps:{search:async q=>{queries.push(q);return /central/i.test(q)&&!/book/i.test(q)?[origin]:++activitySearches===1?[wrong]:[right];},details:async id=>id===right.id?right:origin,route:async()=>{routeCalls++;return {minutes:10,walking:10,lines:[],mode:'walk',fare:{currencyCode:'SEK',units:'0'}};}},
  calendarDay:async date=>({date,connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=> 'fixture-journey',
  readNews:async()=>{throw Error('Not available in this fixture');},nearbyEvents:async()=>{throw Error('Not available in this fixture');}
},{fetchImpl:async(url,opts)=>{const r=await fetch(url,opts);if(r.ok){const v=await r.clone().json();actions.push(...(v.choices?.[0]?.message?.tool_calls||[]).map(c=>({name:c.function.name,args:JSON.parse(c.function.arguments)})));}return r;}});
const evidence={provider:'Real configured model; controlled fictional map/calendar observations',checkedAt:new Date().toISOString(),queries,actions,routeCalls,result};
await writeFile(new URL('../artifacts/agent-live-controlled.json',import.meta.url),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({message:result.message,stopReason:result.stopReason,queries,plans:result.journey?.plans.length,trace:result.trace},null,2));
assert.equal(result.stopReason,'finished');assert.ok(result.journey?.plans.length);assert.ok(activitySearches>=2);assert.ok(result.journey.plans.every(p=>p.stops[0].placeId===right.id));
