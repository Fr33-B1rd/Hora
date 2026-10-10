// Daylight's outing planner as a tool server (Model Context Protocol over stdio).
// The model states what the user wants; the checking is done here: real
// places, opening hours, travel times, the user's calendar.
//   node --env-file=.env mcp/planner-server.mjs
// Nothing here can write a calendar, book or pay.
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createAgentEnvironment} from '../lib/agent-tools.mjs';
import {createMaps} from '../lib/maps.mjs';
import {nearbyEvents,eventDetails} from '../lib/nearby-events.mjs';
import {localNews} from '../lib/local-news.mjs';
import {dateInStockholm,dayBounds,validDate} from '../lib/time.mjs';

const clockText={type:'string',pattern:'^([01]\\d|2[0-4]):[0-5]\\d$',description:'24-hour HH:MM, Stockholm time'};
export const tools=[
  {name:'plan_day',description:'Plan a day out in Stockholm and check it against real places, opening hours, travel times and the user’s calendar. Returns up to three checked plans, or the specific reason nothing fits. Pass only what the user actually said: leave time, return time and budget are optional and must be omitted when not stated. Does not book, pay or write the calendar.',inputSchema:{type:'object',required:['date','from','activities'],properties:{
    date:{type:'string',description:'YYYY-MM-DD in Stockholm; today is in the server instructions'},
    from:{type:'string',description:'Departure landmark or station the user named, e.g. “Slussen”'},
    activities:{type:'array',minItems:1,maxItems:6,items:{type:'object',required:['name'],properties:{
      name:{type:'string',description:'What the user wants to do, in their words'},
      search:{type:'string',description:'Place search terms if different from name, e.g. “sushi restaurant Södermalm”'},
      place:{type:'string',description:'Exact venue name, only when the user named one'},
      minutes:{type:'integer',minimum:10,maximum:240,description:'Stay length; omit to use 60'},
      earliest:clockText,latest:{...clockText,description:'Latest finish, 24-hour HH:MM'},
      meetingPoint:{type:'boolean',description:'True when it is only a place to meet or an outdoor walk, so opening hours do not apply'}}}},
    keepOrder:{type:'boolean',description:'True when the user’s words give an order (“first”, “then”, “after”, “before”): list activities in that order. False or omitted when they only listed things.'},
    leaveAt:clockText,backBy:clockText,
    budgetSEK:{type:'number',minimum:0,description:'Only if the user gave a spending limit'},
    transport:{type:'string',enum:['transit','walk']},
    maxWalkingMinutes:{type:'integer',minimum:0,maximum:180}}}},
  {name:'find_events',description:'Curated Visit Stockholm events with a session on the given date (and following days). Not a complete listing; ticket availability is unknown.',inputSchema:{type:'object',additionalProperties:false,required:['date'],properties:{date:{type:'string',description:'YYYY-MM-DD'},days:{type:'integer',minimum:1,maximum:14},near:{type:'string',description:'Landmark to search around; defaults to Stockholm Central'}}}},
  {name:'local_news',description:'Recent Stockholm regional headlines from SVT with links (titles and summaries, not full articles).',inputSchema:{type:'object',additionalProperties:false,properties:{}}}
];

const services=()=>{
  const maps=createMaps(process.env.GOOGLE_MAPS_API_KEY);
  // The calendar is optional here: without it, plans are checked against places and travel only.
  const calendar=async date=>{try{const {createStore}=await import('../lib/store.mjs'),{createCalendar}=await import('../lib/calendar.mjs');const store=createStore(process.env.DAYLIGHT_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url)));const c=createCalendar({clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirect:process.env.GOOGLE_REDIRECT_URI||'http://127.0.0.1:4318/api/google/callback'},store);if(c.status().connected)return await c.day(date);}catch{}return {date,...dayBounds(date),busy:[],own:[],connected:false};};
  return {maps,calendarDay:calendar,getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'mcp',evidence:[],eventDetails};
};

