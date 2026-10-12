// Daylight's tool server (Model Context Protocol over stdio): the outing planner
// here, and the everyday tools for groceries and research in everyday-tools.mjs.
// The model states what the user wants; the checking is done here: real
// places, opening hours, travel times, the user's calendar.
//   node --env-file=.env mcp/planner-server.mjs
// Nothing here can write a calendar, book or pay.
import {createInterface} from 'node:readline';
import {mkdir,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createAgentEnvironment} from '../lib/agent-tools.mjs';
import {createMaps} from '../lib/maps.mjs';
import {nearbyEvents,eventDetails} from '../lib/nearby-events.mjs';
import {localNews} from '../lib/local-news.mjs';
import {dateInStockholm,dayBounds,validDate} from '../lib/time.mjs';
import {everydayTools,everydayHandlers} from './everyday-tools.mjs';
import {jobTools,jobHandlers} from './job-tools.mjs';
import {calendarTools,calendarHandlers,eventsOf,open as openCalendar} from './calendar-tools.mjs';

const clockText={type:'string',pattern:'^([01]\\d|2[0-4]):[0-5]\\d$',description:'24-hour HH:MM, Stockholm time'};
const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables, no bullet lists.';
export const tools=[
  {name:'plan_day',description:'Plan a day out in Stockholm and check it against real places, opening hours, travel times and the user’s calendar. Returns up to three checked plans, or the specific reason nothing fits. Pass only what the user actually said: leave time, return time and budget are optional and must be omitted when not stated. Does not book, pay or write the calendar.',inputSchema:{type:'object',required:['date','from','activities','userWords'],properties:{
    userWords:{type:'string',maxLength:1000,description:'The user’s request for this plan, copied word for word from their message(s). Always include it.'},
    date:{type:'string',description:'YYYY-MM-DD in Stockholm; today is in the server instructions'},
    from:{type:'string',description:'Departure landmark or station the user named, e.g. “Slussen”'},
    activities:{type:'array',minItems:1,maxItems:6,items:{type:'object',required:['name'],properties:{
      name:{type:'string',description:'What the user wants to do, in their words'},
      search:{type:'string',description:'Place search terms if different from name, e.g. “sushi restaurant Södermalm”'},
      place:{type:'string',description:'Exact venue name. Required whenever the user named a venue (“Moderna Museet”, “Råkultur”); put the venue here, not only in name'},
      minutes:{type:'integer',minimum:10,maximum:240,description:'Stay length; omit to use 60'},
      earliest:clockText,latest:{...clockText,description:'Latest finish, 24-hour HH:MM'},
      meetingPoint:{type:'boolean',description:'True when it is only a place to meet or an outdoor walk, so opening hours do not apply'}}}},
    keepOrder:{type:'boolean',description:'Must be true when the user’s words give an order (“first”, “then”, “after”, “before”, “followed by”), with activities listed in that order. Omit when they only listed things.'},
    leaveAt:{...clockText,description:'Required when the user gave a time they leave or start (“leaving at 10”). Omit otherwise.'},backBy:{...clockText,description:'Required when the user gave a time to be back, home or finished by (“back by 17:00”). Omit otherwise.'},
    budgetSEK:{type:'number',minimum:0,description:'Only if the user gave a spending limit'},
    transport:{type:'string',enum:['transit','walk']},
    maxWalkingMinutes:{type:'integer',minimum:0,maximum:180}}}},
  {name:'find_events',description:'Curated Visit Stockholm events with a session on the given date (and following days). Not a complete listing; ticket availability is unknown.',inputSchema:{type:'object',additionalProperties:false,required:['date'],properties:{date:{type:'string',description:'YYYY-MM-DD'},days:{type:'integer',minimum:1,maximum:14},near:{type:'string',description:'Landmark to search around; defaults to Stockholm Central'}}}},
  {name:'local_news',description:'Recent Stockholm regional headlines from SVT with links (titles and summaries, not full articles).',inputSchema:{type:'object',additionalProperties:false,properties:{}}},
  ...everydayTools,
  ...jobTools,
  ...calendarTools
];

