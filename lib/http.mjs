import {createAgentRuns} from './agent-runs.mjs';
import {createAgentDiagnostic} from './agent-diagnostics.mjs';
import {join} from 'node:path';
import { validateChecks } from './verification.mjs';
import { createSpeech } from './speech.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { converse } from './conversation.mjs';
import { runAgent } from './agent.mjs';
import { writeReply, journeyReplyFacts } from './reply.mjs';
import { nearbyEvents, eventDetails } from './nearby-events.mjs';
import { localNews, translateTitles } from './local-news.mjs';
import { interpret } from './model.mjs';
import { createStore } from './store.mjs';
import { createMaps } from './maps.mjs';
import { createCalendar } from './calendar.mjs';
import { buildPlans } from './live-planner.mjs';
import { journeySettings, discoverJourney, proposeJourneys, meetingFor, planChanges, scopeJourneyDay } from './journey.mjs';
import { dateInStockholm, dayBounds, intersects, instant } from './time.mjs';
import { hermesConfig, hermesStatus, streamAssistant } from './hermes.mjs';
import { readProfile, editMemory, editFood, removeTopic, listJobs, jobAction } from './profile.mjs';
import { homedir } from 'node:os';
const port=Number(process.env.PORT||4318),origin=`http://127.0.0.1:${port}`;
const model={key:process.env.NEBIUS_API_KEY,model:process.env.NEBIUS_MODEL||'nvidia/nemotron-3-super-120b-a12b',base:process.env.NEBIUS_BASE_URL||'https://api.tokenfactory.us-central1.nebius.com/v1'};
const store=createStore(process.env.DAYLIGHT_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url)));
const maps=createMaps(process.env.GOOGLE_MAPS_API_KEY);
// Browser credentials are intentionally separate; never fall back to the server key.
const browserMapKey=process.env.GOOGLE_MAPS_BROWSER_KEY&&process.env.GOOGLE_MAPS_BROWSER_KEY!==process.env.GOOGLE_MAPS_API_KEY?process.env.GOOGLE_MAPS_BROWSER_KEY:'';
const calendar=createCalendar({clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirect:process.env.GOOGLE_REDIRECT_URI||origin+'/api/google/callback'},store);
const speech=createSpeech(process.env.VOICE_DISABLED==='1'?{}:{python:process.env.VOICE_PYTHON||fileURLToPath(new URL('../.venv-voice/Scripts/python.exe',import.meta.url)),modelDir:process.env.VOICE_MODEL_DIR||fileURLToPath(new URL('../models/whisper-small/',import.meta.url))});
// Where Hermes keeps memory and where Daylight's job scripts keep their state.
const hermesHome=process.env.DAYLIGHT_HERMES_HOME||join(homedir(),'.hermes');
const profileView=async()=>{const [profile,{jobs,error},assistant]=await Promise.all([readProfile(hermesHome),listJobs(hermesConfig()),hermesStatus(hermesConfig())]);return {...profile,jobs,jobsError:error,assistant};};
const assets=new Map([['/','index.html'],['/index.html','index.html'],['/app.mjs','app.mjs'],['/live.mjs','live.mjs'],['/planner.mjs','planner.mjs'],['/style.css','style.css'],['/favicon.svg','favicon.svg'],['/privacy.html','privacy.html']]);
assets.set('/journey-ui.mjs','journey-ui.mjs');
assets.set('/verification-ui.mjs','verification-ui.mjs');
assets.set('/legacy.html','legacy.html');assets.set('/daylight.mjs','daylight.mjs');assets.set('/daylight.css','daylight.css');
for(const name of ['journey-map','route-geometry','voice-core','voice-ui','local-recognition','agent-client'])assets.set('/'+name+'.mjs',name+'.mjs');
const places=new Map(),plans=new Map(),proposals=new Map(),journeys=new Map(),conversationPlans=new Map(),agentEvidence=new Map();
let modelActive=0,planning=false,committing=false,modelVerified=null,mapsVerified=null;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req,limit=16000){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('Request too long.');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
function prune(map){for(const [id,v] of map)if(v.expires<Date.now())map.delete(id);}
function record(map,value){prune(map);if(map.size>=100)map.delete(map.keys().next().value);const id=randomBytes(20).toString('hex');map.set(id,{...value,expires:Date.now()+15*60000});return id;}
function lookup(map,id){prune(map);const item=map.get(id)||(map===proposals?store.get('preview:'+id):null);if(!item||item.expires<Date.now()){if(map===proposals)store.remove('preview:'+id);throw new Error('Query or preview has expired, please regenerate.');}return item;}
function savePreview(value){store.prunePreviews();const minimal={...value,plan:{stops:value.plan.stops,legs:value.plan.legs.map(l=>({depart:l.depart,arrive:l.arrive}))}};const id=record(proposals,minimal);store.put('preview:'+id,proposals.get(id));return id;}
async function calendarDay(date){return calendar.status().connected?calendar.day(date):{date,...dayBounds(date),busy:[],own:[],connected:false};}
async function executeAgent(raw,options={}){
  if(modelActive>=2)throw Error('The assistant is busy with other requests; please try again later.');
  let previous=null;if(raw.journeyId)try{previous=lookup(journeys,raw.journeyId);}catch{};
  let evidence=[];if(raw.slots?.evidenceId)try{evidence=lookup(agentEvidence,raw.slots.evidenceId).events;}catch{};
  modelActive++;
  try{
    const diagnostic=process.env.DAYLIGHT_DIAGNOSTICS==='0'?null:createAgentDiagnostic(join(process.env.DAYLIGHT_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url)),'diagnostics'));
    const out=await runAgent(raw,model,{
      previous,maps,calendarDay,evidence,eventDetails,resumeState:options.resumeState,
      saveEvidence:events=>events.length?record(agentEvidence,{events:events.slice(-24)}):null,
      getChecks:date=>store.get('checks:'+date)||{revision:0,items:{}},
      saveJourney:value=>record(journeys,value),readNews:()=>localNews(),
      nearbyEvents:(origin,options)=>nearbyEvents(origin,maps,options)
    },{...options,onDiagnostic:diagnostic?.write});
    if(out.stopReason!=='service_error'||out.trace.some(t=>t.status==='ok'))modelVerified=new Date().toISOString();
    if(out.trace.some(t=>t.status==='ok'&&['search_places','place_details','plan_itinerary'].includes(t.action)))mapsVerified=new Date().toISOString();
    return {...out,diagnosticId:diagnostic?.id};
  }finally{modelActive--;}
}
const agentRuns=createAgentRuns(executeAgent);
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com; font-src 'self' https://fonts.gstatic.com; worker-src blob:; frame-src https://*.google.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return json(res,403,{error:'Host not allowed.'});
    const url=new URL(req.url,origin),path=url.pathname;
    if(req.method==='POST'&&(req.headers.origin&&! [origin,`http://localhost:${port}`].includes(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'))return json(res,403,{error:'Origin not allowed.'});
    if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Need JSON request.'});
    if(req.method==='GET'&&path==='/api/voice/status'){if(speech.status().configured)try{await speech.warm();}catch{}return json(res,200,speech.status());}
    if(req.method==='POST'&&path==='/api/voice/transcribe'){
      const input=await body(req,5600000),cancel=new AbortController();
      const closed=()=>{if(!res.writableEnded)cancel.abort();};res.on('close',closed);
      try{return json(res,200,await speech.transcribe(input,cancel.signal));}finally{res.off('close',closed);}
    }
    if(req.method==='GET'&&path==='/api/maps/config')return json(res,200,{key:browserMapKey,mapId:process.env.GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID'});
    if(req.method==='GET'&&path==='/api/status')return json(res,200,{mode:model.key?'live':'demo',model:model.key?model.model:null,provider:model.key?'Nebius Token Factory':null,modelVerified,maps:{configured:!!process.env.GOOGLE_MAPS_API_KEY,browserConfigured:!!browserMapKey,verified:mapsVerified},calendar:calendar.status(),city:'Stockholm',currency:'SEK',timeZone:'Europe/Stockholm',today:dateInStockholm()});
    if(req.method==='POST'&&path==='/api/agent/run'){
      if(modelActive>=2)return json(res,429,{error:'The assistant is busy with other requests; please try again later.'});
      return json(res,202,agentRuns.start(await body(req,48000)));
    }
    if(req.method==='GET'&&path==='/api/agent/run')return json(res,200,agentRuns.read(url.searchParams.get('id'),Number(url.searchParams.get('after'))||0));
    // The web chat talks to the same Hermes agent as the chat apps.
    if(req.method==='GET'&&path==='/api/assistant/status')return json(res,200,await hermesStatus(hermesConfig()));
    if(req.method==='POST'&&path==='/api/assistant'){
      const input=await body(req,16000),cancel=new AbortController();res.on('close',()=>{if(!res.writableEnded)cancel.abort();});
      try{return await streamAssistant(input,res,hermesConfig(),{signal:cancel.signal});}
      catch(error){if(res.headersSent)return res.end();return json(res,error.status||500,{error:error.message});}
    }
    // What the assistant knows and does for the user: view, correct, pause.
    if(req.method==='GET'&&path==='/api/profile')return json(res,200,await profileView());
    if(req.method==='POST'&&path==='/api/profile'){
      const input=await body(req,4000),edit={memory:()=>editMemory(hermesHome,input),food:()=>editFood(hermesHome,input),topic:()=>removeTopic(hermesHome,input),job:()=>jobAction(hermesConfig(),input)}[input.area];
      if(!edit)return json(res,400,{error:'Unknown area.'});
      try{await edit();}catch(error){return json(res,error.status||400,{error:error.message});}
      return json(res,200,await profileView());
    }
    if(req.method==='POST'&&path==='/api/agent/cancel')return json(res,200,agentRuns.cancel((await body(req)).id));
    if(req.method==='POST'&&path==='/api/agent'){
      if(modelActive>=2)return json(res,429,{error:'The assistant is busy with other requests; please try again later.'});
      return json(res,200,await executeAgent(await body(req,48000)));
    }
    if(req.method==='POST'&&path==='/api/chat'){
      const raw=await body(req,48000);
      if(modelActive>=2)return json(res,429,{error:'The assistant is busy with other requests; please try again later.'});
      modelActive++;
      try{
        const out=await converse(raw,model);modelVerified=new Date().toISOString();
        if(out.action==='plan')out.planToken=record(conversationPlans,out.request);
        if(['events','news','discover'].includes(out.action)){
          const tasks=[];
          if(out.action!=='news')tasks.push(nearbyEvents(out.slots.origin,maps,{days:out.days,category:out.category}).then(r=>({message:r.message,cards:r.events.map(e=>({...e,type:'event',source:'Visit Stockholm'}))})));
          if(out.action!=='events')tasks.push(localNews());
          const results=await Promise.allSettled(tasks);
          out.cards=[];const notes=[];
          for(const r of results){if(r.status==='fulfilled'){notes.push(r.value.message);out.cards.push(...r.value.cards);}else notes.push('Partial query failed this time:'+r.reason.message);}
          try{out.cards=await translateTitles(out.cards,model);}catch{notes.push('English title translation is unavailable; original source text is retained.');}
          out.checkedAt=new Date().toISOString();
          out.message=notes.join('\n\n')+(out.cards.length?'\n\n'+out.cards.map(c=>(c.type==='news'?'News':'Activity ')+'：'+(c.translatedTitle||c.title)+(c.type==='event'?'（'+c.start+'  to  '+c.end+'，'+c.venue+'）':'(Published on '+c.publishedAt.slice(0,10)+'）')).join('\n'):'');
        }
        return json(res,200,out);
      }finally{modelActive--;}
    }
    if(req.method==='GET'&&path==='/api/journey/session'){
      const id=url.searchParams.get('id');return json(res,200,id?{...lookup(journeys,id).result,id}:store.get('journey:last')||{});
    }
    if(req.method==='POST'&&path==='/api/journey/explain'){
      const raw=await body(req),entry=lookup(journeys,raw.id);
      if(modelActive>=2)return json(res,429,{error:'The assistant is busy with other requests; please try again later.'});
      modelActive++;
      try{
        const facts=journeyReplyFacts(entry.result,raw.choice);
        const message=await writeReply(facts,model,{fallback:facts.fallback});
        return json(res,200,{message});
      }finally{modelActive--;}
    }
    if(req.method==='POST'&&['/api/journey','/api/journey/replan','/api/journey/verify'].includes(path)){
      if(planning)return json(res,429,{error:'Checking itinerary, please wait a moment then try again.'});
      const raw=await body(req);planning=true;
      try{
        let input,discovery,meeting=null,locks=[],previous=null;
        if(path.endsWith('/replan')||path.endsWith('/verify')){
          previous=lookup(journeys,raw.id);input=previous.input;discovery=previous.discovery;
          meeting=raw.meeting?meetingFor(input.date,raw.meeting):previous.result.meeting;
          if(raw.lockMovie&&!path.endsWith('/verify')){const choice=previous.result.plans.find(p=>p.id===raw.choice),s=choice?.stops.find(s=>s.kind==='movie');if(!s)throw Error('Please select an original plan containing a movie before locking it.');locks=[{kind:s.kind,placeId:s.placeId,start:s.start,duration:s.end-s.start}];}
        }else{
          if(raw.planToken){
            const request=lookup(conversationPlans,raw.planToken);
            input={...journeySettings({...raw.settings,...request.settings,date:request.date}),text:request.text,originQuery:request.originQuery};
          }else{
          const settings=journeySettings({...raw.settings,date:raw.date||dateInStockholm()});
          const interpreted=await converse({text:raw.text,slots:{date:settings.date,budget:settings.budget,budgetMode:settings.budgetMode,start:settings.start,deadline:settings.deadline,origin:raw.originQuery||null,transport:settings.transport}},model);modelVerified=new Date().toISOString();
          if(interpreted.action!=='plan')return json(res,200,{supported:false,message:interpreted.message+' You can continue adding details in the conversation above.'});
          const request=interpreted.request;
          input={...journeySettings({...settings,...request.settings}),text:request.text,originQuery:request.originQuery};
          }
          discovery=await discoverJourney(input,maps);mapsVerified=new Date().toISOString();
        }
        let checkState=store.get('checks:'+input.date)||{revision:0,items:{}};
        const verifying=path.endsWith('/verify');
        if(verifying){
          if(previous.result.checkRevision!==checkState.revision)throw Error('Verification record has changed, please refresh calendar and reorder before editing again.');
          const choice=previous.result.plans.find(p=>p.id===raw.choice);if(!choice)throw Error('Please select a valid plan before verifying.');
          checkState={revision:checkState.revision+1,items:{...Object.fromEntries(Object.entries(checkState.items).filter(([k])=>!input.activities.includes(k))),...validateChecks(raw.checks,choice,input.date,raw.acknowledge)}};
        }
        const day=scopeJourneyDay(await calendarDay(input.date),input.activities);
        const sourceChecks=previous?.result?.sourceChecks||{};
        const activeChecks=Object.fromEntries(Object.entries({...sourceChecks,...checkState.items}).filter(([k])=>input.activities.includes(k)));
        for(const fixed of [...Object.values(activeChecks),...day.own.filter(e=>e.locked&&e.kind!=='meeting')]){
          if(!input.activities.includes(fixed.kind))throw Error('Existing verification or locked activity cannot be automatically omitted. Please undo verification or handle in calendar processing before planning again.');
          const pool=discovery.pools[fixed.kind];if(!pool.some(p=>p.id===fixed.placeId))pool.push(await maps.details(fixed.placeId));
        }
        let result=await proposeJourneys(input,discovery,{route:maps.route,day,locks,meeting,checks:activeChecks,sourceChecks});
        // A delegated time window is a proposal, not a user constraint. Try one
        // broader window after failure, without exceeding the route-call budget.
        if(!result.plans.length&&input.timeMode==='flexible'&&result.routeCalls<=28&&(input.start!=='08:00'||input.deadline!=='24:00')){
          const firstCalls=result.routeCalls;
          input={...input,start:'08:00',deadline:'24:00'};
          result=await proposeJourneys(input,discovery,{route:maps.route,day,locks,meeting,checks:activeChecks,sourceChecks,maxCalls:36-firstCalls});
          result.routeCalls+=firstCalls;
          result.notes.unshift('Tentative10:00–20:00No plan found; because the assistant proposed the hours, we also checked 08:00–24:00. Still keeping the specified location, order and calendar.');
        }
        if(verifying&&!result.plans.length)throw Error('These verification conditions conflict with budget, business hours, transport or meetings, changes not saved. Please adjust and reapply; old calendar unchanged.');
        result.checks=activeChecks;result.sourceChecks=sourceChecks;result.checkRevision=checkState.revision;
        if(verifying)store.put('checks:'+input.date,checkState);
        result.calendarConnected=calendar.status().connected;result.supported=true;
        result.retainedCount=day.retained.length;if(day.retained.length)result.notes.push(`In the calendar there are also ${day.retained.length} items already scheduled, retained as busy periods; this preview does not modify them.`);
        const priorDraft=previous?.result.plans.find(p=>p.id===raw.choice);
        const comparisonDay=day.own.length||!priorDraft?day:{...day,own:[...priorDraft.stops,...(previous.result.meeting?[previous.result.meeting]:[])].map(s=>({...s,start:instant(input.date,s.start),end:instant(input.date,s.end)}))};
        result.changeBasis=day.own.length?'Current calendar':'Original plan';
        result.changes=result.plans.map(p=>({choice:p.id,changes:planChanges(p,comparisonDay,result.meeting)}));
        const id=record(journeys,{input,discovery,result,day});
        return json(res,200,{...result,id});
      }finally{planning=false;}
    }
    if(req.method==='POST'&&path==='/api/journey/preview'){
      if(!calendar.status().connected)throw Error('Please connect first Google Calendar。');
      const raw=await body(req);if(raw.acknowledge!==true)throw Error('Please confirm these are personal time blocks awaiting verification, not reservations or ticket purchases.');
      const entry=lookup(journeys,raw.id),choice=entry.result.plans.find(p=>p.id===raw.choice);if(!choice)throw Error('Please select a valid plan.');
      if(choice.continuityUnverified)throw Error('This set of candidates crosses existing offline arrangements, location connection not yet verified. Please adjust to consecutive free periods and replan, or first handle old arrangements in calendar; will not delete your old calendar for you.');
      if(choice.availabilityPending?.length)throw Error('This is still a route draft; please first record specific session sources in the activity verification table and reorder, then preview calendar.');
      if(entry.result.checkRevision!==(store.get('checks:'+entry.input.date)?.revision||0))throw Error('Verification record has changed, please refresh and reorder before previewing again.');
      const plan=structuredClone(choice);if(raw.lockMovie){const movie=plan.stops.find(s=>s.kind==='movie');if(movie)movie.locked=true;}
      const originalDay=await calendar.day(entry.input.date),day=scopeJourneyDay(originalDay,entry.input.activities),meeting=entry.result.meeting;
      const stops=[...plan.stops,...(meeting?[meeting]:[])];
      if([...stops,...plan.legs.map(l=>({start:l.depart,end:l.arrive}))].some(s=>day.busy.some(b=>intersects({start:instant(day.date,s.start),end:instant(day.date,s.end)},b))))throw Error('Calendar has new conflicts, please refresh and reorder first.');
      const id=savePreview({plan:{...plan,stops},day:originalDay,preservedKinds:day.retained.map(e=>e.kind),date:entry.input.date,completed:null,journey:{input:entry.input,id:raw.id,choice:raw.choice,checkRevision:entry.result.checkRevision}});
      return json(res,200,{id,date:day.date,changes:planChanges(plan,day,meeting),notice:`After confirmation will create or update personal time blocks in preview, plus ${day.retained.length} items already arranged remain fixed; verification activities marked ”tentative”; no merchant bookings, ticket purchases or invitations will be sent.`});
    }
    if(req.method==='POST'&&['/api/intent','/api/live/intent'].includes(path)){
      const input=await body(req);if(typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)return json(res,400,{error:'Please enter  1–2000 characters requirement.'});
      if(modelActive>=2)return json(res,429,{error:'Model is processing other requests, please try again later.'});modelActive++;
      try{const result=await interpret(input.text,input.current,model,{live:path.includes('/live/'),date:input.date});if(result.mode==='live')modelVerified=new Date().toISOString();return json(res,200,result);}finally{modelActive--;}
    }
    if(req.method==='POST'&&path==='/api/live/search'){
      const {query,kind}=await body(req),types={origin:null,hair:'hair_salon',ramen:'ramen_restaurant',movie:'movie_theater'};
      if(!Object.hasOwn(types,kind))throw new Error('Location type invalid.');
      const results=await maps.search(query,types[kind]);mapsVerified=new Date().toISOString();prune(places);
      for(const p of results){if(places.size>=100)places.delete(places.keys().next().value);places.set(p.id,{...p,expires:Date.now()+30*60000});}
      return json(res,200,{places:results,source:'Google Maps',queriedAt:mapsVerified});
    }
    if(req.method==='POST'&&path==='/api/live/plan'){
      if(planning)return json(res,429,{error:'Calculating itinerary, please wait a moment then try again.'});
      const input=await body(req);prune(places);
      for(const id of [input.origin,...(input.activities||[]).map(a=>a.placeId)])if(!places.has(id))throw new Error('Please search and select each real location first; location query valid for 30 minutes.');
      planning=true;
      try{const day=await calendarDay(input.date),result=await buildPlans(input,{route:maps.route,busy:day.busy,locks:calendar.locks(day)});
        const id=record(plans,{input,result,day});return json(res,200,{...result,id,calendarConnected:calendar.status().connected,busy:day.busy,places:Object.fromEntries([input.origin,...input.activities.map(a=>a.placeId)].map(id=>[id,places.get(id)]))});
      }finally{planning=false;}
    }
    if(req.method==='POST'&&path==='/api/google/connect'){
      const result=calendar.begin();res.setHeader('Set-Cookie',`daylight_oauth=${result.state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);return json(res,200,{url:result.url});
    }
    if(req.method==='GET'&&path==='/api/google/callback'){
      const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('daylight_oauth='))?.slice(15);
      await calendar.callback(url.searchParams.get('code'),url.searchParams.get('state'),cookie);
      res.writeHead(302,{Location:'/?connected=1#live','Set-Cookie':'daylight_oauth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});return res.end();
    }
    if(req.method==='POST'&&path==='/api/google/disconnect'){calendar.disconnect();proposals.clear();store.clearPreviews();return json(res,200,{disconnected:true});}
    if(req.method==='GET'&&path==='/api/calendar/day')return json(res,200,await calendar.day(url.searchParams.get('date')));
    if(req.method==='POST'&&path==='/api/calendar/preview'){
      if(!calendar.status().connected)throw new Error('Please connect first Google Calendar。');
      const {planId,choice}=await body(req),entry=lookup(plans,planId),plan=entry.result.plans.find(p=>p.id===choice);if(!plan)throw new Error('The plan is invalid.');
      const day=await calendar.day(entry.input.date);
      if([...plan.stops,...plan.legs.map(l=>({start:l.depart,end:l.arrive}))].some(s=>day.busy.some(b=>intersects({start:instant(day.date,s.start),end:instant(day.date,s.end)},b))))throw new Error('The latest calendar conflicts with activities or transport; please refresh and replan.');
      const id=savePreview({plan,day,date:entry.input.date,completed:null});
      return json(res,200,{id,date:day.date,timeZone:'Europe/Stockholm',changes:plan.stops.map(s=>({kind:s.kind,start:s.start,end:s.end,locked:s.locked,operation:day.own.some(e=>e.kind===s.kind)?'Update':'Create'})),notice:'Write only to your own primary calendar, no invitations sent, no contact with merchants.Google Multiple event writes may partially succeed; retry using the same event number.'});
    }
    if(req.method==='POST'&&path==='/api/calendar/confirm'){
      const {id}=await body(req),p=lookup(proposals,id);if(p.completed)return json(res,200,p.completed);
      if(committing)return json(res,429,{error:'Calendar is being written, please try again later.'});committing=true;
      try{if(p.journey&&p.journey.checkRevision!==(store.get('checks:'+p.date)?.revision||0))throw Error('After preview, records have changed; please replan and preview again.');const fullDay=await calendar.day(p.date),day=p.preservedKinds?{...fullDay,busy:[...fullDay.busy,...fullDay.own.filter(e=>p.preservedKinds.includes(e.kind))]}:fullDay;if(p.plan.legs.some(l=>day.busy.some(b=>intersects({start:instant(p.date,l.depart),end:instant(p.date,l.arrive)},b))))throw new Error('New conflict appears in transport period; please replan.');const events=await calendar.write(p.date,p.plan.stops,p.day,id,p.preservedKinds);p.completed={events,message:'Written Google CalendarNo invitations sent or appointments made with merchants.'};store.put('preview:'+id,p);if(p.journey)store.put('journey:last',{input:p.journey.input,events,committedAt:new Date().toISOString()});return json(res,200,p.completed);}finally{committing=false;}
    }
    if(req.method!=='GET'||!assets.has(path))return json(res,404,{error:'Not found'});
    const filename=assets.get(path),content=await readFile(fileURLToPath(new URL('../public/'+filename,import.meta.url)));
    res.writeHead(200,{'Content-Type':filename.endsWith('.css')?'text/css; charset=utf-8':filename.endsWith('.mjs')?'text/javascript; charset=utf-8':filename.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(content);
  }catch(error){return json(res,400,{error:error.name==='TimeoutError'?'Service response timeout, please retry later.':error.message||'Request failed.',...(error.partial?{partial:error.partial}:{} )});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Daylight ready at ${origin} (${model.key?'Nebius configured':'local demo'})`));
server.on('close',()=>speech.close());
process.on('exit',()=>speech.close());