export async function planDay(args,make=services){
  validDate(args.date);
  const text=JSON.stringify(args),env=createAgentEnvironment({text},make());
  const activities=args.activities.map((a,i)=>({id:'a'+(i+1),label:a.name,query:a.search||a.place||a.name,requiredNames:a.place?[a.place]:[],duration:a.minutes||60,allowance:null,eventRef:null,windowStart:a.earliest||null,windowEnd:a.latest||null,windowQuote:null,availability:'venue',...(a.meetingPoint?{hours:'not_needed'}:{})}));
  await env.handlers.update_trip({by:'user',patch:{date:args.date,origin:args.from,originQuote:args.from,activities,
    ...(args.keepOrder?{precedence:activities.slice(1).map((a,i)=>({before:activities[i].id,after:a.id}))}:{}),
    ...(args.leaveAt?{start:args.leaveAt}:{}),...(args.backBy?{deadline:args.backBy}:{}),...(args.leaveAt||args.backBy?{timeMode:'fixed'}:{}),
    ...(args.budgetSEK!=null?{budgetMode:'limited',budget:args.budgetSEK}:{}),...(args.transport?{transport:args.transport}:{}),...(args.maxWalkingMinutes!=null?{maxWalking:args.maxWalkingMinutes}:{})}});
  // Everything in a tool call is what the caller asked for, so none of it is a soft assumption.
  for(const key of Object.keys(env.state.labels))env.state.labels[key]='user';
  let r;
  try{r=await env.handlers.plan_itinerary({});}
  catch(error){return {status:'not_planned',reason:error.message,missing:error.details?{fields:error.details.missingFields,places:error.details.missingCandidates?.map(a=>a.label)}:undefined,calendarWritten:false};}
  const journey=env.output().journey;
  return {status:r.planChoices.length?(r.status==='route_draft'?'draft_needs_verification':'planned'):'nothing_fits',date:args.date,from:r.actualOrigin?.name,
    plans:r.planChoices.map(p=>({option:p.displayNumber,name:p.name,stops:p.stops,legs:p.legs.map(l=>({mode:l.mode,depart:l.depart,arrive:l.arrive,minutes:l.minutes})),backAt:p.returnAt,estimatedCostSEK:p.reserveSEK,walkingMinutes:p.walking,waits:(p.gaps||[]).filter(g=>g.minutes>=30).map(g=>g.minutes+' min')})),
    ...(r.planChoices.length?{}:{why:r.outcome,blockers:(r.diagnostics||[]).slice(0,4).map(d=>d.message),ways_forward:(r.repairOptions||[]).map(o=>o.explanation)}),
    notes:(journey?.notes||[]).slice(0,6),limitsApplied:{leaveAt:args.leaveAt||null,backBy:args.backBy||null,budgetSEK:args.budgetSEK??null},calendarChecked:journey?.calendarConnected===true,
    caveats:['Times and costs are estimates.','Opening hours do not guarantee a table, a ticket or stock.'],calendarWritten:false};
}
export async function findEvents({date,days=1,near='Stockholm Centralstation'},make=services){
  validDate(date);const r=await nearbyEvents(near,make().maps,{days,from:date});
  return {date,days,source:'Visit Stockholm (curated)',events:r.events.map(e=>({title:e.title,venue:e.venue,sessions:e.occurrences?.length?e.occurrences:'no session times published',description:(e.description||'').slice(0,300),link:e.url}))};
}
const handlers={plan_day:planDay,find_events:findEvents,local_news:async()=>{const r=await localNews();return {source:'SVT Stockholm',items:r.cards.map(c=>({title:c.translatedTitle||c.title,original:c.title,published:c.publishedAt,link:c.url}))};}};

// Minimal JSON-RPC 2.0 over newline-delimited stdio, as MCP's stdio transport specifies.
export async function respond(message,run=handlers){
  const {id,method,params}=message;
  if(id===undefined)return null;
  const ok=result=>({jsonrpc:'2.0',id,result});
  if(method==='initialize')return ok({protocolVersion:params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'daylight-planner',version:'0.1.0'},instructions:`Daylight plans days out in Stockholm (SEK, Europe/Stockholm). Today is ${dateInStockholm()}.`});
  if(method==='ping')return ok({});
  if(method==='tools/list')return ok({tools});
  if(method==='tools/call'){
    const handler=run[params?.name];
    if(!handler)return {jsonrpc:'2.0',id,error:{code:-32602,message:'Unknown tool: '+params?.name}};
    try{return ok({content:[{type:'text',text:JSON.stringify(await handler(params.arguments||{}))}]});}
    catch(error){return ok({isError:true,content:[{type:'text',text:error.message}]});}
  }
  return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found: '+method}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const lines=createInterface({input:process.stdin});
  for await(const line of lines){
    if(!line.trim())continue;
    let reply;try{reply=await respond(JSON.parse(line));}catch{reply={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
    if(reply)process.stdout.write(JSON.stringify(reply)+'\n');
  }
}
