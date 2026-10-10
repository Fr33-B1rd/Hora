// Fixed evaluation set: real configured model, fictional deterministic world, no calendar writes.
//   node --env-file=.env scripts/eval-conversations.mjs --live [--label name] [--only id,id] [--repeat 2]
//        [--concurrency 3] [--root path/to/code/snapshot] [--compare artifacts/evals/older.json]
// Run it before and after a change and compare; do not tune to a single transcript.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {conversations,universal,places,events,news,calendars,today} from '../evals/conversations.mjs';
const flag=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
if(!process.argv.includes('--live'))throw Error('Pass --live to opt into configured model usage.');
const root=pathToFileURL(resolve(flag('root','.'))+'/').href;
const {runAgent}=await import(root+'lib/agent.mjs'),{instant}=await import(root+'lib/time.mjs');
const config={key:process.env.NEBIUS_API_KEY,base:process.env.NEBIUS_BASE_URL,model:process.env.NEBIUS_MODEL};
const label=flag('label','run'),only=flag('only','')?.split(',').filter(Boolean),repeat=Number(flag('repeat',1)),concurrency=Number(flag('concurrency',3));

const byId=new Map(places.map(([,p])=>[p.id,p]));
const km=(a,b)=>{const rad=Math.PI/180,x=(b.longitude-a.longitude)*rad*Math.cos((a.latitude+b.latitude)*rad/2),y=(b.latitude-a.latitude)*rad;return 6371*Math.hypot(x,y);};
function world(calendar){
  let evidence=[];const journeys=new Map();
  const services={
    maps:{search:async q=>[...new Set(places.filter(([re])=>re.test(q)).map(([,p])=>p))].slice(0,4).map(p=>structuredClone(p)),details:async id=>structuredClone(byId.get(id)),
      route:async(from,to,_at,transport)=>{const d=km(byId.get(from).location,byId.get(to).location),minutes=Math.round(transport==='walk'?d*12:6+d*5);return {minutes,walking:transport==='walk'?minutes:Math.min(minutes,6),lines:transport==='walk'?[]:['T14'],mode:transport==='walk'?'walk':'transit',fare:{currencyCode:'SEK',units:transport==='walk'?'0':'43'}};}},
    calendarDay:async date=>({date,connected:true,busy:(calendars[calendar]?.[date]||[]).map(([a,b])=>({start:instant(date,a),end:instant(date,b)})),own:[]}),
    getChecks:()=>({revision:0,items:{}}),saveJourney:value=>{const id='journey-'+(journeys.size+1);journeys.set(id,value);return id;},
    readNews:async()=>({message:'',cards:structuredClone(news)}),
    nearbyEvents:async(_origin,{days=1,from=today}={})=>{const last=new Date(Date.parse(from+'T12:00:00Z')+(days-1)*86400000).toISOString().slice(0,10);return {events:structuredClone(events.filter(e=>e.occurrences.some(o=>o.date>=from&&o.date<=last))),origin:'T-Centralen',message:''};},
    eventDetails:async url=>structuredClone(events.find(e=>e.url===url)),
    saveEvidence:found=>{if(found.length)evidence=found;return found.length?'evidence':null;}
  };
  return {services,journeys,evidence:()=>evidence};
}
async function converse(c,rep){
  const w=world(c.calendar),history=[],turns=[];let slots,journey,choice,before;
  for(const t of c.turns){
    const raw={text:t.say,history:history.slice(-12),slots,...(journey?{journeyId:journey.id,choice}:{})};
    let r;
    try{r=await runAgent(raw,config,{...w.services,evidence:w.evidence(),previous:journey?w.journeys.get(journey.id):null});}
    catch(error){r={message:'',stopReason:'service_error',slots:slots||{activities:[],precedence:[],activityDefinitions:{}},trace:[],timings:[],elapsedMs:0,thrown:error.message};}
    if(r.journey)journey=r.journey;if(r.choice!==undefined)choice=r.choice;
    const current=r.journey||(r.stale?null:journey),plan=current?.plans.find(p=>p.id===(r.choice??choice))||current?.plans[0]||null;
    const context={r,s:r.slots,reply:r.message||'',trace:r.trace||[],plan:r.journey?plan:(r.stale?null:plan),before};
    const failed=[...universal,...t.checks].filter(([,check])=>{try{return !check(context);}catch{return true;}}).map(([name])=>name);
    const model=(r.timings||[]).filter(x=>x.stage!=='tool');
    turns.push({say:t.say,stopReason:r.stopReason,seconds:+(r.elapsedMs/1000).toFixed(1),modelRequests:model.length,toolErrors:(r.trace||[]).filter(x=>x.status!=='ok').length,errors:(r.trace||[]).filter(x=>x.status!=='ok').map(x=>(x.action||'host')+': '+String(x.summary).slice(0,240)),checks:universal.length+t.checks.length,failed,reply:r.message,tools:(r.trace||[]).map(x=>(x.action||'host')+(x.status==='ok'?'':'!')).join(' '),thrown:r.thrown});
    slots=r.slots;history.push({role:'user',content:t.say},{role:'assistant',content:(r.message||'').slice(0,1000)});before=r.journey?r:before;
  }
  return {id:c.id,rep,turns,passed:turns.every(t=>!t.failed.length)};
}
const queue=conversations.filter(c=>!only.length||only.includes(c.id)).flatMap(c=>Array.from({length:repeat},(_,rep)=>[c,rep])),results=[];
await Promise.all(Array.from({length:concurrency},async()=>{for(;;){const next=queue.shift();if(!next)return;const row=await converse(...next);results.push(row);console.log((row.passed?'PASS ':'FAIL ')+row.id+row.turns.map(t=>`  [${t.stopReason} ${t.seconds}s${t.failed.length?' ✗ '+t.failed.join('; '):''}]`).join(''));}}));
results.sort((a,b)=>a.id.localeCompare(b.id)||a.rep-b.rep);
const turns=results.flatMap(r=>r.turns),median=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)]??0,sum=(v,k)=>v.reduce((n,x)=>n+x[k],0);
const summary={label,model:config.model,at:new Date().toISOString(),conversations:results.length,conversationsPassed:results.filter(r=>r.passed).length,turns:turns.length,turnsPassed:turns.filter(t=>!t.failed.length).length,checks:sum(turns,'checks'),checksPassed:sum(turns,'checks')-turns.reduce((n,t)=>n+t.failed.length,0),medianSeconds:median(turns.map(t=>t.seconds)),p90Seconds:[...turns.map(t=>t.seconds)].sort((a,b)=>a-b)[Math.floor(turns.length*.9)]??0,modelRequests:sum(turns,'modelRequests'),toolErrors:sum(turns,'toolErrors')};
await mkdir(new URL('../artifacts/evals/',import.meta.url),{recursive:true});
const file=new URL(`../artifacts/evals/${label}-${summary.at.replace(/[:.]/g,'-')}.json`,import.meta.url);
await writeFile(file,JSON.stringify({summary,results},null,1));
console.log('\n'+JSON.stringify(summary,null,1)+'\nSaved '+file.pathname.split('/').slice(-3).join('/'));
if(flag('compare')){
  const old=JSON.parse(await readFile(flag('compare'),'utf8')),was=new Map(old.results.map(r=>[r.id+'#'+r.rep,r.passed]));
  const changed=results.filter(r=>was.has(r.id+'#'+r.rep)&&was.get(r.id+'#'+r.rep)!==r.passed);
  console.log(`Compared with ${old.summary.label}: conversations ${old.summary.conversationsPassed}/${old.summary.conversations} → ${summary.conversationsPassed}/${summary.conversations}, checks ${old.summary.checksPassed}/${old.summary.checks} → ${summary.checksPassed}/${summary.checks}, median ${old.summary.medianSeconds}s → ${summary.medianSeconds}s`);
  for(const r of changed)console.log((r.passed?'  fixed    ':'  regressed ')+r.id);
}
