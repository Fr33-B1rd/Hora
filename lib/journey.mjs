import {fixedConflicts,repairOptions,calendarTime} from './plan-diagnostics.mjs';
import { checkFor } from './verification.mjs';
import { minute, clock, instant, validDate, localParts, intersects } from './time.mjs';

import {kinds,activityDefinitions,precedenceRules,budgetState} from './activities.mjs';
export {kinds} from './activities.mjs';
const permutations=a=>a.length?a.flatMap((x,i)=>permutations(a.filter((_,j)=>j!==i)).map(p=>[x,...p])):[[]];
const product=a=>a.reduce((r,g)=>r.flatMap(p=>g.map(x=>[...p,x])),[[]]);
const at=s=>{const p=localParts(Date.parse(s));return +p.hour*60 + +p.minute;};
const km=(a,b)=>{const rad=Math.PI/180,dy=(a.latitude-b.latitude)*111,dx=(a.longitude-b.longitude)*111*Math.cos(a.latitude*rad);return Math.hypot(dx,dy);};

// Weekly periods may cross midnight or the Sunday boundary. Missing hours are
// unknown, not closed; an explicitly empty periods array means no known opening.
export function openingWindows(place,date){
  if(place.periods===null||place.periods===undefined)return null;
  const day=new Date(date+'T12:00:00Z').getUTCDay(),out=[];
  for(const p of place.periods){
    if(!p.open)continue;
    if(!p.close){out.push([0,1440]);continue;}
    const open=p.open.day*1440+(p.open.hour||0)*60+(p.open.minute||0);
    let close=p.close.day*1440+(p.close.hour||0)*60+(p.close.minute||0);if(close<=open)close+=10080;
    for(const shift of [-10080,0,10080]){const lo=Math.max(0,open+shift-day*1440),hi=Math.min(1440,close+shift-day*1440);if(lo<hi)out.push([lo,hi]);}
  }
  return out.sort((a,b)=>a[0]-b[0]);
}
export function journeySettings(raw={}){
  const date=validDate(raw.date),start=minute(raw.start||'13:00'),deadline=minute(raw.deadline||'20:00');
  const {budget,budgetMode}=budgetState(raw),transport=raw.transport||'transit';
  if(start<360||deadline<=start||budgetMode==='unknown'||!['walk','transit'].includes(transport))throw Error('Please check budget, transport, and today’s departure/and return time.');
  const definitions=activityDefinitions(raw.activities||Object.keys(kinds),raw.activityDefinitions),activities=definitions.map(a=>a.id);
  if(!activities.length)throw Error('Please schedule at least one activity.');
  const details=Object.fromEntries(definitions.map(a=>[a.id,a])),precedence=precedenceRules(raw.precedence,activities);
  const allowances={},durations={};
  for(const k of activities){allowances[k]=Number(raw.allowances?.[k]??details[k].allowance);durations[k]=Number(raw.durations?.[k]??details[k].duration);if(!Number.isFinite(allowances[k])||allowances[k]<0||allowances[k]>1000000||!Number.isInteger(durations[k])||durations[k]<10||durations[k]>240)throw Error('Please check activity reserve amount and duration.');}
  const transitReserve=transport==='walk'?0:Number(raw.transitReserve??150);if(!Number.isFinite(transitReserve)||transitReserve<0||transitReserve>10000)throw Error('Transport reserve amount is invalid.');
  const maxWalking=raw.maxWalking??null;
  if(maxWalking!==null&&(!Number.isFinite(maxWalking)||maxWalking<0||maxWalking>180))throw Error('Total walking limit must be within 0–180  minutes.');
  return {date,start:clock(start),deadline:clock(deadline),timeMode:raw.timeMode||'fixed',budget,budgetMode,transport,activities,activityDefinitions:details,precedence,lowWalking:!!raw.lowWalking,allowances,durations,transitReserve,maxWalking};
}
export function meetingFor(date,raw){
  if(!raw)return null;
  const start=minute(raw.start),end=minute(raw.end);if(start>=end)throw Error('Meeting end time must be later than start time.');
  return {kind:'meeting',placeId:'',start,end,locked:true,tentative:false,title:'Personal online meeting',date};
}
export function calendarMeeting(day){const m=day.own.find(e=>e.kind==='meeting');return m?{kind:'meeting',placeId:'',start:at(m.start),end:at(m.end),locked:true,tentative:false}:null;}

