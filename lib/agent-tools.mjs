import {readPlaceWebsite} from './place-website.mjs';
import {conversationSlots,activeActivities} from './trip-state.mjs';
import {validDate,minute,instant,clock,dateInStockholm,nextDate} from './time.mjs';
import {journeySettings,proposeJourneys,scopeJourneyDay,matchesRequiredName,planChanges} from './journey.mjs';
import {journeyReplyFacts} from './reply.mjs';
import {eventVenueMatch} from './event-venue.mjs';

const str={type:'string'},number={type:'number'},integer={type:'integer'},nullableString={type:['string','null']};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const list=items=>({type:'array',items});
const activity=schema({id:str,label:str,query:str,requiredNames:list(str),duration:integer,allowance:{type:['number','null']},eventRef:{...nullableString,description:'Reference to a discovered event in eventEvidence; links this activity to source occurrences.'},windowStart:{...nullableString,description:'Earliest HH:MM for this activity. Preserve time-of-day requests: translate broad wording into a provisional numeric window and disclose that assumption.'},windowEnd:{...nullableString,description:'Latest HH:MM by which this activity must finish, including meal time constraints. Null only when no activity-specific window is requested.'},availability:{type:'string',enum:['venue','session'],description:'venue = ordinary venue visit; session = participation needs a specific class, performance, appointment or access slot. A place search cannot verify a session.'}},['id','label','query','requiredNames','duration','allowance']);
activity.properties.windowQuote={...nullableString,description:'Exact user words requesting this activity-specific time window; required for a window unless eventRef provides its published occurrence. Do not invent fixed windows for freely schedulable activities.'};
// Explicit nullable fields make "not applicable" distinct from silently
// forgetting evidence or timing when the model rebuilds an activity array.
activity.required.push('availability','eventRef','windowStart','windowEnd','windowQuote');
activity.properties.hours={type:'string',enum:['venue','not_needed'],description:'not_needed when the place is only a meeting point or outdoor area, e.g. meeting a friend on a campus, a walk through a neighbourhood or park: posted opening hours then do not limit the visit. Default venue.'};
activity.properties.requiredNames.description='Exact venue/brand names only. A neighbourhood, district, city, cuisine or generic activity belongs in query, never in requiredNames.';
activity.properties.label={type:'string',maxLength:220,description:'Short user-facing label, or a source event title up to 220 characters.'};
activity.properties.query={type:'string',maxLength:160,description:'Concise place search terms, at most 160 characters; use the event venue rather than its full title.'};
activity.properties.requiredNames.items={type:'string',maxLength:100};
const choiceGroup=schema({id:str,options:list(str),selected:nullableString,selectionBy:{type:'string',enum:['pending','user','assistant']},userQuote:{type:'string',maxLength:500},delegationQuote:{type:'string',maxLength:500},reason:{type:'string',maxLength:500}},['id','options','selected','selectionBy','userQuote','delegationQuote','reason']);
export const tripFields={choiceGroups:{...list(choiceGroup),description:'Mutually exclusive alternatives: exactly one activity per group. Keep ALL options in activities; only selected is scheduled. Record the exact user quote establishing the alternatives, delegationQuote if the user delegates (otherwise empty), and distinguish assistant provisional choices from user selections.'},originQuote:{...nullableString,description:'Exact quote from a USER message identifying their departure point, not an activity destination or an assistant-selected search centre.'},date:nullableString,origin:{...nullableString,description:'The user-stated departure landmark name, never a place ID.'},budgetMode:{type:'string',enum:['unknown','limited','unlimited','flexible'],description:'unknown = unanswered; limited = explicit numeric cap; unlimited = explicitly no limit; flexible = wants suggestions before deciding.'},budget:{type:['number','null']},start:nullableString,deadline:nullableString,timeMode:{type:'string',enum:['unknown','fixed','flexible'],description:'Required before planning. fixed only for user-provided trip hours; flexible for assistant-proposed hours when timing is delegated. Preserve their provenance.'},activities:list(activity),precedence:{...list(schema({before:str,after:str},['before','after'])),description:'Required activity sequence, using the activity IDs. Record every explicit before/after relation.'},transport:{type:'string',enum:['walk','transit']},lowWalking:{type:'boolean'},maxWalking:{type:['number','null']}};
export const agentToolDefinitions=[
  ['discover_candidates','Prepare missing origin and activity candidates together from the recorded queries. This explicitly searches and binds matching candidates; inspect the returned names and revise mismatches with search_places/select_candidates. Prefer this over one search and binding call per stop for a multi-activity outing.',schema({})],
  ['select_option','Select one existing alternative without rebuilding activities. Assistant choices remain provisional; include the exact delegation quote when the user asks you to decide, otherwise empty.',schema({groupId:str,activityId:str,reason:str,delegationQuote:str},['groupId','activityId','reason','delegationQuote'])],
  ['set_budget','Record the user budget meaning directly; unlimited means explicitly no ceiling, flexible means suggestions before deciding. Does not authorize spending.',schema({mode:{type:'string',enum:['limited','unlimited','flexible']},amount:{type:['number','null']}},['mode','amount'])],
  ['set_activity_window','Set or clear just one activity time window without replacing the activity list. For a broad user time preference, keep its exact quote and explain the numeric interpretation as an assumption.',schema({activityId:str,start:nullableString,end:nullableString,userQuote:nullableString,assumption:nullableString},['activityId','start','end','userQuote','assumption'])],
  ['update_trip','Record all newly known trip facts together in one sparse patch, including activity order via precedence edges. assumptions is the complete list of current provisional choices. Does not search or write a calendar.',schema({patch:schema(tripFields),assumptions:list(str)},['patch'])],
  ['present_events','Recommend a few discovered events: explain what happens and why it may interest the user, using source descriptions. Keep time/place facts in the host-rendered metadata. Provide introductions when descriptions exist; no invented personal preferences, price or availability.',schema({eventRefs:list(str),recommendations:list(schema({eventRef:str,introduction:{type:'string',maxLength:220},interest:{type:'string',maxLength:160},sourceQuote:{type:'string',maxLength:600}},['eventRef','introduction','interest','sourceQuote']))},['eventRefs'])],
  ['event_details','Refresh the official occurrence times for a previously discovered event. Cannot book tickets.',schema({eventRef:str},['eventRef'])],
  ['search_places','Search real places without changing the trip or selected origin/candidates. Review results and then bind the right places with select_candidates. Can search before recording the complete trip.',schema({query:str},['query'])],
  ['select_candidates','Choose observed places for an activity, or one observed origin. Uses only observed IDs and checks required identities.',schema({activityId:str,placeIds:list(str)},['activityId','placeIds'])],
  ['place_details','Read current Google details for an observed place, including hours and website link. Does not read the website or availability.',schema({placeId:str},['placeId'])],
  ['read_place_website','Read an observed place official HTTPS website, then follow only same-site links returned by this tool. Bounded public text read, no login or booking. Use to investigate the requested experience, not just venue existence.',schema({placeId:str,url:nullableString},['placeId'])],
  ['assess_place_offer','Record a source-grounded interpretation of whether the observed venue offers the requested experience. Requires a quote from a fetched page. This is a model interpretation, not a verified booking or inventory check. A contradicted candidate is removed from this activity pool.',schema({activityId:str,placeId:str,sourceUrl:str,quote:{type:'string',maxLength:500},status:{type:'string',enum:['supported','uncertain','not_supported']},explanation:{type:'string',maxLength:240}},['activityId','placeId','sourceUrl','quote','status','explanation'])],
  ['route','Inspect a route between observed places for a local departure time.',schema({from:str,to:str,date:str,time:str,transport:{type:'string',enum:['walk','transit']}},['from','to','date','time','transport'])],
  ['plan_itinerary','Plan the day from the recorded trip. This is normally the only tool a plan request needs: it finds the departure point and candidate places for any activity that has none, then checks timing, travel and the calendar. A leave time, return time or budget limits the plan only if the user stated one; none of them is required and none should be asked for. Needs only a recorded date, origin and activities. Returns checked plans, or diagnostics naming the blocker. Use the search/select tools afterwards only to replace a candidate you judge wrong. Does not relax user conditions. Default 18 route calls reserves budget for a targeted revision; maximum 3 planning attempts per turn.',schema({routeBudget:{type:'integer',minimum:6,maximum:36}})],
  ['select_plan','Switch to one of the already displayed checked plans, synchronizing the map. When the user picks an option by position (first, second, third), call this with choice = that number minus one; do not re-plan or only describe the option.',schema({choice:str},['choice'])],
  ['calendar_availability','Read busy intervals and commitment counts only. No event titles or private descriptions.',schema({date:str},['date'])],
  ['calendar_changes','Inspect proposed changes for the current checked plan. Read-only; saving requires manual UI confirmation.',schema({})],
  ['inspect_activity','Inspect verification status and missing evidence for an activity in the current checked plan.',schema({activityId:str},['activityId'])],
  ['read_news','Read recent Stockholm regional news from SVT RSS with source links; not full articles.',schema({})],
  ['nearby_events','Find curated Visit Stockholm events near a search reference. The reference is not the user location. Distances are hidden by default; showDistance requires an exact user quote establishing that reference and a reason proximity matters.',schema({origin:str,date:{type:'string',description:'First local date to search, YYYY-MM-DD, resolved from the user’s words with today from context: today → today, tomorrow → the next day. Only events with a session in the searched dates are returned.'},originQuote:str,showDistance:{type:'boolean'},days:{type:'integer',minimum:1,maximum:30,description:'Number of days to cover starting at date; 1 for a single day.'},category:{type:'string',enum:['all','music','exhibitions']}},['origin','date'])]
].map(([name,description,parameters])=>({type:'function',function:{name,description,parameters}}));

