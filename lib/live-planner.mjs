import { instant, minute, clock, intersects, validDate } from './time.mjs';
const types=['hair','ramen','movie'];
export function normalizeLive(input) {
  validDate(input.date);
  if(!['walk','transit'].includes(input.transport))throw new Error('Please choose walking or public transport.');
  const start=minute(input.start),deadline=minute(input.deadline);
  if(start>=deadline||start<360)throw new Error('Please leave after  06:00  and return on the same day.');
  if(typeof input.origin!=='string'||!input.origin)throw new Error('Please select a real departure point first.');
  if(!Number.isFinite(input.budget)||input.budget<0||input.budget>100000)throw new Error('Invalid budget.');
  if(!Array.isArray(input.activities)||!input.activities.length||input.activities.length>3)throw new Error('Please select 1–3 activities');
  const used=new Set();
  const activities=input.activities.map(a=>{
    if(!types.includes(a.kind)||used.has(a.kind)||typeof a.placeId!=='string'||!a.placeId)throw new Error('Invalid activity or location.');used.add(a.kind);
    const duration=Number(a.duration),price=Number(a.price),earliest=minute(a.earliest),latest=minute(a.latest);
    if(!Number.isInteger(duration)||duration<10||duration>240||a.price===''||a.price===null||!Number.isFinite(price)||price<0||earliest>=latest)throw new Error('Please fill in each activity’s duration, estimate, and available window.');
    const fixed=a.fixed?minute(a.fixed):null;
    if(a.kind==='movie'&&fixed===null)throw new Error('Movies require you to verify and enter a specific showtime; maps cannot provide showtimes.');
    if(!a.confirmedWindow)throw new Error('Please verify the activity time window; business hours do not equal reservable slots.');
    return {kind:a.kind,placeId:a.placeId,duration,price,earliest,latest,fixed,locked:!!a.locked};
  });
  return {date:input.date,origin:input.origin,start,deadline,budget:input.budget,transport:input.transport,activities};
}
function permutations(a){return a.length?a.flatMap((v,i)=>permutations(a.filter((_,j)=>i!==j)).map(p=>[v,...p])):[[]];}
export async function buildPlans(input,{route,busy=[],locks=[]}) {
  const c=normalizeLive(input),cache=new Map();let calls=0;
  for(const lock of locks){const a=c.activities.find(a=>a.kind===lock.kind);if(!a||a.placeId!==lock.placeId)throw new Error('Locked activity locations cannot be changed or omitted.');a.fixed=lock.start;a.duration=lock.duration;a.locked=true;}
  const getRoute=async(from,to,t)=>{
    if(from===to)return {minutes:0,walking:0,meters:0,fare:c.transport==='walk'?{currencyCode:'SEK',units:'0'}:null,lines:[]};
    const key=[from,to,t,c.transport].join('|');if(!cache.has(key)){if(++calls>36)throw new Error('Route query limit reached for this request; reduce activities and retry.');cache.set(key,await route(from,to,instant(c.date,t),c.transport));}return cache.get(key);
  };
  const blockAt=(s,e)=>busy.filter(b=>intersects({start:instant(c.date,s),end:instant(c.date,e)},b)).sort((a,b)=>Date.parse(a.end)-Date.parse(b.end))[0];
  const localMinute=iso=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));return minute(p);};
  const plans=[];
  for(const order of permutations(c.activities)) {
    let now=c.start,from=c.origin,valid=true;const legs=[],stops=[];
    for(const a of [...order,{kind:'return',placeId:c.origin}]) {
      let settled=false;
      for(let attempt=0;attempt<=busy.length+2;attempt++) {
        if(now>=c.deadline){valid=false;break;}
        const r=await getRoute(from,a.placeId,now),arrival=now+r.minutes;
        if(arrival>c.deadline){valid=false;break;}
        let start=a.kind==='return'?arrival:(a.fixed??Math.max(arrival+5,a.earliest));
        const end=a.kind==='return'?arrival:start+a.duration;
        if(start<arrival+(a.kind==='return'?0:5)||end>c.deadline||(a.kind!=='return'&&(start<a.earliest||end>a.latest))){valid=false;break;}
        const block=blockAt(now,arrival)||(a.kind==='return'?null:blockAt(start,end));
        if(block){
          if(a.fixed!==undefined&&a.fixed!==null&&blockAt(start,end)){valid=false;break;}
          // Meetings are treated as unavailable time; waiting happens at the current venue.
          const dayEnd=Date.parse(instant(c.date,1440));
          if(Date.parse(block.end)>=dayEnd){valid=false;break;}
          now=Math.max(now+1,localMinute(block.end));continue;
        }
        legs.push({from,to:a.placeId,depart:now,arrive:arrival,...r});
        if(a.kind!=='return')stops.push({...a,start,end});
        now=end;from=a.placeId;settled=true;break;
      }
      if(!settled||!valid){valid=false;break;}
    }
    if(!valid)continue;
    const activitiesCost=stops.reduce((s,a)=>s+a.price,0);
    const knownFare=c.transport==='walk'||legs.every(l=>l.fare?.currencyCode==='SEK');
    const transportCost=c.transport==='walk'?0:knownFare?legs.reduce((s,l)=>s+Number(l.fare.units||0)+Number(l.fare.nanos||0)/1e9,0):null;
    const total=transportCost===null?null:Math.round((activitiesCost+transportCost)*100)/100;
    if(activitiesCost>c.budget||(total!==null&&total>c.budget))continue;
    plans.push({stops,legs,homeAt:now,activitiesCost,transportCost,total,budgetVerified:total!==null,walking:legs.reduce((s,l)=>s+l.walking,0),travel:legs.reduce((s,l)=>s+l.minutes,0)});
  }
  const picked=[],labels=[['Easy option',p=>p.walking*5+p.travel],['Early return option',p=>p.homeAt],['Low‑cost option',p=>p.total??p.activitiesCost]];
  for(const [name,score] of labels){const p=plans.filter(p=>!picked.includes(p)).sort((a,b)=>score(a)-score(b))[0];if(p){p.name=name;p.id=String(picked.length);picked.push(p);}}
  return {constraints:c,plans:picked,feasible:plans.length,routeCalls:calls,checkedAt:new Date().toISOString(),reason:plans.length?'':'No feasible arrangement given current location, time window, meetings, and budget; original calendar unchanged.',notes:['Cost is your estimate; public‑transport fares may not be returned or may differ from travel‑card prices.','Time window verified by you; have not yet contacted merchants or bought movie tickets.','Busy periods in the calendar are treated as online meetings attendable from the current location; for in‑person meetings please reserve commute time.'],currency:'SEK',timeZone:'Europe/Stockholm'};
}