const services=()=>{
  const maps=createMaps(process.env.GOOGLE_MAPS_API_KEY);
  // The calendar is optional here: without it, plans are checked against places and travel only.
  const calendar=async date=>{try{const c=openCalendar().calendar;if(c.status().connected)return await c.day(date);}catch{}return {date,...dayBounds(date),busy:[],own:[],connected:false};};
  return {maps,calendarDay:calendar,getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'mcp',evidence:[],eventDetails};
};

// A checked plan is also saved where the web app can pick it up, so the user can
// see it on a map and confirm calendar entries there. Only the last few are kept.
const planDirectory=()=>(process.env.DAYLIGHT_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url))).replace(/[\/]$/,'')+'/plans';
export async function persistPlan(record,directory=planDirectory()){
  await mkdir(directory,{recursive:true});
  const body=JSON.stringify(record);
  for(const name of [record.id+'.json','latest.json']){await writeFile(`${directory}/${name}.tmp`,body);await rename(`${directory}/${name}.tmp`,`${directory}/${name}`);}
  const old=(await readdir(directory)).filter(f=>/^plan-.*.json$/.test(f)).sort().slice(0,-10);
  await Promise.all(old.map(f=>unlink(`${directory}/${f}`).catch(()=>{})));
}
// The model sometimes puts a venue the user named into `name` and leaves `place` empty, which would let the
// planner substitute a similar venue. When an activity's words are themselves the name of a real place
// (two words or more, and the top search result is called exactly that), it is a named venue.
const plainName=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export async function namedVenues(activities,maps){
  return Promise.all(activities.map(async a=>{
    const words=plainName(a.name);
    if(a.place||a.search||a.meetingPoint||words.split(' ').length<2)return a;
    try{const top=(await maps.search(a.name))[0],found=plainName(top?.name);return found&&(found===words||found===words+' stockholm')?{...a,place:a.name}:a;}catch{return a;}
  }));
}
// On a request with several conditions the model tends to drop one. Two of them can be read
// from the user's own words without interpretation, so they are enforced here when the model
// left them out: an explicit order, and a clock time to be back by. Nothing is ever removed.
const orderWords=/\b(?:first|then|afterwards?|followed by|in that order|start(?:ing)? with|end(?:ing)? with|finally|lastly)\b/i;
const backWords=/\b(?:back|home|return(?:ing)?|done|finish(?:ed)?)\b[^.;!?\n]{0,40}?\b(?:by|before)\s+(\d{1,2})(?:[:.]([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])/i;
export function statedInWords(args){
  const words=String(args.userWords||''),out={...args};
  if(!out.keepOrder&&out.activities?.length>1&&orderWords.test(words))out.keepOrder=true;
  const back=!out.backBy&&backWords.exec(words);
  if(back&&(back[2]||back[3])){ // “back by 5” alone does not say morning or afternoon
    let hour=Number(back[1]);const half=(back[3]||'').toLowerCase().replace(/\./g,'');
    if(half==='pm'&&hour<12)hour+=12;if(half==='am'&&hour===12)hour=0;
    if(hour<=24)out.backBy=String(hour).padStart(2,'0')+':'+(back[2]||'00');
  }
  return out;
}
export async function planDay(args,make=services,save=null){
  validDate(args.date);
  const id='plan-'+Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),world=make();let entry=null;
  // The day's calendar is read once and kept, so the reply can name what the plan was fitted around.
  let dayRead=null;const readDay=world.calendarDay;world.calendarDay=async date=>dayRead||(dayRead=await readDay(date));
  world.saveJourney=value=>{entry=value;return id;};
  const text=JSON.stringify(args),env=createAgentEnvironment({text},world);
  args={...statedInWords(args),activities:await namedVenues(args.activities,world.maps)};
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
  if(save&&entry)try{await save({id,createdAt:new Date().toISOString(),request:args,entry});}catch{/* the plan is still returned to the model */}
  return {status:r.planChoices.length?(r.status==='route_draft'?'draft_needs_verification':'planned'):'nothing_fits',date:args.date,from:r.actualOrigin?.name,
    plans:r.planChoices.map(p=>({option:p.displayNumber,name:p.name,stops:p.stops,legs:p.legs.map(l=>({mode:l.mode,depart:l.depart,arrive:l.arrive,minutes:l.minutes})),backAt:p.returnAt,estimatedCostSEK:p.reserveSEK,walkingMinutes:p.walking,waits:(p.gaps||[]).filter(g=>g.minutes>=30).map(g=>g.minutes+' min')})),
    ...(r.planChoices.length?{}:{why:r.outcome,blockers:(r.diagnostics||[]).slice(0,4).map(d=>d.message),ways_forward:(r.repairOptions||[]).map(o=>o.explanation)}),
    notes:(journey?.notes||[]).slice(0,6),limitsApplied:{leaveAt:args.leaveAt||null,backBy:args.backBy||null,budgetSEK:args.budgetSEK??null},calendarChecked:journey?.calendarConnected===true,alreadyInCalendar:dayRead&&dayRead.connected!==false?eventsOf(dayRead):[],
    caveats:['Times and costs are estimates.','Opening hours do not guarantee a table, a ticket or stock.'],calendarWritten:false,
    howToAnswer:r.planChoices.length?[plain,
      'Describe option 1 only, in two to four sentences: the order with its key times, when they are back, the estimated cost, and one trade-off worth knowing.',
      r.planChoices.length>1?`Say that ${r.planChoices.length-1} other option${r.planChoices.length>2?'s exist':' exists'}; do not describe them unless asked.`:null,
      'Use only clock times that appear in this result. Say once that times and costs are estimates.',
      dayRead&&dayRead.connected!==false&&eventsOf(dayRead).length?'The user already has the events in alreadyInCalendar that day, and the plan was fitted around them: say so first, naming each with its time.':null,
      'The plan is now shown with a map in the Daylight web page, where the user can add it to their calendar themselves after seeing every block. You cannot add a plan to the calendar, book or pay: if they asked for that, say it is their step and where.'].filter(Boolean)
      :[plain,'Say what blocks the plan, using why and blockers, and offer the ways forward. Do not drop a requirement the user gave without asking.']};
}
export async function findEvents({date,days=1,near='Stockholm Centralstation'},make=services){
  validDate(date);const r=await nearbyEvents(near,make().maps,{days,from:date});
  return {date,days,source:'Visit Stockholm (curated)',events:r.events.map(e=>({title:e.title,venue:e.venue,sessions:e.occurrences?.length?e.occurrences:'no session times published',description:(e.description||'').slice(0,300),link:e.url})),
    howToAnswer:[plain,'At most three events. For each: the title, the venue and its session time on that date in one sentence, then the link on its own line. If an event has no published session, say so.','This is a curated list, not everything that is on; ticket availability is unknown.']};
}
const handlers={...everydayHandlers,...jobHandlers,...calendarHandlers,plan_day:args=>planDay(args,services,persistPlan),find_events:findEvents,local_news:async()=>{const r=await localNews();return {source:'SVT Stockholm',items:r.cards.map(c=>({title:c.translatedTitle||c.title,original:c.title,published:c.publishedAt,link:c.url}))};}};

// Minimal JSON-RPC 2.0 over newline-delimited stdio, as MCP's stdio transport specifies.
export async function respond(message,run=handlers){
  const {id,method,params}=message;
  if(id===undefined)return null;
  const ok=result=>({jsonrpc:'2.0',id,result});
  if(method==='initialize')return ok({protocolVersion:params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'daylight',version:'0.2.0'},instructions:`Daylight plans days out in Stockholm (SEK, Europe/Stockholm), reads Lidl Sverige's weekly offers, keeps the user's food preferences and research topics, and watches job postings against their CV. Today is ${dateInStockholm()}. It can read the user's Google Calendar and add an event after they confirm. Each result says how to answer from it.`});
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