const genericPlaceWords=new Set(['the','campus','station','museum','museet','restaurant','restaurang','cafe','café','store','shop','centre','center','city','mall','market','park','hotel','entrance','building','branch','stockholm']);
export function matchesRequiredName(place,activity){
  const names=activity.requiredNames||[];
  const normalize=s=>String(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  // Maps may return a translated or respaced name for the same place
  // (“National Museum” for Nationalmuseum), so also compare without spaces.
  const actual=[place.name,...(place.aliases||[])].map(normalize),compact=s=>s.replaceAll(' ','');
  // “KTH Campus” names KTH: generic words do not have to appear in the map name,
  // as long as every distinguishing word does.
  const distinct=s=>s.split(' ').filter(w=>w&&!genericPlaceWords.has(w));
  return !names.length||names.some(n=>{const wanted=normalize(n),core=distinct(wanted);return !!wanted&&actual.some(a=>(' '+a+' ').includes(' '+wanted+' ')||compact(a)===compact(wanted)||(core.length>0&&core.length<wanted.split(' ').length&&core.every(w=>a.split(' ').includes(w))));});
}
export async function discoverJourney(input,maps){
  input={...input,...journeySettings(input)};
  const originQuery=input.originQuery?.trim()||'Stockholm Centralstation';
  const origins=await maps.search(originQuery,null);if(!origins.length)throw Error('No departure point found; please add a station or public landmark name.');
  const origin=origins[0],pools={},diagnostics=[];
  await Promise.all(input.activities.map(async k=>{
    const activity=input.activityDefinitions[k];
    let found=await maps.search(activity.query,activity.type||null,origin.location);
    pools[k]=found.filter(p=>matchesRequiredName(p,activity));
    if(!pools[k].length&&activity.requiredNames.length){
      found=await maps.search(activity.requiredNames[0],null,origin.location);
      pools[k]=found.filter(p=>matchesRequiredName(p,activity));
    }
    if(!pools[k].length)diagnostics.push({code:activity.requiredNames.length?'named_place_missing':'place_missing',activity:k,message:activity.requiredNames.length?`No matching location found for ”${activity.requiredNames[0]}”; searched again by name; no replacement with other brands. You may expand the search area or tell me which alternatives you accept.`:`This round did not find a suitable location for ”${activity.label}”; you may add area or give more specific preferences.`});
  }));
  return {origin,origins,pools,diagnostics,queriedAt:new Date().toISOString()};
}

export async function proposeJourneys(input,discovery,{route,day,locks=[],meeting=null,checks={},sourceChecks={},routeCache=new Map(),maxCalls=36}){
  const c=journeySettings(input),origin=discovery.origin,start=minute(c.start),deadline=minute(c.deadline);
  const places=Object.fromEntries([origin,...Object.values(discovery.pools).flat()].map(p=>[p.id,p]));
  const existingMeeting=meeting||calendarMeeting(day);
  const committedMeeting=calendarMeeting(day);
  if(meeting&&committedMeeting&&(meeting.start!==committedMeeting.start||meeting.end!==committedMeeting.end))throw Error('Today already has a locked Daylight  meeting. Create additional meetings in  Google Calendar , then refresh and replan; the original meeting will not be overwritten.');
  const busy=[...day.busy,...(existingMeeting?[{start:instant(c.date,existingMeeting.start),end:instant(c.date,existingMeeting.end)}]:[])];
  const ownLocks=day.own.filter(e=>e.locked&&e.kind!=='meeting').map(e=>({kind:e.kind,placeId:e.placeId,start:at(e.start),duration:(Date.parse(e.end)-Date.parse(e.start))/60000}));
  const checkedLocks=Object.values(checks).filter(v=>v.date===c.date&&v.timeStatus!=='unverified').map(v=>({kind:v.kind,placeId:v.placeId,start:v.start,duration:v.duration}));
  for(const v of Object.values(checks)){const l=ownLocks.find(l=>l.kind===v.kind);if(l&&(l.placeId!==v.placeId||(v.timeStatus!=='unverified'&&(l.start!==v.start||l.duration!==v.duration))))throw Error('Verification conflicts with a locked calendar activity. Resolve it in  Google Calendar  first.');}
  locks=[...checkedLocks,...locks.filter(l=>!checkedLocks.some(v=>v.kind===l.kind))];
  const effectiveLocks=[...ownLocks,...locks.filter(l=>!ownLocks.some(o=>o.kind===l.kind))];
  for(const l of effectiveLocks)if(!c.activities.includes(l.kind))throw Error('Existing locked activity cannot be omitted; please keep the activity and reschedule.');
  const fixedProblems=fixedConflicts(c,effectiveLocks,busy);
  const groups=c.activities.map(kind=>{
    const lock=effectiveLocks.find(l=>l.kind===kind),verified=checks[kind]?.date===c.date?checks[kind]:null;
    const venueEvidence=sourceChecks[kind]||verified;
    const ranked=discovery.pools[kind].filter(p=>(matchesRequiredName(p,c.activityDefinitions[kind])||(c.activityDefinitions[kind].eventRef&&venueEvidence?.date===c.date&&venueEvidence?.reportedBy==='source'&&venueEvidence?.venueMatch?.placeId===p.id))&&(!lock||p.id===lock.placeId)&&(!verified||p.id===verified.placeId)).map(place=>({kind,place,windows:activityWindows(place,c.date,c.activityDefinitions[kind]),lock})).filter(a=>a.windows===null||a.windows.some(([lo,hi])=>Math.max(lo,start)+(a.lock?.duration??c.durations[kind])<=Math.min(hi,deadline)));
    // Empty locked groups become concrete diagnostics; never move the lock.
    return ranked.sort((a,b)=>(km(origin.location,a.place.location)*2-(a.place.rating||0))-(km(origin.location,b.place.location)*2-(b.place.rating||0))).slice(0,3);
  });
  const candidates=fixedProblems.length?[]:(c.activities.length>4?boundedOrders(groups,c.precedence,origin,start,deadline,c.durations):product(groups).flatMap(g=>permutations(g)).filter(order=>c.precedence.every(e=>order.findIndex(a=>a.kind===e.before)<order.findIndex(a=>a.kind===e.after)))).filter(order=>optimisticallyFits(order,start,deadline,c.durations)).map(order=>{let prev=origin,distance=0;for(const a of order){distance+=km(prev.location,a.place.location);prev=a.place;}distance+=km(prev.location,origin.location);return {order,distance,rating:order.reduce((s,a)=>s+(a.place.rating||0),0)};});
  const diagnostics=[...fixedProblems,...(discovery.diagnostics||[])],failures=new Set();
  const observations=new Map();
  const fail=(code,a,detail,message)=>{failures.add(code);const key=JSON.stringify([code,a.kind,a.place.id,detail]);if(observations.size<12&&!observations.has(key))observations.set(key,{code,activity:a.kind,venue:a.place.name,...detail,message});};
  if(!fixedProblems.length&&!candidates.length&&groups.every(g=>g.length))diagnostics.push({code:'time',message:`Activities and transport cannot be completed within ${c.start}–${c.deadline} ; even without transport, current candidates cannot satisfy stay duration, activity time window, or fixed sessions.`});
  for(let i=0;i<groups.length;i++)if(!groups[i].length&&!diagnostics.some(d=>d.activity===c.activities[i])){
    const id=c.activities[i],lock=effectiveLocks.find(l=>l.kind===id),venues=(discovery.pools[id]||[]).map(p=>({name:p.name,windows:activityWindows(p,c.date,c.activityDefinitions[id])?.map(w=>w.map(clock))??null}));
    diagnostics.push({code:'opening_window',activity:id,duration:lock?.duration??c.durations[id],locked:!!lock,venues,message:`「${c.activityDefinitions[id].label} requires  ${lock?.duration??c.durations[id]} minutes, but this round’s candidates cannot simultaneously satisfy ${c.start}–${c.deadline}, location requirements, and activity window.`+(venues.length?' Checked windows:'+venues.map(v=>v.name+' '+(v.windows===null?'Business info unknown':v.windows.map(w=>w.join('–')).join('、')||'No available window')).join('；')+'。':' No matching location found.')});
  }
  const cache=routeCache;let calls=0,attempts=0;
  const travel=async(a,b,t)=>{if(a===b)return {minutes:0,walking:0,meters:0,lines:[],fare:{currencyCode:'SEK',units:'0'}};const key=[c.date,c.transport,a,b,t].join(':');if(!cache.has(key)){if(calls>=maxCalls)return null;calls++;cache.set(key,await route(a,b,instant(c.date,t),c.transport));}return cache.get(key);};
  const schedule=async(candidate,buffer)=>{
    let now=start,from=origin.id;const legs=[],stops=[],gaps=[];
    for(const a of [...candidate.order,{kind:'return',place:origin}]){
      let settled=false;
      for(let retry=0;retry<=busy.length+2;retry++){
        if(now>=deadline){failures.add('time');return null;}
        const r=await travel(from,a.place.id,now);if(!r)return null;
        const arrival=now+r.minutes;let begin=arrival,finish=arrival;
        if(a.kind!=='return'){
          const duration=a.lock?.duration??c.durations[a.kind];begin=a.lock?.start??arrival+buffer;
          if(a.windows!==null){const w=a.windows.find(([lo,hi])=>Math.max(begin,lo)+duration<=hi);if(!w){const def=c.activityDefinitions[a.kind],requested=def.windowStart||def.windowEnd;fail(requested?'time_window':'hours',a,{arrival:clock(arrival),duration,windows:a.windows.map(w=>w.map(clock))},requested?`「${def.label}」 at ${a.place.name}: the requested time is ${def.windowStart||'00:00'}–${def.windowEnd||'24:00'}, but with the day starting at ${c.start} the earliest arrival is ${clock(arrival)} and the stay needs ${duration} minutes. This is a timing conflict, not a closed venue: leaving earlier or a shorter stay would fit.`:`「${def.label} candidate  ${a.place.name}: arrival  ${clock(arrival)} after arrival needs ${duration} minutes, available window is ${a.windows.map(w=>w.map(clock).join('–')).join('、')||'none'}。`);return null;}begin=Math.max(begin,w[0]);}
          finish=begin+duration;if(begin<arrival+buffer||(a.lock&&begin!==a.lock.start)){fail('time',a,{arrival:clock(arrival),fixedStart:clock(a.lock?.start??begin)},`arriving at «${c.activityDefinitions[a.kind].label} candidate  ${a.place.name} ’s time is ${clock(arrival)}, cannot catch up with ${clock(a.lock?.start??begin)} ’s schedule (including ${buffer} minute buffer)`);return null;}
        }
        if(finish>deadline){fail('time',a,{finish:clock(finish),deadline:c.deadline},`${a.kind==='return'?'return to departure point':'complete «'+c.activityDefinitions[a.kind].label+'」'}expected to arrive at ${clock(finish)}, exceeding ${c.deadline} ’s return requirement.`);return null;}
        const conflict=busy.filter(b=>intersects({start:instant(c.date,now),end:instant(c.date,arrival)},b)||intersects({start:instant(c.date,begin),end:instant(c.date,finish)},b)).sort((a,b)=>Date.parse(a.end)-Date.parse(b.end))[0];
        if(conflict){fail('calendar',a,{busyStart:calendarTime(conflict.start,c.date),busyEnd:calendarTime(conflict.end,c.date),travelStart:clock(now),travelEnd:clock(arrival)},`${a.kind==='return'?'return trip':'go to or participate in «'+c.activityDefinitions[a.kind].label+'」'}with existing calendar arrangements ${calendarTime(conflict.start,c.date)}–${calendarTime(conflict.end,c.date)} conflict; this schedule did not pass this period, still needs adjustment and re‑checking.`);if(a.lock&&intersects({start:instant(c.date,begin),end:instant(c.date,finish)},conflict))return null;if(Date.parse(conflict.end)>=Date.parse(instant(c.date,1440)))return null;now=Math.max(now+1,at(conflict.end));continue;}
        const previousEnd=stops.at(-1)?.end??start;
        if(now>previousEnd)gaps.push({start:previousEnd,end:now,reason:'calendar',minutes:now-previousEnd});
        if(begin>arrival+buffer)gaps.push({start:arrival,end:begin,reason:'opening',minutes:begin-arrival});
        legs.push({from,to:a.place.id,depart:now,arrive:arrival,...r});
        if(a.kind!=='return'){const verification=checkFor(checks,a.kind,a.place.id,c.date);stops.push({kind:a.kind,label:c.activityDefinitions[a.kind].label,placeId:a.place.id,start:begin,end:finish,price:verification?.price??c.allowances[a.kind],priceVerified:verification?.price!=null,locked:!!a.lock,tentative:verification?.timeStatus!=='booked',verification,windowKnown:a.windows!==null});}
        now=finish;from=a.place.id;settled=true;break;
      }
      if(!settled)return null;
    }
    const activitiesCost=stops.reduce((n,s)=>n+s.price,0),knownFare=legs.every(l=>l.fare?.currencyCode==='SEK');
    const transportCost=c.transport==='walk'?0:knownFare?legs.reduce((n,l)=>n+Number(l.fare.units||0)+Number(l.fare.nanos||0)/1e9,0):null;
    const reservedTotal=activitiesCost+(transportCost??c.transitReserve);
    if(c.budgetMode==='limited'&&reservedTotal>c.budget){fail('budget',{kind:'trip',place:origin},{reservedTotal,limit:c.budget},`this candidate reservation ${reservedTotal} SEK, exceeding the budget ${c.budget} SEK; the unverified amount remains an estimate.`);return null;}
    if(c.maxWalking!==null&&legs.reduce((n,l)=>n+l.walking,0)>c.maxWalking){const walking=legs.reduce((n,l)=>n+l.walking,0);fail('walking',{kind:'trip',place:origin},{walking,limit:c.maxWalking},`this candidate’s total walking ${walking} minutes, exceeding ${c.maxWalking} minute limit.`);return null;}
    const continuityUnverified=(day.retained||[]).some(e=>intersects({start:instant(c.date,start),end:instant(c.date,now)},e));
    const availabilityPending=stops.filter(s=>c.activityDefinitions[s.kind].availability==='session'&&!['checked','booked'].includes(s.verification?.timeStatus)).map(s=>({id:s.kind,label:s.label}));
    return {stops,legs,gaps,availabilityPending,continuityUnverified,homeAt:now,activitiesCost,transportCost,reservedTotal,budgetVerified:stops.every(s=>s.priceVerified)&&transportCost!==null,total:stops.every(s=>s.priceVerified)&&transportCost!==null?reservedTotal:null,walking:legs.reduce((n,l)=>n+l.walking,0),travel:legs.reduce((n,l)=>n+l.minutes,0),buffer};
  };
  const specs=[{name:c.lowWalking?'walk a bit less':'compact route',buffer:5,why:'first filter by location distance, minimize detours, then check actual traffic segment by segment.',score:x=>x.distance},{name:'reputation priority',buffer:5,why:'among time‑ and traffic‑feasible candidates, prefer places with higher ratings.',score:x=>x.distance*.25-x.rating},{name:'take it easy',buffer:15,why:'reserve for each store visit 15 minute buffer to reduce rushing pressure.',score:x=>x.distance}];
  const plans=[],seen=new Set();
  for(const spec of specs){
    let preferred=null;
    for(const cand of [...candidates].sort((a,b)=>spec.score(a)-spec.score(b)).slice(0,c.lowWalking?3:8)){
      // Cached departures remain usable after the external query budget is spent.
      // schedule stops at the first uncached leg; candidate attempts stay bounded.
      attempts++;
      const plan=await schedule(cand,spec.buffer);if(!plan)continue;
      const signature=JSON.stringify(plan.stops.map(s=>[s.placeId,s.start,s.end]));if(seen.has(signature))continue;if(c.lowWalking){if(!preferred||plan.walking<preferred.plan.walking)preferred={plan,signature};continue;}
      seen.add(signature);plans.push({...plan,id:String(plans.length),name:spec.name,why:spec.why});break;
    }
    if(preferred){seen.add(preferred.signature);plans.push({...preferred.plan,id:String(plans.length),name:spec.name,why:spec.why+' in this round prioritize candidates with less walked distance among already checked routes.'});}
  }
  if(!plans.length){
    const explanations={time:`Activities and transport cannot be completed within ${c.start}–${c.deadline}.`,hours:'the regular business hours of the candidate locations cannot accommodate these activities.',calendar:'existing calendar arrangements block the activity or transport periods.',budget:`cost reservation exceeds ${c.budget} SEK upper limit.`,walking:`total walking exceeds ${c.maxWalking} minute limit.`};
    diagnostics.push(...observations.values());
    for(const code of failures)if(!diagnostics.some(d=>d.code===code))diagnostics.push({code,message:explanations[code]});
    if(calls>=maxCalls)diagnostics.push({code:'search_limit',message:'this round’s route query has reached the limit; we cannot yet assert that no feasible solution exists.'});
  }
  const pendingSessions=plans.some(p=>p.availabilityPending.length);
  const reason=plans.length?`Found ${plans.length} ${pendingSessions?'route drafts':'candidate plans'} after checking routes and busy periods. ${pendingSessions?'the specific event sessions have not been verified; the venue being open does not guarantee the event will take place, so the calendar cannot be saved before verification.':''}${plans.some(p=>p.continuityUnverified)?'the connection between these candidates and previous calendar events has not been verified; thus these candidates cannot be saved for now.':''}`:(diagnostics.slice(0,3).map(d=>d.message).join(' ')||'No feasible solution was found in this round’s limited candidates; consider adjusting time windows or search scope.')+' Original calendar unchanged.';
  return {constraints:c,origin,originAlternatives:discovery.origins,plans,places,meeting:existingMeeting,routeCalls:calls,attempts,reason,diagnostics,repairOptions:plans.length?[]:repairOptions(diagnostics,c),searchStats:{candidateOrders:candidates.length,attempts,routeCalls:calls,routeBudget:maxCalls,exhausted:calls>=maxCalls,exhaustive:false},checkedAt:new Date().toISOString(),notes:[...(c.activities.length>4?['Multi‑activity journeys use limited candidate search, which does not guarantee global optimality; route query limits remain unchanged.']:[]),...definitionsNotes(c),'Amount distinguishes verified price from budget reserve; verified total cost is shown only when each activity price and transportation cost have evidence; future prices are not guaranteed to stay the same.','Checking sessions or availability is not a purchase or booking. Only user-reported successful bookings remove the tentative marker; Daylight does not make bookings on behalf of the user.','Google Regular business hours are for reference only and do not prove availability on a specific date; missing business hours are marked separately.','Meetings that can be attended online from the current location are treated as virtual meetings; in‑person meetings require allocating commute time.']};
}

export function planChanges(plan,day,meeting){
  const stops=[...plan.stops,...(meeting?[meeting]:[])];
  return stops.map(s=>{const old=day.own.find(e=>e.kind===s.kind);return {kind:s.kind,label:s.label,placeId:s.placeId,start:s.start,end:s.end,locked:s.locked,tentative:s.tentative,price:s.price,priceVerified:!!s.priceVerified,timeStatus:s.verification?.timeStatus||'unverified',title:s.verification?.title||'',before:old?{start:at(old.start),end:at(old.end),placeId:old.placeId}:null,operation:!old?'Create':at(old.start)===s.start&&at(old.end)===s.end&&old.placeId===s.placeId?'keep':'Adjust'};});
}

function definitionsNotes(c){return [
  ...(c.timeMode==='flexible'?[`Time tentatively set by assistant as ${c.start}–${c.deadline}, can be adjusted at any time.`]:[]),
  c.budgetMode==='unlimited'?'User explicitly sets no budget upper limit; still show cost reservation, which does not constitute payment authorization.':c.budgetMode==='flexible'?'User prefers to see suggestions first, currently no hard budget cap; please decide based on cost reservation.':'Total budget filtered by user’s upper limit; costs not yet fully verified.',
  'Planned duration and cost reservation are adjustable estimates, not actual quotes:'+c.activities.map(id=>c.activityDefinitions[id].label+' '+c.durations[id]+' minutes / '+c.allowances[id]+' SEK').join('；'),
  ...(c.precedence.length?['Preserve order:'+c.precedence.map(e=>c.activityDefinitions[e.before].label+' → '+c.activityDefinitions[e.after].label).join('；')]:[]),
  ...(c.lowWalking&&c.maxWalking===null?['Low‑walking soft preference, compared in this round’s limited candidates; user did not specify a hard cumulative walking limit.']:[])
];}
export function scopeJourneyDay(day,activities){
  const retained=day.own.filter(e=>e.kind!=='meeting'&&!activities.includes(e.kind));
  return {...day,own:day.own.filter(e=>!retained.includes(e)),busy:[...day.busy,...retained.map(({start,end})=>({start,end}))],retained};
}


function activityWindows(place,date,activity){
  const windows=activity.hours==='not_needed'?null:openingWindows(place,date);
  if(!activity.windowStart&&!activity.windowEnd)return windows;
  const start=activity.windowStart?minute(activity.windowStart):0,end=activity.windowEnd?minute(activity.windowEnd):1440;
  return (windows||[[0,1440]]).map(([a,b])=>[Math.max(a,start),Math.min(b,end)]).filter(([a,b])=>a<b);
}
// Bound candidate construction itself, not just paid route calls (six stops can
// otherwise create hundreds of thousands of permutations).
function boundedOrders(groups,precedence,origin,start,deadline,durations){
  let beam=[{order:[],distance:0,rating:0,last:origin}];
  for(let depth=0;depth<groups.length;depth++){
    const expanded=[];
    for(const item of beam)for(const group of groups)for(const next of group){
      if(item.order.some(a=>a.kind===next.kind)||precedence.some(e=>e.after===next.kind&&!item.order.some(a=>a.kind===e.before)))continue;
      if(!optimisticallyFits([...item.order,next],start,deadline,durations))continue;
      expanded.push({order:[...item.order,next],distance:item.distance+km(item.last.location,next.place.location),rating:item.rating+(next.place.rating||0),last:next.place});
    }
    const near=[...expanded].sort((a,b)=>a.distance-b.distance).slice(0,64),rated=expanded.sort((a,b)=>(a.distance*.25-a.rating)-(b.distance*.25-b.rating)).slice(0,64);
    beam=[...new Map([...near,...rated].map(v=>[v.order.map(a=>a.kind+':'+a.place.id).join('|'),v])).values()];
  }
  return beam.map(v=>v.order);
}


// Safe lower bound: reject only sequences impossible even with zero travel.
function optimisticallyFits(order,start,deadline,durations){
  let now=start;
  for(const a of order){
    const duration=a.lock?.duration??durations[a.kind];let begin=a.lock?.start??now;
    if(begin<now)return false;
    if(a.windows!==null){const w=a.windows.find(([lo,hi])=>Math.max(lo,begin)+duration<=hi);if(!w)return false;begin=Math.max(begin,w[0]);}
    if(a.lock&&begin!==a.lock.start)return false;
    now=begin+duration;if(now>deadline)return false;
  }
  return true;
}
