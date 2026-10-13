// What the assistant knows and does on the user's behalf, read from and written
// to the same files Hermes and Daylight's job scripts use, so the web page, the
// chat apps and the scheduled jobs always agree.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {extractText} from './documents.mjs';

const SEPARATOR='\n§\n';
const memoryFiles={user:{path:'memories/USER.md',limit:1375},notes:{path:'memories/MEMORY.md',limit:2200}};
const jobTitles={'daylight-research-feed':'Research digest','daylight-grocery-deals':'Grocery offers','daylight-job-matches':'Job watch'};
const fail=(message,status=400)=>Object.assign(Error(message),{status});

const readText=async file=>{try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}};
const readJson=async(file,fallback)=>{const text=await readText(file);return text?JSON.parse(text):fallback;};
async function writeAtomic(file,text){await mkdir(dirname(file),{recursive:true});const tmp=file+'.tmp';await writeFile(tmp,text,'utf8');await rename(tmp,file);}
const entriesOf=text=>text.split(/\r?\n§\r?\n/).map(e=>e.trim()).filter(Boolean);
const today=()=>new Date().toISOString().slice(0,10);

export function describeSchedule(expr){
  const hourly=/^(\d{1,2}) \*\/(\d{1,2}) \* \* \*$/.exec(expr||'');
  if(hourly)return `Every ${hourly[2]} hours`;
  const daily=/^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr||'');
  return daily?`Every day at ${daily[2].padStart(2,'0')}:${daily[1].padStart(2,'0')}`:expr||'';
}
export async function listJobs(hermes,{fetchImpl=fetch}={}){
  if(!hermes.key)return {jobs:[],error:'The assistant is not configured on this server.'};
  try{
    // Paused jobs are hidden unless asked for; one-off jobs that have finished are not shown.
    const r=await fetchImpl(hermes.url+'/api/jobs?include_disabled=true',{headers:{Authorization:'Bearer '+hermes.key},signal:AbortSignal.timeout(6000)});
    if(!r.ok)throw Error('status '+r.status);
    const jobs=((await r.json()).jobs||[]).filter(j=>j.state!=='completed').map(j=>({id:j.id,name:j.name,title:jobTitles[j.name]||j.name,schedule:describeSchedule(j.schedule?.expr||j.schedule_display),expr:j.schedule?.expr||null,deliver:j.deliver==='telegram'?'Telegram':j.deliver,paused:j.enabled===false||j.state==='paused',next:j.next_run_at||null,last:j.last_run_at||null,lastStatus:j.last_status||null,lastOutcome:j.latest_execution?.delivery_outcome||null}));
    return {jobs,error:null};
  }catch{return {jobs:[],error:'The assistant is not running, so scheduled jobs cannot be shown.'};}
}
export async function jobAction(hermes,{id,action},{fetchImpl=fetch}={}){
  if(!/^[0-9a-f]{12}$/.test(id||'')||!['pause','resume','run'].includes(action))throw fail('Unknown job or action.');
  const r=await fetchImpl(`${hermes.url}/api/jobs/${id}/${action}`,{method:'POST',headers:{Authorization:'Bearer '+hermes.key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(action==='run'?120000:10000)});
  if(!r.ok)throw fail('The assistant could not '+action+' that job ('+r.status+').',502);
}

export async function readProfile(home){
  const memory={};
  for(const [key,{path,limit}] of Object.entries(memoryFiles)){const text=await readText(join(home,path));memory[key]={entries:entriesOf(text),used:text.trim().length,limit};}
  const deals=await readJson(join(home,'daylight/deals.json'),{}),research=await readJson(join(home,'daylight/research.json'),{}),career=careerState(await readJson(join(home,'daylight/jobs.json'),{}));
  const pref=p=>({label:p.label,terms:p.terms||[],since:p.since||null});
  return {memory,food:{likes:(deals.likes||[]).map(pref),dislikes:(deals.dislikes||[]).map(pref),offersChecked:deals.cache?.date||null},
    research:{topics:(research.topics||[]).map(t=>({id:t.id,name:t.name,query:t.query,notes:t.notes||[],added:t.added||null,lastChecked:t.lastChecked||null})),lastDigest:research.lastBatch?.date||null},
    career:{cv:career.cv?{name:career.cv.name,added:career.cv.added,characters:career.cv.text.length}:null,prefs:career.prefs,lastLooked:career.lastRun,
      matches:[...career.matches].sort((a,b)=>b.fit-a.fit).slice(0,12).map(m=>({id:m.id,title:m.title,employer:m.employer,place:m.place,remote:!!m.remote,url:m.url,fit:m.fit,met:m.met??null,of:m.of??null,meets:m.meets||[],gaps:m.gaps||[],deadline:m.deadline||null,published:m.published||null,source:m.credit||m.source}))}};
}

// The job seeker's state, in the shape its script keeps it (hermes/scripts/daylight_jobs.py).
const careerLists=['roles','places','languages','avoid'];
function careerState(raw){
  const state={cv:null,seen:{},matches:[],sent:{},remote:null,lastRun:null,errors:[],...raw};
  state.prefs={roles:[],places:[],languages:[],avoid:[],notes:[],remote:'yes',country:'Sweden',seniority:null,...raw.prefs};
  return state;
}
// A new CV or a changed wish makes every earlier verdict out of date, so the next look starts over.
const startOver=state=>{state.seen={};state.matches=[];state.lastRun=null;};
export async function editCareer(home,input,{extract=extractText}={}){
  const target=join(home,'daylight/jobs.json'),state=careerState(await readJson(target,{}));
  const {action}=input;
  if(action==='cv_text'||action==='cv_file'){
    let text;
    if(action==='cv_file'){
      if(typeof input.data!=='string'||!input.data)throw fail('Choose a file to upload.');
      const buffer=Buffer.from(input.data,'base64');if(buffer.length>3e6)throw fail('That file is larger than 3 MB.');
      text=await extract(String(input.name||''),buffer);
    }else text=String(input.text||'').replace(/\r\n?/g,'\n').trim();
    if(text.length<200)throw fail('That is too short to be a CV (under 200 characters).');
    state.cv={name:String(input.name||'CV (pasted)').replace(/[\\/]/g,' ').slice(0,80),text:text.slice(0,40000),added:today()};startOver(state);
  }else if(action==='cv_remove'){state.cv=null;startOver(state);}
  else if(action==='prefs'){
    const before=structuredClone(state.prefs);
    for(const key of careerLists)if(input[key]!==undefined)state.prefs[key]=[...new Set((Array.isArray(input[key])?input[key]:String(input[key]).split(',')).map(v=>String(v).trim()).filter(v=>v&&v.length<=60))].slice(0,12);
    if(input.remote!==undefined){if(!['yes','no','only'].includes(input.remote))throw fail('Remote must be yes, no or only.');state.prefs.remote=input.remote;}
    for(const key of ['seniority','country'])if(input[key]!==undefined)state.prefs[key]=String(input[key]).trim().slice(0,60)||null;
    // Ruling something out only narrows the search, so matches it does not touch stay; any other change starts over.
    const same=key=>JSON.stringify(state.prefs[key])===JSON.stringify(before[key]);
    if([...careerLists,'remote','seniority','country'].every(key=>key==='avoid'||same(key))){
      const avoided=m=>state.prefs.avoid.some(term=>`${m.title} ${m.employer} ${m.text||''}`.toLowerCase().includes(term.toLowerCase()));
      state.matches=state.matches.filter(m=>!avoided(m));
    }else startOver(state);
  }else if(action==='note_remove'){
    const before=state.prefs.notes.length;state.prefs.notes=state.prefs.notes.filter(n=>n!==input.text);
    if(state.prefs.notes.length===before)throw fail('That note has changed. Reload and try again.',409);startOver(state);
  }else if(action==='dismiss'){
    const before=state.matches.length;state.matches=state.matches.filter(m=>m.id!==input.id);
    if(state.matches.length===before)throw fail('That match is no longer listed.',409);
  }else throw fail('Unknown action.');
  await writeAtomic(target,JSON.stringify(state,null,1));
}

// A memory entry is removed only if it still reads the way the page showed it.
export async function editMemory(home,{file,action,text,index}){
  const spec=memoryFiles[file];if(!spec)throw fail('Unknown memory file.');
  const target=join(home,spec.path),entries=entriesOf(await readText(target));
  if(action==='remove'){
    if(!Number.isInteger(index)||entries[index]===undefined||entries[index]!==text)throw fail('That entry has changed. Reload and try again.',409);
    entries.splice(index,1);
  }else if(action==='add'){
    const entry=String(text||'').replace(/\s+/g,' ').replace(/§/g,'').trim();
    if(!entry||entry.length>300)throw fail('Write 1–300 characters.');
    if(entries.includes(entry))throw fail('That is already remembered.');
    if([...entries,entry].join(SEPARATOR).length>spec.limit)throw fail('Memory is full. Remove something first.');
    entries.push(entry);
  }else throw fail('Unknown action.');
  await writeAtomic(target,entries.join(SEPARATOR));
}

export async function editFood(home,{action,kind,label,terms}){
  const target=join(home,'daylight/deals.json'),state=await readJson(target,{seen:{},likes:[],dislikes:[],cache:null});
  state.likes||=[];state.dislikes||=[];
  const name=String(label||'').replace(/\s+/g,' ').trim(),same=p=>p.label.toLowerCase()===name.toLowerCase();
  if(!name||name.length>60)throw fail('Give a food name of 1–60 characters.');
  if(action==='remove'){state.likes=state.likes.filter(p=>!same(p));state.dislikes=state.dislikes.filter(p=>!same(p));}
  else if(action==='add'&&['likes','dislikes'].includes(kind)){
    const words=[...new Set([name,...String(terms||'').split(',')].map(t=>t.trim().toLowerCase()).filter(t=>t&&t.length<=40))].slice(0,20).sort();
    state.likes=state.likes.filter(p=>!same(p));state.dislikes=state.dislikes.filter(p=>!same(p));
    state[kind].push({label:name,terms:words,since:today()});
  }else throw fail('Unknown action.');
  await writeAtomic(target,JSON.stringify(state,null,1));
}

export async function removeTopic(home,{id}){
  const target=join(home,'daylight/research.json'),state=await readJson(target,{topics:[],seen:{}});
  const before=(state.topics||[]).length;state.topics=(state.topics||[]).filter(t=>t.id!==id);
  if(state.topics.length===before)throw fail('That topic is no longer tracked.',409);
  await writeAtomic(target,JSON.stringify(state,null,1));
}
