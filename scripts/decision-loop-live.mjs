// Controlled replay: real configured model, fictional places/calendar/source data.
import {runAgent} from '../lib/agent.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
if(!process.argv.includes('--live-model'))throw Error('Use --live-model for an explicit model-only replay.');
const tag=process.argv.find(x=>x.startsWith('--tag='))?.slice(6)||'baseline';
if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid tag');
const config={key:process.env.NEBIUS_API_KEY,model:process.env.NEBIUS_MODEL,base:process.env.NEBIUS_BASE_URL};
const date='2026-10-08',location={latitude:59.33,longitude:18.06};
const events=[{ref:'event_111111111111',title:'Cantaloope at Haymarket',venue:'Haymarket by Scandic',start:date,end:date,occurrences:[{date,start:'21:00',end:'23:00'}],url:'https://www.visitstockholm.com/events/fixture-jazz/',location},{ref:'event_222222222222',title:'Thursday evenings at Nationalmuseum',venue:'Nationalmuseum',start:date,end:date,occurrences:[{date,start:'17:00',end:'20:00'}],url:'https://www.visitstockholm.com/events/fixture-art/',location}];
const defs=[['jazz',events[0].title,'Haymarket by Scandic','event_111111111111'],['art',events[1].title,'Nationalmuseum','event_222222222222'],['seafood','海鲜自助','seafood buffet',null],['forest','森林散步','forest',null],['hair','理发','hair salon',null]].map(([id,label,query,eventRef])=>({id,label,query,eventRef,requiredNames:eventRef?[query]:[],duration:eventRef?(id==='jazz'?120:180):60,allowance:null,availability:eventRef?'session':'venue',windowStart:null,windowEnd:null,windowQuote:null}));
const original='前两个活动我都感兴趣，但我今天只能去其中一个；另外我还想去吃海鲜自助，在森林里散一会儿步，还需要理发，帮我规划一下行程';
let slots={date,origin:'KTH',budgetMode:'unknown',timeMode:'unknown',activities:defs,task:{kind:'planning',status:'active',requests:[original,'从KTH出发']}},previous;
const history=[{role:'assistant',content:'Cantaloope at Haymarket：21:00–23:00；Thursday evenings at Nationalmuseum：17:00–20:00。来源场次已取得，预约与余票未核实。'},{role:'user',content:original},{role:'assistant',content:'你今天从哪里出发？'},{role:'user',content:'从KTH出发'},{role:'assistant',content:'你希望何时开始？是否有必须返回的时间或预算上限？'}];
const place=(id,name)=>({id,name,location,periods:[{open:{day:0,hour:0}}],website:'https://fixture.invalid/'+id});
const places=[place('origin','KTH'),...defs.map(a=>place(a.id,a.query))];let saves=[];
const services={evidence:events,maps:{search:async q=>{const s=q.toLowerCase();return /kth/.test(s)?[places[0]]:/haymarket|jazz|爵士/.test(s)?[places[1]]:/nationalmuseum|museum|博物馆/.test(s)?[places[2]]:/seafood|buffet|海鲜|自助/.test(s)?[places[3]]:/forest|skog|森林|自然/.test(s)?[places[4]]:[places[5]];},details:async id=>places.find(p=>p.id===id),route:async()=>({minutes:10,walking:3,mode:'transit',fare:{currencyCode:'SEK',units:'20'}})},calendarDay:async()=>({date,connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:v=>{saves.push(v);return 'fixture-'+saves.length;},eventDetails:async url=>events.find(e=>e.url===url),readPlaceWebsite:async url=>({url,text:'Fictional controlled fixture: seafood buffet available, public forest paths, haircuts. Availability and prices require verification.',links:[],checkedAt:new Date().toISOString()})};
mkdirSync('artifacts',{recursive:true});const report={scope:'REAL model, FICTIONAL Maps/calendar/events/providers. Seeded pre-budget state, NOT a recovered historical request. No Google reads/writes.',sourceHash:createHash('sha256').update(readFileSync('lib/agent.mjs')).digest('hex'),turns:[]};
for(const text of ['计划早上出发，没有返回时间和预算','你更推荐哪一个？','你自行决定']){
 const audit=[];const result=await runAgent({text,slots,history:history.slice(-12),choice:'0'},config,{...services,previous},{onDiagnostic:e=>audit.push(e),timeLimit:120000,maxRounds:18});
 report.turns.push({text,result,audit});writeFileSync(`artifacts/decision-loop-${tag}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({text,stop:result.stopReason,budget:result.slots?.budgetMode,activities:result.slots?.activities,message:result.message,actions:audit.filter(e=>e.kind==='tool_result').map(e=>({name:e.action,budgetInput:e.arguments?.patch?.budgetMode,budgetBefore:e.before.budgetMode,budgetAfter:e.after.budgetMode,error:e.error}))}));
 slots=result.slots;if(result.journey)previous=saves.at(-1);history.push({role:'user',content:text},{role:'assistant',content:result.message.slice(0,1000)});
}

const [a,b,c]=report.turns;
report.acceptance={budgetRetained:report.turns.every(t=>t.result.slots.budgetMode==='unlimited'),recommendationAnswered:b.result.stopReason==='finished'&&b.result.outcome==='discussion',allTurnsFinished:report.turns.every(t=>t.result.stopReason==='finished'),alternativesPreserved:c.result.slots.activities.length===5&&c.result.slots.choiceGroups?.some(g=>g.options.length===2&&g.selected),exclusivePlan:!!saves.at(-1)?.result?.plans?.length&&saves.at(-1).result.plans.every(p=>p.stops.length===4&&p.stops.filter(s=>['art','jazz'].includes(s.kind)).length===1)};
report.acceptance.passed=Object.values(report.acceptance).every(Boolean);
writeFileSync(`artifacts/decision-loop-${tag}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({acceptance:report.acceptance}));
if(!report.acceptance.passed)process.exitCode=1;
