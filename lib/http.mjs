// The web front end's server. The assistant itself is Hermes; this serves the
// page, relays chat to it, shows what it knows, and owns the one thing the
// assistant may never do alone: writing to the user's calendar after they confirm.
import http from 'node:http';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createStore} from './store.mjs';
import {createCalendar} from './calendar.mjs';
import {planChanges,scopeJourneyDay} from './journey.mjs';
import {dateInStockholm,intersects,instant} from './time.mjs';
import {hermesConfig,hermesStatus,streamAssistant} from './hermes.mjs';
import {readProfile,editMemory,editFood,removeTopic,editCareer,listJobs,jobAction} from './profile.mjs';
import {createSpeech} from './speech.mjs';
import {createGoogleSpeech,spokenLine,acknowledgements,waitingPhrases,waitingPhrase} from './voice.mjs';
const port=Number(process.env.PORT||4318),origin=`http://127.0.0.1:${port}`;
// When hosted, the server still listens on loopback only; an HTTPS proxy with a
// password in front of it forwards requests for this one public address.
const publicOrigin=(process.env.DAYLIGHT_PUBLIC_ORIGIN||'').replace(/\/$/,'');
const allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`,...(publicOrigin?[new URL(publicOrigin).host]:[])];
const allowedOrigins=[origin,`http://localhost:${port}`,...(publicOrigin?[publicOrigin]:[])];
const cookieFlags='HttpOnly; SameSite=Lax; Path=/'+(publicOrigin.startsWith('https:')?'; Secure':'');
const dataDirectory=process.env.DAYLIGHT_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url));
const store=createStore(dataDirectory);
// Browser credentials are intentionally separate; never fall back to the server key.
const browserMapKey=process.env.GOOGLE_MAPS_BROWSER_KEY&&process.env.GOOGLE_MAPS_BROWSER_KEY!==process.env.GOOGLE_MAPS_API_KEY?process.env.GOOGLE_MAPS_BROWSER_KEY:'';
const calendar=createCalendar({clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirect:process.env.GOOGLE_REDIRECT_URI||(publicOrigin||origin)+'/api/google/callback'},store);
// Voice: hearing runs on this machine; speaking sends only short lines to Google's speech service.
const speech=createSpeech({python:process.env.VOICE_PYTHON||'',model:process.env.VOICE_MODEL||'base.en'});
const voice=createGoogleSpeech({credentialsFile:process.env.GOOGLE_TTS_CREDENTIALS||'',voice:process.env.VOICE_NAME||'en-GB-Chirp3-HD-Aoede'});
const lineModel={key:process.env.NEBIUS_API_KEY,base:process.env.NEBIUS_BASE_URL||'https://api.tokenfactory.us-central1.nebius.com/v1',model:process.env.VOICE_LINE_MODEL||process.env.NEBIUS_MODEL||'nvidia/nemotron-3-super-120b-a12b'};
const fixedPhrases=new Set([...acknowledgements,...waitingPhrases.map(([,phrase])=>phrase)]);
// Names the listener should expect, so they are not misheard: Stockholm places, and the user's own topics and roles.
const placeNames='Slussen, T-Centralen, Södermalm, Medborgarplatsen, Odenplan, Gamla stan, Fridhemsplan, Östermalm, Kungsholmen, Djurgården, Moderna Museet, Fotografiska, Vasamuseet, Lidl';
async function listeningHints(){try{const p=await readProfile(hermesHome);return [placeNames,...p.research.topics.map(t=>t.name),...p.career.prefs.roles].join(', ').slice(0,600);}catch{return placeNames;}}
// Where Hermes keeps memory and where Daylight's job scripts keep their state.
const hermesHome=process.env.DAYLIGHT_HERMES_HOME||join(homedir(),'.hermes');
const profileView=async()=>{const [profile,{jobs,error},assistant]=await Promise.all([readProfile(hermesHome),listJobs(hermesConfig()),hermesStatus(hermesConfig())]);return {...profile,jobs,jobsError:error,assistant,calendar:calendar.status()};};
const assets=new Map([['/','index.html'],['/index.html','index.html'],['/daylight.mjs','daylight.mjs'],['/daylight.css','daylight.css'],['/journey-map.mjs','journey-map.mjs'],['/voice.mjs','voice.mjs'],['/dial.mjs','dial.mjs'],['/atmosphere.mjs','atmosphere.mjs'],['/character.webp','character.webp'],['/hora-typing.webp','hora-typing.webp'],['/hora-peek.webp','hora-peek.webp'],['/hora-reach.webp','hora-reach.webp'],['/route-geometry.mjs','route-geometry.mjs'],['/favicon.svg','favicon.svg'],['/privacy.html','privacy.html']]);
const proposals=new Map(),journeys=new Map();
let committing=false;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req,limit=16000){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('Request too long.');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
function prune(map){for(const [id,v] of map)if(v.expires<Date.now())map.delete(id);}
function record(map,value){prune(map);if(map.size>=100)map.delete(map.keys().next().value);const id=randomBytes(20).toString('hex');map.set(id,{...value,expires:Date.now()+15*60000});return id;}
function lookup(map,id){prune(map);const item=map.get(id)||(map===proposals?store.get('preview:'+id):null);if(!item||item.expires<Date.now()){if(map===proposals)store.remove('preview:'+id);throw new Error(map===proposals?'This preview has expired. Preview the changes again.':'This plan has expired. Ask for it again.');}return item;}
function savePreview(value){store.prunePreviews();const minimal={...value,plan:{stops:value.plan.stops,legs:value.plan.legs.map(l=>({depart:l.depart,arrive:l.arrive}))}};const id=record(proposals,minimal);store.put('preview:'+id,proposals.get(id));return id;}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com; media-src 'self' blob: data:; font-src 'self' https://fonts.gstatic.com; worker-src blob:; frame-src https://*.google.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    if(!allowedHosts.includes(req.headers.host))return json(res,403,{error:'Host not allowed.'});
    const url=new URL(req.url,origin),path=url.pathname;
    if(req.method==='POST'&&(req.headers.origin&&!allowedOrigins.includes(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'))return json(res,403,{error:'Origin not allowed.'});
    if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Need JSON request.'});
    if(req.method==='GET'&&path==='/api/maps/config')return json(res,200,{key:browserMapKey,mapId:process.env.GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID'});
    if(req.method==='GET'&&path==='/api/status')return json(res,200,{maps:{configured:!!process.env.GOOGLE_MAPS_API_KEY,browserConfigured:!!browserMapKey},calendar:calendar.status(),city:'Stockholm',currency:'SEK',timeZone:'Europe/Stockholm',today:dateInStockholm()});
    // Voice. The page may ask for the fixed phrases, for one line made from an answer it was just given, and for a transcription.
    if(req.method==='GET'&&path==='/api/voice/status'){speech.warm();return json(res,200,{hear:speech.status(),speak:voice.status(),acknowledgements});}
    if(req.method==='POST'&&path==='/api/voice/hear'){
      const input=await body(req,3000000);
      try{return json(res,200,await speech.transcribe({...input,hints:await listeningHints()}));}catch(error){return json(res,error.status||400,{error:error.message});}
    }
    if(req.method==='POST'&&path==='/api/voice/say'){
      // Either one of the fixed acknowledgements, or the phrase for the step the assistant is on.
      const input=await body(req,2000),text=typeof input.tool==='string'?waitingPhrase(input.tool):input.text;
      if(!fixedPhrases.has(text))return json(res,400,{error:'Only the assistant’s own short phrases can be requested here.'});
      if(!voice.status().configured)return json(res,200,{text,audio:null});
      try{return json(res,200,{text,audio:await voice.say(text)});}catch(error){return json(res,200,{text,audio:null,problem:error.message});}
    }
    if(req.method==='POST'&&path==='/api/voice/line'){
      const input=await body(req,24000);if(typeof input.written!=='string'||!input.written.trim())return json(res,400,{error:'Nothing to speak.'});
      const {line,by}=await spokenLine({asked:input.asked,written:input.written},lineModel);let audio=null,problem=null;
      if(voice.status().configured)try{audio=await voice.say(line);}catch(error){problem=error.message;}
      return json(res,200,{line,by,audio,...(problem?{problem}:{})});
    }
    // The web chat talks to the same Hermes agent as the chat apps.
    if(req.method==='GET'&&path==='/api/assistant/status')return json(res,200,await hermesStatus(hermesConfig()));
    if(req.method==='POST'&&path==='/api/assistant'){
      const input=await body(req,16000),cancel=new AbortController();res.on('close',()=>{if(!res.writableEnded)cancel.abort();});
      try{return await streamAssistant(input,res,hermesConfig(),{signal:cancel.signal});}
      catch(error){if(res.headersSent)return res.end();return json(res,error.status||500,{error:error.message});}
    }
    // The latest plan the assistant checked (written by the planner tool server), registered
    // here so the calendar preview and confirmation below can work on it.
    if(req.method==='GET'&&path==='/api/plans/latest'){
      let saved;try{saved=JSON.parse(await readFile(join(dataDirectory,'plans','latest.json'),'utf8'));}catch{return json(res,404,{error:'No plan yet.'});}
      prune(journeys);journeys.set(saved.id,{...saved.entry,expires:Date.parse(saved.createdAt)+60*60000});
      return json(res,200,{...saved.entry.result,id:saved.id,createdAt:saved.createdAt,request:saved.request});
    }
    // What the assistant knows and does for the user: view, correct, pause.
    if(req.method==='GET'&&path==='/api/profile')return json(res,200,await profileView());
    if(req.method==='POST'&&path==='/api/profile'){
      // A CV upload arrives here as base64, hence the larger limit.
      const input=await body(req,4500000),edit={memory:()=>editMemory(hermesHome,input),food:()=>editFood(hermesHome,input),topic:()=>removeTopic(hermesHome,input),career:()=>editCareer(hermesHome,input),job:()=>jobAction(hermesConfig(),input)}[input.area];
      if(!edit)return json(res,400,{error:'Unknown area.'});
      try{await edit();}catch(error){return json(res,error.status||400,{error:error.message});}
      return json(res,200,await profileView());
    }
    // Calendar: a preview changes nothing; only an explicit confirmation of that preview writes.
    if(req.method==='POST'&&path==='/api/journey/preview'){
      if(!calendar.status().connected)throw Error('Connect Google Calendar first.');
      const raw=await body(req);if(raw.acknowledge!==true)throw Error('Please confirm these are personal time blocks, not reservations or ticket purchases.');
      const entry=lookup(journeys,raw.id),choice=entry.result.plans.find(p=>p.id===raw.choice);if(!choice)throw Error('Please select a valid plan.');
      if(choice.continuityUnverified)throw Error('This option runs across something already in your calendar, and getting between the two has not been checked. Ask for a plan in a free stretch of the day; nothing in your calendar was changed.');
      if(choice.availabilityPending?.length)throw Error('This is still a draft: a session time in it has not been confirmed, so it cannot be added to the calendar yet.');
      const plan=structuredClone(choice);
      const originalDay=await calendar.day(entry.input.date),day=scopeJourneyDay(originalDay,entry.input.activities),meeting=entry.result.meeting;
      const stops=[...plan.stops,...(meeting?[meeting]:[])];
      if([...stops,...plan.legs.map(l=>({start:l.depart,end:l.arrive}))].some(s=>day.busy.some(b=>intersects({start:instant(day.date,s.start),end:instant(day.date,s.end)},b))))throw Error('This plan now overlaps something in your calendar. Ask for the plan again.');
      const id=savePreview({plan:{...plan,stops},day:originalDay,preservedKinds:day.retained.map(e=>e.kind),date:entry.input.date,completed:null});
      return json(res,200,{id,date:day.date,changes:planChanges(plan,day,meeting),notice:`Confirming adds these as time blocks marked tentative in your own calendar${day.retained.length?`; ${day.retained.length} existing ${day.retained.length===1?'event stays':'events stay'} as ${day.retained.length===1?'it is':'they are'}`:''}. Nothing is booked, bought or sent to anyone.`});
    }
    if(req.method==='POST'&&path==='/api/google/connect'){
      const result=calendar.begin();res.setHeader('Set-Cookie',`daylight_oauth=${result.state}; ${cookieFlags}; Max-Age=600`);return json(res,200,{url:result.url});
    }
    if(req.method==='GET'&&path==='/api/google/callback'){
      const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('daylight_oauth='))?.slice(15);
      await calendar.callback(url.searchParams.get('code'),url.searchParams.get('state'),cookie);
      res.writeHead(302,{Location:'/','Set-Cookie':`daylight_oauth=; ${cookieFlags}; Max-Age=0`});return res.end();
    }
    if(req.method==='POST'&&path==='/api/google/disconnect'){calendar.disconnect();proposals.clear();store.clearPreviews();return json(res,200,{disconnected:true});}
    if(req.method==='POST'&&path==='/api/calendar/confirm'){
      const {id}=await body(req),p=lookup(proposals,id);if(p.completed)return json(res,200,p.completed);
      if(committing)return json(res,429,{error:'The calendar is being written. Try again in a moment.'});committing=true;
      try{
        const fullDay=await calendar.day(p.date),day=p.preservedKinds?{...fullDay,busy:[...fullDay.busy,...fullDay.own.filter(e=>p.preservedKinds.includes(e.kind))]}:fullDay;
        if(p.plan.legs.some(l=>day.busy.some(b=>intersects({start:instant(p.date,l.depart),end:instant(p.date,l.arrive)},b))))throw new Error('Your calendar changed since the preview and now overlaps the travel time. Ask for the plan again.');
        const events=await calendar.write(p.date,p.plan.stops,p.day,id,p.preservedKinds);
        p.completed={events,message:'No invitations were sent and nothing was booked.'};store.put('preview:'+id,p);
        return json(res,200,p.completed);
      }finally{committing=false;}
    }
    if(req.method!=='GET'||!assets.has(path))return json(res,404,{error:'Not found'});
    const filename=assets.get(path),content=await readFile(fileURLToPath(new URL('../public/'+filename,import.meta.url)));
    res.writeHead(200,{'Content-Type':filename.endsWith('.css')?'text/css; charset=utf-8':filename.endsWith('.mjs')?'text/javascript; charset=utf-8':filename.endsWith('.svg')?'image/svg+xml':filename.endsWith('.webp')?'image/webp':filename.endsWith('.png')?'image/png':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(content);
  }catch(error){return json(res,400,{error:error.name==='TimeoutError'?'The service took too long to respond. Try again shortly.':error.message||'Request failed.'});}
});
process.on('exit',()=>speech.close());
server.listen(port,'127.0.0.1',()=>console.log(`Daylight ready at ${origin}`));