export function validateArguments(value,s,path='arguments'){
  const types=Array.isArray(s.type)?s.type:[s.type];
  const type=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(!types.includes(type)&&!(types.includes('integer')&&Number.isInteger(value)))throw Error(`${path}: wrong type`);
  if(s.enum&&!s.enum.includes(value))throw Error(`${path}: invalid choice`);
  if(typeof value==='number'&&(!Number.isFinite(value)||(s.minimum!==undefined&&value<s.minimum)||(s.maximum!==undefined&&value>s.maximum)))throw Error(`${path}: out of range`);
  if(typeof value==='string'&&value.length>Math.min(2000,s.maxLength??2000))throw Error(`${path}: too long; give a concise conclusion, details are already displayed`);
  if(Array.isArray(value)){if(value.length>20)throw Error(`${path}: too many items`);value.forEach((v,i)=>validateArguments(v,s.items,`${path}[${i}]`));}
  else if(value&&typeof value==='object'){
    for(const key of s.required||[])if(!Object.hasOwn(value,key))throw Error(`${path}: missing ${key}`);
    for(const [key,v] of Object.entries(value)){if(!Object.hasOwn(s.properties||{},key))throw Error(`${path}: unknown field ${key}`);validateArguments(v,s.properties[key],`${path}.${key}`);}
  }
}
const stateOf=raw=>conversationSlots(raw,{defaultFlexibleWindow:false});
const publicState=s=>({...s,activities:Object.values(s.activityDefinitions),activityDefinitions:undefined});
const placeFacts=p=>({id:p.id,name:p.name,address:p.address,location:p.location,rating:p.rating,hours:p.hours,website:p.website,url:p.url});
import {hasTimeAnchor,hasOrderAnchor} from './time-anchors.mjs';
export {hasTimeAnchor} from './time-anchors.mjs';

