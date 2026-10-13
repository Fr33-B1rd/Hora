// Pieces of the assistant evaluation that need no network: reading the agent's
// event stream, reading and seeding its state files, and the checks every reply
// must pass. Kept apart from the runner so they can be unit-tested.
import {readFile,writeFile,mkdir,rm,cp,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {instant,localParts,dateInStockholm,nextDate} from '../lib/time.mjs';

const SEPARATOR='\n§\n';
// The schedule is included: a conversation must not change it, and if one does it is put back.
export const stateFiles=['memories/USER.md','memories/MEMORY.md','daylight/deals.json','daylight/research.json','daylight/jobs.json','daylight/todos.json','cron/jobs.json'];
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
const readText=async file=>{try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}};
const readJson=async(file,fallback)=>{const text=await readText(file);return text.trim()?JSON.parse(text):fallback;};
const write=async(file,text)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,text,'utf8');};

// One reply from the agent's OpenAI-style stream: its text, the tools it ran, and usage.
export function createReplyReader(){
  const out={text:'',tools:[],usage:null},decoder=new TextDecoder();let buffer='',event='message';
  const line=raw=>{
    const l=raw.trim();
    if(l.startsWith('event:')){event=l.slice(6).trim();return;}
    if(!l.startsWith('data:')){if(!l)event='message';return;}
    const data=l.slice(5).trim(),kind=event;event='message';
    if(!data||data==='[DONE]')return;
    let payload;try{payload=JSON.parse(data);}catch{return;}
    if(kind==='hermes.tool.progress'){if(payload.status!=='completed')out.tools.push({tool:String(payload.tool||''),label:String(payload.label||'')});return;}
    const delta=payload.choices?.[0]?.delta;if(typeof delta?.content==='string')out.text+=delta.content;
    if(payload.usage)out.usage=payload.usage;
  };
  return {push(chunk){buffer+=typeof chunk==='string'?chunk:decoder.decode(chunk,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}},
    done(){if(buffer.trim())line(buffer);out.text=out.text.trim();return out;}};
}

// The user's real state is copied aside before a run and put back after it. A
// copy left behind by an interrupted run is put back before anything else.
export async function protectState(home,backup){
  const restore=async()=>{
    if(!await exists(join(backup,'manifest.json')))return false;
    const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));
    for(const [file,had] of Object.entries(manifest.files)){if(had)await cp(join(backup,file),join(home,file));else await rm(join(home,file),{force:true});}
    await rm(backup,{recursive:true,force:true});return true;
  };
  const recovered=await restore();
  const files={};
  for(const file of stateFiles){files[file]=await exists(join(home,file));if(files[file]){await mkdir(dirname(join(backup,file)),{recursive:true});await cp(join(home,file),join(backup,file));}}
  await write(join(backup,'manifest.json'),JSON.stringify({savedAt:new Date().toISOString(),files}));
  return {recovered,restore};
}

// A case starts from a stated world: these memory entries, these food
// preferences, these topics. Offer and paper caches are kept so no case refetches.
export async function seedState(home,base,seed={}){
  const entries=list=>(list||[]).join(SEPARATOR);
  await write(join(home,'memories/USER.md'),entries(seed.memory));
  await write(join(home,'memories/MEMORY.md'),entries(seed.notes));
  const pref=p=>({label:p.label,terms:p.terms||[p.label],since:'2026-01-01'});
  await write(join(home,'daylight/deals.json'),JSON.stringify({seen:{},...base.deals,likes:(seed.likes||[]).map(pref),dislikes:(seed.dislikes||[]).map(pref)},null,1));
  await write(join(home,'daylight/research.json'),JSON.stringify({seen:{},...base.research,topics:(seed.topics||[]).map(t=>({id:t.id,name:t.name,query:t.query||'all:'+t.name.split(' ').join(' AND all:'),categories:[],notes:t.notes||[],added:'2026-01-01',lastChecked:new Date().toISOString().slice(0,10)}))},null,1));
  await write(join(home,'daylight/todos.json'),JSON.stringify({next:(seed.todos||[]).length,lists:{me:(seed.todos||[]).map((text,i)=>({id:i+1,text,by:null,added:'2026-01-01',due:null,done:null}))}},null,1));
  // The job search: a CV, wishes and matches already found, so no case has to search the live job boards.
  const career=seed.career||{},day=new Date().toISOString().slice(0,10);
  await write(join(home,'daylight/jobs.json'),JSON.stringify({cv:career.cv?{name:'cv.pdf',text:career.cv,added:day}:null,
    prefs:{roles:[],places:[],languages:[],avoid:[],notes:[],remote:'yes',country:'Sweden',seniority:null,...career.prefs},
    matches:(career.matches||[]).map(m=>({source:'jobtech',credit:'Arbetsförmedlingen Platsbanken',place:'Stockholm',remote:false,published:day,deadline:null,found:day,meets:[],gaps:[],text:'',...m})),
    seen:Object.fromEntries((career.matches||[]).map(m=>[m.id,day])),sent:{},remote:{date:day},lastRun:new Date().toISOString(),errors:[]},null,1));
}
export async function readState(home){
  const [user,notes,deals,research,cron,career,todos]=await Promise.all([readText(join(home,'memories/USER.md')),readText(join(home,'memories/MEMORY.md')),readJson(join(home,'daylight/deals.json'),{}),readJson(join(home,'daylight/research.json'),{}),readJson(join(home,'cron/jobs.json'),{}),readJson(join(home,'daylight/jobs.json'),{}),readJson(join(home,'daylight/todos.json'),{})]);
  const jobs=(Array.isArray(cron)?cron:cron.jobs||[]).map(j=>`${j.name||j.id} [${j.enabled===false?'paused':'on'} ${j.schedule?.expr||j.schedule_display||''}]`).sort();
  return {todos:Object.fromEntries(Object.entries(todos.lists||{}).map(([name,items])=>[name,{open:items.filter(i=>!i.done).map(i=>i.text),done:items.filter(i=>i.done).map(i=>i.text)}])),career:{cv:career.cv||null,prefs:{roles:[],places:[],languages:[],avoid:[],notes:[],remote:'yes',...career.prefs},matches:career.matches||[]},jobs,memory:(user+'\n'+notes).trim(),likes:deals.likes||[],dislikes:deals.dislikes||[],topics:research.topics||[],offers:(deals.cache?.deals||[]).map(d=>d.title),deals,research};
}

