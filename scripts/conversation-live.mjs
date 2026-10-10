// Opt-in: real configured model, fictional provider observations, no calendar writes.
// Replays a short multi-turn chat and reports what the user would experience:
// node --env-file=.env scripts/conversation-live.mjs --live
import {runAgent} from '../lib/agent.mjs';
if(!process.argv.includes('--live'))throw Error('Pass --live to opt into configured model usage.');
const config={key:process.env.NEBIUS_API_KEY,base:process.env.NEBIUS_BASE_URL,model:process.env.NEBIUS_MODEL};
const tomorrow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'}).format(Date.now()+86400000);
const at=(id,name,latitude,longitude)=>({id,name,address:name+', Stockholm',location:{latitude,longitude},rating:4.4,hours:['Daily 10:00–22:00'],periods:null});
const places=[[/kth/i,at('fx-kth','KTH Royal Institute of Technology',59.347,18.073)],[/jazz|fasching/i,at('fx-jazz','Fasching',59.332,18.055)],[/mall|shopping|galleria/i,at('fx-mall','Mall of Scandinavia',59.370,18.004)],[/chinese|restaurant/i,at('fx-food','Formosa Restaurang',59.336,18.063)],[/gamla/i,at('fx-old','Gamla Stan',59.325,18.071)]];
const event={ref:'event_f1c7a2e00001',title:'Stockholm Jazz Festival',description:'Concerts on historic stages across the city, with both legendary and new jazz acts.',venue:'Fasching',start:tomorrow,end:tomorrow,url:'https://www.visitstockholm.com/events/fixture-jazz/',occurrences:[{date:tomorrow,start:'19:00',end:'21:00'}],location:{latitude:59.332,longitude:18.055},checkedAt:new Date().toISOString()};
const services=()=>({
  maps:{search:async q=>places.filter(([re])=>re.test(q)).map(([,p])=>p),details:async id=>places.find(([,p])=>p.id===id)[1],route:async()=>({minutes:18,walking:6,lines:['T14'],mode:'transit',fare:{currencyCode:'SEK',units:'43'}})},
  calendarDay:async date=>({date,connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'fixture-journey',
  readNews:async()=>({message:'',cards:[]}),nearbyEvents:async()=>({events:[event],message:'',origin:'Stockholm'}),eventDetails:async()=>event,evidence:[event]
});
const turns=process.argv.slice(2).filter(a=>a!=='--live');
if(!turns.length)turns.push('Any interesting events in town?','tomorrow I want to go to Jazz Festival, do some shopping in a mall, have some Chinese cuisine and take a walk around Gamla Stan. Make a plan','I will start from KTH around 10, no budget limit, back whenever');
const history=[],report=[];let slots;
for(const text of turns){
  const r=await runAgent({text,history:history.slice(-12),slots},config,services());
  slots=r.slots;history.push({role:'user',content:text},{role:'assistant',content:r.message.slice(0,1000)});
  const model=r.timings.filter(t=>t.stage!=='tool');
  report.push({text,stopReason:r.stopReason,outcome:r.outcome,seconds:+(r.elapsedMs/1000).toFixed(1),modelRequests:model.length,promptTokens:model.reduce((n,t)=>n+(t.usage?.promptTokens||0),0),tools:r.trace.map(t=>t.action+(t.status==='ok'?'':'!')).join(' '),errors:r.trace.filter(t=>t.status!=='ok').map(t=>(t.action||t.label)+': '+t.summary),plans:r.journey?.plans.length,activities:r.slots.activities,precedence:r.slots.precedence,message:r.message});
  console.log(JSON.stringify(report.at(-1),null,1));
}