export function createAgentEnvironment(raw,services,{deadline=Infinity}={}){
  const savedAssumptions=raw.slots?.assumptions||[];
  validateArguments(savedAssumptions,list(str),'assumptions');
  let state=stateOf(raw.slots||{}),assumptions=savedAssumptions.slice(0,8).map(n=>n.slice(0,300)),revision=0,plannedRevision=-1;
  let discovery={origin:null,origins:[],pools:{}},journey=null,choice='0',changed=false,selectionChanged=false;
  // A clarification is a suspended task, not a completed answer. Keep this
  // obligation across requests; a second model's approval cannot discharge it.
  const savedRequests=raw.slots?.task?.requests;
  if(savedRequests!==undefined&&(!Array.isArray(savedRequests)||savedRequests.length>12||savedRequests.some(t=>typeof t!=='string'||t.length>2000)))throw Error('Invalid planning context.');
  let task=raw.slots?.task?.kind==='planning'?{kind:'planning',status:raw.slots.task.status==='paused'?'paused':'active',requests:savedRequests||[]}:null;
  const requirePlan=()=>{task={kind:'planning',status:'active',requests:[...new Set([...(task?.requests||[]),...(raw.text?[raw.text]:[])])].slice(-12)};};
  const planningPending=()=>task?.status==='active'&&(!journey||plannedRevision!==revision);
  const interpretationNotes=()=>Object.values(state.activityDefinitions).filter(a=>!a.eventRef&&(a.windowStart||a.windowEnd)).map(a=>'Activity time explanation:'+a.label+(a.windowQuote?'（“'+a.windowQuote+'”）':'')+'provisionally  '+(a.windowStart||'00:00')+'–'+(a.windowEnd||'24:00'));
  const eventEvidence=new Map((services.evidence||[]).map(e=>[e.ref,e]));
  const observed=new Map(),cards=[],trace=[],routeCache=new Map(),pages=new Map(),experience=new Map(Object.entries(services.previous?.result?.experienceEvidence||{}));let searches=0,routeCalls=0,planAttempts=0,websiteReads=0;
  if(services.previous){
    const p=services.previous;journey={...p.result,id:raw.journeyId};choice=raw.choice||journey.plans[0]?.id||'0';
    discovery=structuredClone(p.discovery);for(const place of Object.values(p.result.places))observed.set(place.id,place);
    plannedRevision=0;
  }
  if(services.resumeState){
    const saved=services.resumeState;
    state=structuredClone(saved.state);assumptions=[...saved.assumptions];task=structuredClone(saved.task);
    discovery=structuredClone(saved.discovery);journey=null;plannedRevision=-1;
    for(const [k,v]of saved.observed)observed.set(k,v);
    for(const [k,v]of saved.events)eventEvidence.set(k,v);
    for(const [k,v]of saved.pages)pages.set(k,v);
    for(const [k,v]of saved.experience)experience.set(k,v);
    cards.push(...saved.cards);
  }
  // Short, turn-local handles avoid asking the model to copy opaque provider IDs.
  const refs=new Map(),ids=new Map();
  const placeRef=id=>{if(!refs.has(id)){const ref='place_'+(refs.size+1);refs.set(id,ref);ids.set(ref,id);}return refs.get(id);};
  const originMatches=p=>{
    const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    const requested=normalize(state.origin);
    return [p.name,...(p.aliases||[])].some(n=>{const actual=normalize(n);return actual.length>=3&&requested.length>=3&&(actual.includes(requested)||requested.includes(actual));});
  };
  const briefPlace=p=>({...placeFacts(p),id:placeRef(p.id)});
  const getPlace=id=>{const p=observed.get(ids.get(id)||id);if(!p)throw Error('Only location IDs from this round or the current plan already queried may be used.');return p;};
  const currentPlan=()=>{if(!journey||plannedRevision!==revision)throw Error('Current conditions have not generated valid candidates; please plan first.');const p=journey.plans.find(p=>p.id===choice);if(!p)throw Error('No available plans.');return p;};
  const timeCheck=()=>{services.signal?.throwIfAborted();if(Date.now()>=deadline)throw Error('Execution time for this round has been used up.');};
  const travel=async(...args)=>{timeCheck();if(routeCalls>=36)throw Error('Route query quota for this round exhausted; please explain current results.');routeCalls++;return services.maps.route(...args);};
  const details=async(id,language)=>{timeCheck();if(searches>=12)throw Error('Location query quota for this round exhausted.');searches++;return services.maps.details(id,language);};
  const localized=new Set(),reportedVenues=new Set();
  const recordVenue=(p,e)=>{
    const receipt=eventVenueMatch(p,e);if(!receipt)return false;
    const key=e.ref+':'+p.id;
    if(!reportedVenues.has(key)){reportedVenues.add(key);trace.push({action:'venue_identity',label:'Verify activity venue',status:'ok',summary:'Source“'+e.venue+'”Map correspondence“'+p.name+'”'+(receipt.method==='localized_name_and_coordinates'?': Local name match, distance approx '+receipt.distanceMeters+' meters.':': Source name match.')});}
    return true;
  };
  const matchPlace=(p,a)=>a.eventRef?eventVenueMatch(p,eventEvidence.get(a.eventRef)):matchesRequiredName(p,a);
  const resolveVenue=async(p,a)=>{
    if(!a.eventRef)return matchesRequiredName(p,a);
    let e=eventEvidence.get(a.eventRef);
    if(!e?.location&&services.eventDetails){e={...e,...await services.eventDetails(e.url)};eventEvidence.set(e.ref,e);}
    if(recordVenue(p,e))return true;
    if(!localized.has(p.id)){
      localized.add(p.id);
      const local=await details(p.id,'sv');
      if(local.id!==p.id)throw Error('Local name does not match map location ID.');
      p.aliases=[...new Set([...(p.aliases||[]),local.name])];
    }
    return recordVenue(p,e);
  };
  const readiness=()=>{
    // Leave time, return time and budget are optional and never required here.
    const fields=['date','origin'].filter(k=>!state[k]);if(!state.activities.length)fields.push('activities');
    const missingDecisions=[...(state.choiceGroups||[]).filter(g=>!g.selected).map(g=>'Option group  '+g.id+' Not yet tentatively selected (keep as backup, follow user preference or delegation to give recommendation)')];
    const candidates=activeActivities(state).filter(id=>!discovery.pools[id]?.length).map(id=>({id,label:state.activityDefinitions[id].label}));
    return {ready:!fields.length&&!!discovery.origin&&!candidates.length&&!missingDecisions.length,missingFields:fields,missingDecisions,originSelected:!!discovery.origin,missingCandidates:candidates,
      selectedCandidates:Object.fromEntries(Object.entries(discovery.pools).map(([id,ps])=>[id,ps.map(p=>({id:placeRef(p.id),name:p.name}))])),
      sessionActivities:activeActivities(state).filter(id=>state.activityDefinitions[id].availability==='session').map(id=>({id,label:state.activityDefinitions[id].label,notice:'Need date and session evidence; place search cannot verify.'})),
      observedPlaces:[...observed.values()].map(p=>({id:placeRef(p.id),name:p.name})),remainingSearches:12-searches,remainingRoutes:36-routeCalls,remainingPlanAttempts:3-planAttempts};
  };
  const eventPresentationPending=()=>cards.some(c=>c.type==='event')&&!cards.some(c=>c.type==='news')&&!trace.some(t=>['update_trip','plan_itinerary','select_plan'].includes(t.action));
  const checkIntake=async()=>{
    if(!services.checkIntent)return;
    const review=await services.checkIntent(publicState(state),assumptions,task?.requests);
    trace.push({label:'Check demand constraints',status:review.ready?'ok':'error',summary:review.ready?'Checked demand against user’s original wording.':review.issues.join(' ')});
    if(!review.ready)throw Error('Demand check failed:'+review.issues.join(' ')+' Use small‑scope update to keep other activities; first save all known conditions, then follow up or schedule.');
  };
  let unquoted=[];
  const presentEvents=(eventRefs,recommendations=[],requireIntroductions=false)=>{
    if(!eventRefs.length||eventRefs.length>8)throw Error('Please select1–8items from the queried activities.');
    const events=eventRefs.map(ref=>{const e=eventEvidence.get(ref);if(!e)throw Error('No source found for this activity; please requery.');return e;});
    // Compare quotes ignoring case, spacing and punctuation; an introduction
    // whose quote still is not in the source falls back to the source text.
    unquoted=[];const notes=new Map(),loose=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    for(const n of recommendations){const e=events.find(e=>e.ref===n.eventRef);if(!e||notes.has(n.eventRef)||unquoted.includes(n.eventRef))throw Error('Introductions must match selected activities and not be duplicated.');if(!n.introduction.trim()||!n.interest.trim()||!n.sourceQuote.trim())throw Error('Use this event’s  description write a brief introduction and conditional highlight, citing a passage from the description as evidence.');if(loose(e.description).includes(loose(n.sourceQuote)))notes.set(n.eventRef,n);else unquoted.push(n.eventRef);}
    if(requireIntroductions&&events.some(e=>e.description&&!notes.has(e.ref)&&!unquoted.includes(e.ref)))throw Error('Do not list titles alone. In  recommendations  provide, for events with  description , a brief introduction and a reason for interest. The host adds times and places; do not repeat them.');
    return 'You can first check out these items, they vary:\n\n'+events.map(e=>{const n=notes.get(e.ref);return (e.occurrences?.length?'':'Occurrences pending verification, cannot be treated as confirmed activities for the day:\n')+e.title+'\n'+(n?n.introduction+' '+n.interest:e.description?'Source introduction:'+e.description.slice(0,260):'The source has not provided a summary, currently unable to determine specific highlights.')+'\n'+e.venue+' · '+(e.occurrences?.length?e.occurrences.map(o=>o.date+' '+o.start+'–'+o.end).join('；'):'The source only gives '+e.start+'  to  '+e.end+' date range, specific occurrences unverified')+(e.displayDistance&&Number.isFinite(e.distance)?'; from  '+e.distanceOrigin+' , approximately  '+e.distance+' km':'');}).join('\n\n')+'\n\nTimes are local to Stockholm. Ticket availability and bookings are unverified. Which would you like to explore?';
  };
  const handlers={
    async set_activity_window({activityId,start,end,userQuote,assumption}){
      if(!state.activityDefinitions[activityId])throw Error('Activity not recorded yet.');
      return handlers.update_trip({patch:{activities:state.activities.map(id=>({...state.activityDefinitions[id],...(id===activityId?{windowStart:start,windowEnd:end,windowQuote:userQuote}:{})}))},assumptions:assumption?[...assumptions.filter(n=>n!==assumption),assumption]:assumptions});
    },
    async select_option({groupId,activityId,reason,delegationQuote}){if(!state.choiceGroups.some(g=>g.id===groupId))throw Error('Record the option group first.');return handlers.update_trip({patch:{choiceGroups:state.choiceGroups.map(g=>g.id===groupId?{...g,selected:activityId,selectionBy:'assistant',reason,delegationQuote}:g)}});},
    async set_budget({mode,amount}){return handlers.update_trip({patch:{budgetMode:mode,budget:amount}});},
    async discover_candidates(){
      if(!state.origin||!state.activities.length)throw Error('Record the origin and activity requirements first. Ask normally if the origin is unknown.');
      if(!discovery.origin){
        const r=await handlers.search_places({query:state.origin});
        if(!r.candidates.length)throw Error('Origin not found. Please check the landmark name.');
        const match=r.candidates.find(p=>originMatches(getPlace(p.id)));
        if(!match)throw Error('The origin search result does not match “'+state.origin+'”. The first alternative was not adopted. Check candidates or search again using the landmark named by the user.');
        await handlers.select_candidates({activityId:'origin',placeIds:[match.id]});
      }
      const missing=activeActivities(state).filter(id=>!discovery.pools[id]?.length);
      const results=await Promise.allSettled(missing.map(async id=>{
        const a=state.activityDefinitions[id],r=await handlers.search_places({query:a.query});
        const matching=[];
        for(const p of r.candidates){if(await resolveVenue(getPlace(p.id),a))matching.push(p);}
        if(matching.length)await handlers.select_candidates({activityId:id,placeIds:matching.slice(0,3).map(p=>p.id)});
      }));
      return {origin:briefPlace(discovery.origin),groups:Object.fromEntries(state.activities.map(id=>[id,(discovery.pools[id]||[]).map(briefPlace)])),errors:results.flatMap((r,i)=>r.status==='rejected'?[{activityId:missing[i],message:r.reason.message}]:[]),notice:'Candidates prepared from recorded requirements, not yet scheduled. Check that venues offer the requested experience; opening hours do not prove buffet service, stock or session availability.'};
    },
    async present_events({eventRefs,recommendations=[]}){const message=presentEvents(eventRefs,recommendations,true);for(let i=cards.length-1;i>=0;i--)if(cards[i].type==='event'&&!eventRefs.includes(cards[i].ref))cards.splice(i,1);return {message,...(unquoted.length?{unquoted:[...unquoted],unquotedNotice:'These introductions were not used because their sourceQuote is not in the event description; the source text is shown instead. Describe those events only from their description.'}:{}),notice:'Activity cards and sourced introductions are ready. Handle the remaining requests, then use finish to deliver the complete response.'};},
    // Interpretations are accepted and labelled rather than gated: each fact
    // records whether the user said it or the assistant assumed it. `by` is who
    // is writing; where the host can check the user's own words, those decide.
    async update_trip({patch,assumptions:notes,by='assistant'}){
      const merged={...state,...patch};
      if(patch.activities)merged.activities=patch.activities.map(a=>{
        const old=state.activityDefinitions[a.id],next={...old,...a};
        // A later message being interpreted does not erase a time the user gave earlier; changing it takes a new time or an explicit edit.
        if(by==='user'&&old&&state.labels['window:'+a.id]==='user'&&!next.windowStart&&!next.windowEnd)Object.assign(next,{windowStart:old.windowStart,windowEnd:old.windowEnd,windowQuote:old.windowQuote});
        return next;
      });
      if(patch.activities&&!Object.hasOwn(patch,'precedence')){const ids=patch.activities.map(a=>a.id);merged.precedence=state.precedence.filter(e=>ids.includes(e.before)&&ids.includes(e.after));}
      const next=stateOf(merged);
      if(state.budgetMode!=='unknown'&&next.budgetMode==='unknown')throw Error('An answered budget must not become unknown again. Retain its meaning unless the user changes it to a new ceiling, unlimited or flexible spending.');
      const normalize=v=>String(v||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      const userTexts=[...(task?.requests||[]),...(raw.history||[]).filter(m=>m.role==='user').map(m=>m.content),raw.text].filter(Boolean);
      const said=text=>{const wanted=normalize(text);return !!wanted&&userTexts.some(t=>normalize(t).includes(wanted));};
      // “10:00”, “10.00”, “10 am”, “at 10” all state the clock time 10:00.
      const saidTime=time=>{if(!time)return false;const [h,m]=time.split(':').map(Number),h12=h%12||12,hours='(?:'+h+'|0'+h+(h>12?'|'+h12:'')+')';return userTexts.some(t=>new RegExp('(?<![\\d:.])'+hours+'[:.]'+String(m).padStart(2,'0')+'(?!\\d)|'+(m===0?'(?<![\\d:.])(?:'+h12+'|'+h+')\\s*(?:'+(h<12?'a':'p')+'\\.?m\\.?|o.clock)|\\b(?:at|by|around|until|from)\\s+'+hours+'(?![\\d:.])':'(?!)'),'i').test(t));};
      const labels={...state.labels},mark=(key,label)=>{labels[key]=label;};
      // “today”, “tomorrow” or the date itself in the user's words makes the date theirs, whoever recorded it.
      const today=dateInStockholm(),saidDate=d=>userTexts.some(t=>t.includes(d)||(d===today&&/\b(today|tonight|this (morning|afternoon|evening))\b/i.test(t))||(d===nextDate(today)&&/\btomorrow\b/i.test(t)));
      if(next.date!==state.date)next.date?mark('date',saidDate(next.date)?'user':by):delete labels.date;
      if(next.origin!==state.origin)next.origin?mark('origin',said(patch.originQuote)||said(next.origin)?'user':'assistant'):delete labels.origin;
      for(const k of ['start','deadline'])if(next[k]!==state[k])next[k]?mark(k,by):delete labels[k];
      if(next.budgetMode!==state.budgetMode||next.budget!==state.budget)mark('budget',next.budgetMode==='limited'?(userTexts.some(t=>t.replace(/[\s,.]/g,'').includes(String(next.budget)))?'user':'assistant'):by);
      if(JSON.stringify(next.precedence)!==JSON.stringify(state.precedence))next.precedence.length?mark('precedence',userTexts.some(hasOrderAnchor)?'user':'assistant'):delete labels.precedence;
      for(const key of Object.keys(labels))if(/^(activity|window):/.test(key)&&!next.activities.includes(key.slice(key.indexOf(':')+1)))delete labels[key];
      for(const a of Object.values(next.activityDefinitions)){
        const old=state.activityDefinitions[a.id];
        if(!old)mark('activity:'+a.id,by);
        if(a.eventRef||(!a.windowStart&&!a.windowEnd))delete labels['window:'+a.id];
        else if(!old||old.windowStart!==a.windowStart||old.windowEnd!==a.windowEnd){
          const kept=old&&state.labels['window:'+a.id]==='user'&&(old.windowStart===a.windowStart||old.windowEnd===a.windowEnd);
          mark('window:'+a.id,kept||saidTime(a.windowStart)||saidTime(a.windowEnd)||(a.windowQuote&&said(a.windowQuote)&&hasTimeAnchor(a.windowQuote))?'user':'assistant');
        }
      }
      next.labels=labels;

      for(const a of Object.values(next.activityDefinitions))if(a.eventRef){const e=eventEvidence.get(a.eventRef);if(!e&&by==='user'){a.eventRef=null;continue;}if(!e)throw Error('Event evidence is expired or missing. Discover the event again.');a.availability='session';a.requiredNames=[e.venue];a.query=e.venue;}

      if(next.origin!==state.origin)discovery={origin:null,origins:[],pools:{}};
      const identity=a=>a&&JSON.stringify([a.query,a.requiredNames,a.availability]);
      for(const id of Object.keys(discovery.pools))if(!next.activities.includes(id)||identity(next.activityDefinitions[id])!==identity(state.activityDefinitions[id]))delete discovery.pools[id];
      if(JSON.stringify(next)!==JSON.stringify(state)){revision++;if(next.activities.length)requirePlan();}
      state=next;if(notes)assumptions=notes.slice(0,8).map(n=>n.slice(0,300));
      return {state:publicState(state),assumptions};
    },
    async search_places({query}){
      timeCheck();if(searches>=12)throw Error('Location query quota for this round exhausted.');
      searches++;
      const places=await services.maps.search(query,null,discovery.origin?.location);
      for(const p of places){p.aliases=observed.get(p.id)?.aliases||p.aliases||[];observed.set(p.id,p);}
      return {query,candidates:places.map(briefPlace),notice:'Query only; origin and activity candidates are unchanged. Verify names and relevance, then use select_candidates to assign candidates; change the query if they do not match.'};
    },
    async select_candidates({activityId,placeIds}){
      if(!placeIds.length||placeIds.length>5)throw Error('Please select1 to 5 previously queried places.');
      const places=placeIds.map(getPlace);
      for(const p of places){const e=experience.get(activityId+':'+p.id);if(e?.status==='not_supported'&&e.requirement===state.activityDefinitions[activityId]?.label&&e.date===state.date)throw Error('Observed website evidence contradicts this experience. Check other candidates, or revise the assessment using new website evidence.');}
      if(activityId==='origin'){if(places.length!==1)throw Error('Select exactly one origin.');if(!state.origin)throw Error('Record the user’s origin name first.');if(!originMatches(places[0]))throw Error('The map origin “'+places[0].name+'” and the recorded user origin “'+state.origin+'” do not match. Search rank is not identity evidence. Check or search this landmark again; do not substitute another station.');discovery.origin=places[0];discovery.origins=places;}
      else{const a=state.activityDefinitions[activityId];if(!a)throw Error('Activity not recorded yet.');for(const p of places)if(!await resolveVenue(p,a))throw Error('Candidate does not meet the named-place requirement. Required: '+a.requiredNames.join(' / ')+'; observed: '+places.map(p=>p.name).join(' / ')+(a.eventRef?'. Source coordinates and local names were checked; evidence still does not match. Explain the specific gap and distinguish the activity meeting point from the user’s departure point.':'. Only correct verified aliases of the same place; do not relax the required identity.'));discovery.pools[activityId]=places;}
      revision++;const a=state.activityDefinitions[activityId];return {selected:places.map(briefPlace),...(a?.eventRef?{venueEvidence:places.map(p=>eventVenueMatch(p,eventEvidence.get(a.eventRef)))}:{})};
    },
    async place_details({placeId}){const old=getPlace(placeId),p=await details(old.id);p.aliases=old.aliases||[];observed.set(p.id,p);for(const id of Object.keys(discovery.pools))discovery.pools[id]=discovery.pools[id].map(v=>v.id===p.id?p:v);if(discovery.origin?.id===p.id)discovery.origin=p;if(JSON.stringify(old)!==JSON.stringify(p))revision++;return {...briefPlace(p),evidence:'GooglePlace data only; official website, ticketing and inventory have not been read.'};},
    async read_place_website({placeId,url}){
      timeCheck();const p=getPlace(placeId);if(!p.website)throw Error('Maps provided no website; experience details remain unverified.');
      if(websiteReads>=4)throw Error('Four website pages have already been read this turn. Explain the evidence and remaining gaps.');
      const target=new URL(url||p.website).href,home=new URL(p.website).href;
      if(target!==home&&![...pages.values()].some(v=>v.placeId===p.id&&v.links.some(l=>l.url===target)))throw Error('Only read the official website link observed for this location; do not guess the URL.');
      websiteReads++;const page=await (services.readPlaceWebsite||readPlaceWebsite)(target,p.website);pages.set(page.url,{...page,placeId:p.id});
      return {...page,place:briefPlace(p),evidenceType:'official_page_text_not_booking'};
    },
    async assess_place_offer({activityId,placeId,sourceUrl,quote,status,explanation}){
      const p=getPlace(placeId),a=state.activityDefinitions[activityId],page=pages.get(sourceUrl);
      if(!a||!page||page.placeId!==p.id||!quote.trim()||!page.text.includes(quote))throw Error('Experience judgment must quote the original text of the official website read for this location in this round, and link it to the recorded activity.');
      experience.set(activityId+':'+p.id,{activityId,placeId:p.id,requirement:a.label,date:state.date,status,explanation,quote,sourceUrl,checkedAt:page.checkedAt,evidenceType:'model_interpretation_of_official_page'});
      if(status==='not_supported')discovery.pools[activityId]=(discovery.pools[activityId]||[]).filter(v=>v.id!==p.id);
      revision++;return {recorded:true,status,explanation,notice:'Retain the original text and link for review; the service, availability, inventory, or reservation for the day has not yet been confirmed.'};
    },
    async route({from,to,date,time,transport}){getPlace(from);getPlace(to);validDate(date);const r=await travel(getPlace(from).id,getPlace(to).id,instant(date,minute(time)),transport);return {minutes:r.minutes,walking:r.walking,lines:r.lines,fare:r.fare,mode:r.mode};},
    async calendar_availability({date}){validDate(date);const d=await services.calendarDay(date);return {date,connected:d.connected!==false,busy:[...d.busy,...d.own].map(e=>({start:e.start,end:e.end})),commitments:d.own.length};},
    async plan_itinerary({routeBudget=18}={}){
      // Leave time, return time and budget constrain the plan only when the
      // user gave them. Otherwise the search simply runs without that limit and
      // nothing is saved or presented as a condition.
      const open={start:!state.start,deadline:!state.deadline,budget:state.budgetMode==='unknown'};
      // Find the departure point and any missing candidate places here, so a
      // plan request is one call rather than a search/bind sequence.
      let preparation=null;
      if(state.date&&state.origin&&state.activities.length&&(!discovery.origin||activeActivities(state).some(id=>!discovery.pools[id]?.length)))try{preparation=(await handlers.discover_candidates({})).errors;}catch(error){preparation=[{message:error.message}];}
      const firstTimed=Math.min(...Object.values(state.activityDefinitions).filter(a=>a.windowStart).map(a=>minute(a.windowStart)),660);
      const planning={...state,start:state.start||clock(Math.max(360,firstTimed-60)),deadline:state.deadline||'24:00',timeMode:open.start||open.deadline||state.timeMode==='unknown'?'flexible':state.timeMode,...(open.budget?{budgetMode:'flexible',budget:null}:{})};
      await checkIntake();
      const pending=readiness();
      if(!pending.ready){const error=Error('Planning conditions not yet satisfied:'+[pending.missingFields.length?'Missing '+pending.missingFields.join(', '):'',...pending.missingDecisions,!pending.originSelected?'No departure point selected':'',pending.missingCandidates.length?'No activity location selected:'+pending.missingCandidates.map(a=>a.label).join('、'):''].filter(Boolean).join('；')+'. Please handle them together, or explain which conditions require user decision.'+(preparation?.length?' Preparing places reported: '+preparation.map(e=>e.message).join(' '):''));error.details=pending;throw error;}
      if(planAttempts>=3)throw Error('This round has completed three schedule checks; please deliver the ascertained results and concrete next steps.');
      planAttempts++;
      const active=activeActivities(state);
      let input={...journeySettings({...planning,activities:active,precedence:state.precedence.filter(e=>active.includes(e.before)&&active.includes(e.after))}),originQuery:state.origin,text:raw.text};
      const day=scopeJourneyDay(await services.calendarDay(input.date),input.activities);
      const allChecks=services.getChecks(input.date),checks=Object.fromEntries(Object.entries(allChecks.items).filter(([id])=>input.activities.includes(id)));
      for(const fixed of [...Object.values(checks),...day.own.filter(e=>e.locked&&e.kind!=='meeting')]){
        if(!discovery.pools[fixed.kind]?.some(p=>p.id===fixed.placeId)){const p=await details(fixed.placeId);observed.set(p.id,p);discovery.pools[fixed.kind].push(p);}
      }
      const selectedMovie=raw.lockMovie&&services.previous?.result.plans.find(p=>p.id===raw.choice)?.stops.find(s=>s.kind==='movie');
      const locks=selectedMovie?[{kind:'movie',placeId:selectedMovie.placeId,start:selectedMovie.start,duration:selectedMovie.end-selectedMovie.start}]:[];
      const eventChecks={},dropIns=[];
      for(const a of Object.values(state.activityDefinitions))if(input.activities.includes(a.id)&&a.eventRef){
        let e=eventEvidence.get(a.eventRef);timeCheck();
        if(services.eventDetails){e={...e,...await services.eventDetails(e.url)};eventEvidence.set(e.ref,e);}
        const occurrence=e.occurrences?.find(o=>o.date===input.date);
        if(!occurrence)throw Error('Not yet verified 「'+a.label+'” in '+input.date+' ’s specific session; cannot treat date range as scheduling time. Please verify source or discuss alternative activities.');
        const place=discovery.pools[a.id].find(p=>matchPlace(p,a));
        if(!place)throw Error('Activity venue does not match source.');
        if(minute(occurrence.end)-minute(occurrence.start)>240){input.activityDefinitions={...input.activityDefinitions,[a.id]:{...input.activityDefinitions[a.id],windowStart:occurrence.start,windowEnd:occurrence.end}};dropIns.push('“'+e.title+'” is open '+occurrence.start+'–'+occurrence.end+' according to its source; a visit of about '+input.durations[a.id]+' minutes is scheduled within that time.');continue;}
        eventChecks[a.id]={kind:a.id,placeId:place.id,date:input.date,timeStatus:'checked',start:minute(occurrence.start),duration:minute(occurrence.end)-minute(occurrence.start),title:e.title,timeSource:e.url,venueMatch:eventVenueMatch(place,e),price:null,reportedBy:'source',checkedAt:e.checkedAt};
      }
      const search=()=>proposeJourneys(input,discovery,{route:travel,day,checks:{...eventChecks,...checks},sourceChecks:eventChecks,locks,routeCache,maxCalls:Math.max(0,Math.min(routeBudget,36-routeCalls))});
      let result=await search();const relaxed=[];
      // With no leave time given there is no reason to set off early and wait
      // at the first stop: leave later by the shortest such wait and check again.
      if(open.start&&result.plans.length){
        const wait=Math.min(...result.plans.map(p=>p.stops[0].start-p.legs[0].arrive));
        if(wait>=30){
          const early=input,first=result;
          input={...input,start:clock(minute(input.start)+Math.floor(wait/5)*5)};
          const shifted=await search();
          if(shifted.plans.length)result=shifted;else{input=early;result=first;}
        }
      }
      // What the user said is a requirement; what the assistant assumed is not.
      // If nothing fits, try once more without an assumed order or time window.
      if(!result.plans.length){
        const softWindows=active.filter(id=>state.labels['window:'+id]==='assistant'&&!state.activityDefinitions[id].eventRef),softOrder=state.labels.precedence==='assistant'&&input.precedence.length>0;
        if(softWindows.length||softOrder){
          const strict=input;
          input={...input,precedence:softOrder?[]:input.precedence,activityDefinitions:{...input.activityDefinitions,...Object.fromEntries(softWindows.map(id=>[id,{...input.activityDefinitions[id],windowStart:null,windowEnd:null}]))}};
          const second=await search();
          if(second.plans.length){
            result=second;
            if(softOrder)relaxed.push('the order I had assumed');
            relaxed.push(...softWindows.map(id=>'the '+state.activityDefinitions[id].windowStart+'–'+state.activityDefinitions[id].windowEnd+' time I had assumed for “'+state.activityDefinitions[id].label+'”'));
            await handlers.update_trip({patch:{...(softOrder?{precedence:[]}:{}),...(softWindows.length?{activities:state.activities.map(id=>({...state.activityDefinitions[id],...(softWindows.includes(id)?{windowStart:null,windowEnd:null,windowQuote:null}:{})}))}:{})}});
          }else input=strict;
        }
      }
      result.experienceEvidence=Object.fromEntries(experience);
      for(const p of result.plans)p.experienceChecks=p.stops.map(stop=>{const evidence=experience.get(stop.kind+':'+stop.placeId),a=state.activityDefinitions[stop.kind];return {activityId:stop.kind,label:stop.label,venue:result.places[stop.placeId].name,requirement:a.label,...(evidence?.requirement===a.label&&evidence.date===input.date?evidence:{status:'uncertain',explanation:'Only location and business hours found; specific experience content not yet verified.'})};});
      result.open=open;result.notes=result.notes.filter(n=>!n.startsWith('Time tentatively set by assistant'));
      result.supported=true;result.calendarConnected=day.connected!==false;result.checks={...eventChecks,...checks};result.sourceChecks=eventChecks;result.checkRevision=allChecks.revision;result.retainedCount=day.retained.length;
      result.notes.push(...state.choiceGroups.filter(g=>g.selected).map(g=>(g.selectionBy==='assistant'?'Assistant tentatively selected:':'User selected:')+state.activityDefinitions[g.selected].label+'。'+g.reason));
      result.notes.push(...dropIns);
      if(relaxed.length)result.notes.push('Nothing fit with '+relaxed.join(' and ')+', so I dropped that assumption.');
      result.notes.push(...assumptions.map(s=>'Assistant tentatively set:'+s));
      result.notes.push(...interpretationNotes());
      if(day.retained.length)result.notes.push(`In the calendar there are also ${day.retained.length} items already scheduled, retained as busy periods; this preview does not modify them.`);
      result.changeBasis='Current calendar';result.changes=result.plans.map(p=>({choice:p.id,changes:planChanges(p,day,result.meeting)}));
      const id=services.saveJourney({input,discovery:structuredClone(discovery),result,day});
      journey={...result,id};choice=result.plans[0]?.id||'0';plannedRevision=revision;changed=true;
      return {...journeyReplyFacts(journey,choice),requested:publicState(state),actualOrigin:briefPlace(discovery.origin),assumptions,...(relaxed.length?{relaxedAssumptions:relaxed}:{}),planChoices:result.plans.map(p=>({id:p.id,displayNumber:Number(p.id)+1,name:p.name,experienceChecks:p.experienceChecks,availabilityPending:p.availabilityPending,stops:p.stops.map(s=>({activity:s.label,venue:result.places[s.placeId].name,start:clock(s.start),end:clock(s.end)})),legs:p.legs.map(l=>({mode:l.mode,depart:clock(l.depart),arrive:clock(l.arrive),walking:l.walking,minutes:l.minutes})),returnAt:clock(p.homeAt),reserveSEK:p.reservedTotal,walking:p.walking,gaps:p.gaps,continuityUnverified:p.continuityUnverified})),remainingRoutes:36-routeCalls,remainingPlanAttempts:3-planAttempts};
    },
    async select_plan({choice:id}){currentPlan();if(!journey.plans.some(p=>p.id===id))throw Error('Solution number does not exist.');choice=id;selectionChanged=true;return journeyReplyFacts(journey,choice);},
    async calendar_changes(){const p=currentPlan();return {changes:journey.changes.find(c=>c.choice===p.id)?.changes.map(({kind,label,start,end,locked,operation,before})=>({kind,label,start:clock(start),end:clock(end),locked,operation,before:before?{start:clock(before.start),end:clock(before.end)}:null})),continuityUnverified:p.continuityUnverified,availabilityPending:p.availabilityPending,handoff:p.availabilityPending?.length?'First verify specific sessions and reorder; currently only a route draft.':p.continuityUnverified?'First handle location connections, then replan.':'Please check on the page to confirm verification; after preview, manually confirm entry.',written:false};},
    async inspect_activity({activityId}){const p=currentPlan(),stop=p.stops.find(s=>s.kind===activityId);if(!stop)throw Error('This activity is not in the current plan.');return {activity:stop.label,place:briefPlace(journey.places[stop.placeId]),verification:stop.verification?{timeStatus:stop.verification.timeStatus,price:stop.verification.price}:null,priceVerified:stop.priceVerified,windowKnown:stop.windowKnown,next:'Official website link available for cross-check; use the page activity verification table to record actual evidence, no reservations made.'};},
    async event_details({eventRef}){const old=eventEvidence.get(eventRef);if(!old)throw Error('Only activities already discovered can be verified.');const e={...old,...await services.eventDetails(old.url)};if(JSON.stringify(old.occurrences)!==JSON.stringify(e.occurrences)&&Object.values(state.activityDefinitions).some(a=>a.eventRef===eventRef))revision++;eventEvidence.set(eventRef,e);return e;},
    async read_news(){const r=await services.readNews();cards.push(...r.cards);return r;},
    async nearby_events({origin,date,originQuote='',showDistance=false,days=1,category='all'}){validDate(date);const r=await services.nearbyEvents(origin,{days,category,from:date});const normalize=s=>String(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');const texts=[...(raw.history||[]).filter(m=>m.role==='user').map(m=>m.content),raw.text].filter(Boolean);const userReference=!!originQuote.trim()&&texts.some(t=>t.includes(originQuote))&&normalize(originQuote).includes(normalize(origin));const found=r.events.map(e=>({...e,type:'event',source:'Visit Stockholm',displayDistance:showDistance&&userReference}));for(const e of found)if(e.ref)eventEvidence.set(e.ref,e);cards.push(...found);return {message:r.message,origin:r.origin,searchedDates:{from:date,days},referenceBasis:userReference?'user_supplied':'assistant_search_reference_not_user_location',cards:found};}
  };
  // Every observation includes all prerequisites; failed calls carry the same snapshot.
  for(const [name,handler] of Object.entries(handlers))handlers[name]=async args=>({...await handler(args),progress:readiness()});
  const checkedReply=()=>{
    if(!changed||!journey||plannedRevision!==revision)return null;
    const facts=journeyReplyFacts(journey,choice),c=journey.constraints,selected=journey.plans.find(p=>p.id===choice)||journey.plans[0];
    const sessions=Object.values(journey.sourceChecks||{}).map(e=>e.title+' '+clock(e.start)+'–'+clock(e.start+e.duration));
    const notes=[...assumptions,...interpretationNotes()];
    return `Checked ${c.activities.length} activities for ${c.date}, ${c.start}–${c.deadline}. `+facts.fallback+(sessions.length?' Sessions listed in source:'+sessions.join('；')+', remaining tickets and bookings not yet verified.':'')+(!journey.plans.length?' This round’s limited candidates did not find a feasible solution.'+(journey.repairOptions||[]).slice(0,2).map(o=>o.explanation).join(' '):'')+(selected?.experienceChecks?.length?' Experience verification:'+selected.experienceChecks.map(e=>e.label+'：'+(e.status==='supported'?'The official website has relevant clues, but still need to confirm availability for the day':e.status==='not_supported'?'Official website clues do not match the demand':'Specific service or access not yet verified')).join('；')+'。':'')+(notes.length?' Tentative conditions:'+notes.join('；')+'。':'')+' Not written to calendar.';
  };
  const lastAttempt=()=>changed&&journey&&plannedRevision!==revision&&journey.constraints.date===state.date?{id:journey.id,constraints:journey.constraints,sourceChecks:journey.sourceChecks||{},reason:journey.reason,diagnostics:journey.diagnostics,checkedAt:journey.checkedAt,plansCount:journey.plans.length}:null;
  const lastAttemptReply=()=>{
    const previous=lastAttempt();if(!previous)return null;
    const sessions=Object.values(previous.sourceChecks).map(e=>e.title+' '+clock(e.start)+'–'+clock(e.start+e.duration));
    return `The most recent verified attempt is ${previous.constraints.date} ${previous.constraints.start}–${previous.constraints.deadline}, total ${previous.constraints.activities.length} activities:`+previous.reason+' Subsequent adjustments to conditions or candidates have not been re‑verified and cannot be considered the current feasible plan.'+(sessions.length?' Obtained public sessions:'+sessions.join('；')+', remaining tickets and reservations have not been verified.':'')+(interpretationNotes().length?' '+interpretationNotes().join('；')+'。':'')+' The demand remains; you can continue comparing candidates or discussing adjustments from here. Not written to calendar.';
  };
  const fallback=(reason)=>{
    if(!reason&&eventPresentationPending())return presentEvents(cards.filter(c=>c.type==='event').map(c=>c.ref).filter(Boolean).slice(0,8));
    const prefix={output_limit:'Model output reached the length limit; no incomplete operation was performed.',intake_error:'New conditions for this round could not be fully saved; please try again.',limit:'This round of checking stops here.',service_error:'The model connection was interrupted.',review_error:'The final response could not complete verification.',needs_review:'The final response still has unverified issues.'}[reason]||'';
    if(lastAttempt())return (prefix?prefix+' ':'')+lastAttemptReply();
    if(journey&&plannedRevision===revision){
      const facts=journeyReplyFacts(journey,choice);
      const next=(journey.repairOptions||[]).slice(0,2).map(o=>o.explanation).join(' ');
      return (prefix?prefix+' ':'')+facts.fallback+(!journey.plans.length?' Next step:'+(next||'We can discuss adjusting the time slot, changing the day, or streamlining activities; these changes have not been executed yet.'):'')+' Not written to calendar.';
    }
    // A generation failure says nothing about whether the user owes us more
    // planning details; discussion-only turns may deliberately leave them open.
    if(['output_limit','service_error'].includes(reason))return (prefix?prefix+' ':'')+(searches?'Completed '+searches+'  location queries.':'')+(cards.length?'Obtained '+cards.length+'  items of sourced information, see the cards below.':'')+'This round’s response is incomplete. Saved conditions and query results remain retained; you can continue this round. Not written to calendar.';
    const p=readiness(),labels={date:'Travel date',origin:'Origin',start:'Departure time',deadline:'Return time',activities:'Activity selection'};
    const missing=[...p.missingFields.map(k=>labels[k]),...(!p.originSelected&&state.origin?['Map matching of departure point']:[]),...p.missingCandidates.map(a=>a.label+' candidate locations')];
    const pending=p.sessionActivities.length?' '+p.sessionActivities.map(a=>a.label).join('、')+'Still need specific session evidence; location search does not equate to event occurrence.':'';
    return (prefix?prefix+' ':'')+(searches?'Completed '+searches+'  location queries.':'')+(cards.length?'Obtained '+cards.length+'  items of sourced information, see the cards below.':'')+(missing.length?'I have not yet fully organized this round’s demands into plan‑able conditions. The stated needs will remain in the conversation; please continue adding or retry.':state.activities.length?'Current conditions have not yet completed route and calendar validation; further planning is needed.':'This round has not yet fulfilled your request; you can continue to supplement demands or retry.')+pending+' Not written to calendar.';
  };
  return {checkpoint:()=>structuredClone({state,assumptions,task,discovery,observed:[...observed],events:[...eventEvidence],pages:[...pages],experience:[...experience],cards}),handlers,trace,readiness,fallback,checkedReply,checkIntake,lastAttemptReply,eventPresentationPending,planningPending,requirePlan,pausePlanning(){task={...task,kind:'planning',status:'paused'};},get revision(){return revision;},get state(){return state;},get assumptions(){return assumptions;},context(){return {task,planningPending:planningPending(),eventEvidence:[...eventEvidence.values()],experienceEvidence:[...experience.values()],today:dateInStockholm(),dateFacts:state.date?{date:state.date,weekday:new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(state.date+'T12:00:00Z'))}:null,progress:readiness(),trip:publicState(state),assumptions,currentPlan:journey&&plannedRevision===revision?{...journeyReplyFacts(journey,choice),options:journey.plans.map(p=>({choice:p.id,displayNumber:Number(p.id)+1,name:p.name,order:p.stops.map(s=>s.label)})),choice,displayNumber:Number(choice)+1,origin:journey.origin.name,stops:journey.plans.find(p=>p.id===choice)?.stops.map(s=>({activity:s.label,start:clock(s.start),end:clock(s.end)})),legs:journey.plans.find(p=>p.id===choice)?.legs.map(l=>({mode:l.mode,minutes:l.minutes,walking:l.walking}))}:null};},output(){return {slots:{...state,task,assumptions,evidenceId:services.saveEvidence?.([...eventEvidence.values()])||raw.slots?.evidenceId},progress:readiness(),assumptions,lastAttempt:lastAttempt(),journey:changed&&plannedRevision===revision?journey:undefined,selection:selectionChanged&&plannedRevision===revision?choice:undefined,choice,cards:[...new Map(cards.map(c=>[c.url,c])).values()],trace,stale:plannedRevision!==revision,routeCalls,searches};}};
}