// ---- the stand-in calendar ----
// Calendar conversations run against a calendar kept in a file (tests/calendar-provider.mjs),
// never a real one. `file` is that calendar; without it those conversations are skipped.
export const tomorrow=()=>nextDate(dateInStockholm());
const minutes=text=>Number(text.slice(0,2))*60+Number(text.slice(3));
export async function seedCalendar(file,events=[]){
  if(!file)return;
  const held=Object.fromEntries(events.map((e,i)=>['seed'+i,{id:'seed'+i,summary:e.title,start:{dateTime:instant(e.date||tomorrow(),minutes(e.start))},end:{dateTime:instant(e.date||tomorrow(),minutes(e.end))},etag:'s'+i}]));
  await write(file,JSON.stringify({events:held,writes:0}));
}
export async function readCalendar(file){
  if(!file)return null;
  const state=await readJson(file,{events:{},writes:0}),hhmm=iso=>{const p=localParts(Date.parse(iso));return p.hour+':'+p.minute;};
  return {writes:state.writes,added:Object.values(state.events).filter(e=>!String(e.id).startsWith('seed')).map(e=>({title:e.summary,date:dateInStockholm(Date.parse(e.start.dateTime)),start:hhmm(e.start.dateTime),end:hhmm(e.end.dateTime),guests:(e.attendees||[]).length}))};
}

// ---- what a reply may and may not contain ----
const clock=n=>String(Math.floor(n/60)%24).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export const clockTimes=text=>[...new Set([...String(text).matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)].map(m=>m[1].padStart(2,'0')+':'+m[2]))];
// Every clock time the planner produced for a saved plan, across all its options.
export function planTimes(record){
  const times=new Set();
  for(const plan of record?.entry?.result?.plans||[]){
    for(const s of plan.stops||[]){times.add(clock(s.start));times.add(clock(s.end));}
    for(const l of plan.legs||[]){times.add(clock(l.depart));times.add(clock(l.arrive));}
    if(Number.isFinite(plan.homeAt))times.add(clock(plan.homeAt));
  }
  const r=record?.request||{};
  for(const t of [r.leaveAt,r.backBy,...(r.activities||[]).flatMap(a=>[a.earliest,a.latest])])if(t)times.add(t);
  return times;
}
export const ungroundedTimes=(reply,record)=>{const known=planTimes(record);return clockTimes(reply).filter(t=>!known.has(t));};

// Checks applied to every reply, whatever the case. Each returns a problem or null.
export const everyReply=[
  r=>r.text?null:'empty reply',
  r=>/\[SILENT\]/.test(r.text)?'sent the scheduler’s [SILENT] marker in a conversation':null,
  r=>/^\s{0,3}#{1,6}\s|\*\*[^*\n]+\*\*|^\s*\|.*\|\s*$/m.test(r.text)?'markdown heading, bold or table in a chat reply':null,
  r=>r.text.length>1500?`reply is ${r.text.length} characters (limit 1500)`:null,
  r=>/daylight_(deals|research)\.py|mcp__daylight__|skill_view|~\/\.hermes/.test(r.text)?'internal tool or file name shown to the user':null,
];

// Put the schedule back exactly as it was (used when a conversation changed it).
export async function restoreSchedule(home,backup){if(await exists(join(backup,'cron/jobs.json')))await cp(join(backup,'cron/jobs.json'),join(home,'cron/jobs.json'));}

// Tool-use predicates used by the cases.
export const used=(reply,pattern)=>reply.tools.some(t=>pattern.test(t.tool+' '+t.label));
export const searchedWeb=reply=>reply.tools.some(t=>/^web_|browser/.test(t.tool));
export const mentionsAny=(text,words)=>words.filter(w=>new RegExp(w,'i').test(text));
