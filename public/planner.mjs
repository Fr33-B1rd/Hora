// All venues, prices, routes and availability are authored demo fixtures.
export const HOME = { id: 'home', name: 'Home', x: 70, y: 265 };
export const PLACES = [
  { id: 'hair-garden', type: 'hair', name: 'Green Island Hair Studio', area: 'Wutong Street Area', price: 68, duration: 45, rating: 4.8, x: 142, y: 130, open: 660, close: 1200, note: 'Quiet little shop · Appointment pending confirmation' },
  { id: 'hair-corner', type: 'hair', name: 'Corner Barber Shop', area: 'Xinli Street Area', price: 38, duration: 35, rating: 4.6, x: 305, y: 290, open: 720, close: 1200, note: 'Simple quick cut · Appointment pending confirmation' },
  { id: 'ramen-forest', type: 'ramen', name: 'Forest Ramen', area: 'Wutong Street Area', price: 48, duration: 45, rating: 4.9, x: 190, y: 209, open: 690, close: 1230, note: 'Signature Tonkotsu Ramen · Price is example' },
  { id: 'ramen-lane', type: 'ramen', name: 'Alley Noodle House', area: 'Xinli Street Area', price: 32, duration: 40, rating: 4.5, x: 355, y: 185, open: 690, close: 1230, note: 'A bowl of hot soup · Price is example' },
  { id: 'cinema-river', type: 'movie', name: 'Riverside Light and Shadow Cinema', area: 'Riverside Street Area', price: 62, duration: 115, slot: 970, rating: 4.8, x: 337, y: 92, open: 600, close: 1380, note: 'Finding the Light· 16:10 show · Fictional film' },
  { id: 'cinema-city', type: 'movie', name: 'City Screening Hall', area: 'Xinli Street Area', price: 49, duration: 110, slot: 1020, rating: 4.6, x: 407, y: 296, open: 600, close: 1380, note: 'Finding the Light· 17:00 show · Fictional film' }
];
export const TYPES = { hair: 'Get a haircut', ramen: 'Eat a bowl of ramen', movie: 'Watch a movie' };
export const DEFAULT = { budget: 200, start: 780, deadline: 1200, transport: 'transit', activities: ['hair', 'ramen', 'movie'] };
export const time = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export const overlap = (a, b) => a.start < b.end && b.start < a.end;
export function normalizeConstraints(raw = {}) {
  const c = { ...DEFAULT, ...raw };
  for (const k of ['budget', 'start', 'deadline']) if (!Number.isFinite(c[k])) throw new Error('Budget and time must be valid numbers.');
  if (c.budget < 0 || c.budget > 10000 || c.start < 360 || c.deadline > 1440 || c.start >= c.deadline || !Number.isInteger(c.start) || !Number.isInteger(c.deadline)) throw new Error('Please check budget and departure and return times.');
  if (!['transit', 'walk'].includes(c.transport)) throw new Error('Demo supports public transit or walking.');
  if (!Array.isArray(c.activities) || !c.activities.length || c.activities.some(a => !TYPES[a]) || new Set(c.activities).size !== c.activities.length) throw new Error('Please select at least one of haircut, ramen, or movie.');
  return c;
}
export function travel(a, b, transport = 'transit') {
  const km = Math.hypot(a.x - b.x, a.y - b.y) * .008;
  const walk = transport === 'walk' || km < .75;
  return { minutes: Math.max(3, Math.ceil(walk ? km * 13.5 : 9 + km * 3.6)), walking: Math.max(3, Math.ceil(walk ? km * 13.5 : 4)), cost: walk ? 0 : 3, mode: walk ? 'Walking' : 'Public Transit', distance: +km.toFixed(1), from: a.id, to: b.id };
}
function afterBlocks(start, duration, blocks) {
  for (const b of [...blocks].sort((a,b) => a.start-b.start)) if (overlap({start, end:start+duration}, b)) start = b.end;
  return start;
}
function permutations(a) { return a.length < 2 ? [a] : a.flatMap((x, i) => permutations(a.filter((_, j) => j !== i)).map(r => [x, ...r])); }
function combinations(groups) { return groups.reduce((a,g) => a.flatMap(x => g.map(v => [...x,v])), [[]]); }
export function schedule(venues, constraints, meetings = []) {
  let current = HOME, cursor = constraints.start, cost = 0, walking = 0, traveling = 0;
  const stops = [], legs = [];
  for (const venue of venues) {
    const leg = travel(current, venue, constraints.transport);
    leg.start = afterBlocks(cursor, leg.minutes, meetings);
    leg.end = leg.start + leg.minutes;
    let start = Math.max(leg.end + 5, venue.open);
    if (venue.slot !== undefined) {
      if (start > venue.slot) return null;
      start = venue.slot;
      if (meetings.some(b => overlap({start, end:start+venue.duration}, b))) return null;
    } else start = afterBlocks(start, venue.duration, meetings);
    const end = start + venue.duration;
    if (end > venue.close) return null;
    stops.push({ ...venue, start, end, arrival: leg.end, wait: start-leg.end });
    legs.push(leg);
    cost += venue.price + leg.cost; walking += leg.walking; traveling += leg.minutes;
    cursor = end; current = venue;
  }
  const last = travel(current, HOME, constraints.transport);
  last.start = afterBlocks(cursor, last.minutes, meetings); last.end = last.start+last.minutes;
  legs.push(last); cost += last.cost; walking += last.walking; traveling += last.minutes;
  if (last.end > constraints.deadline || cost > constraints.budget) return null;
  return { stops, legs, cost, walking, traveling, homeAt: last.end, signature: stops.map(s=>s.id).join(','), buffer: constraints.deadline-last.end };
}
export function planDay(raw = DEFAULT, meetings = [], locks = []) {
  const constraints = normalizeConstraints(raw);
  if (!Array.isArray(meetings) || meetings.some(m => !Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start < 0 || m.end > 1440 || m.start >= m.end)) throw new Error('Meeting time invalid.');
  for (const lock of locks) {
    const place=PLACES.find(p=>p.id===lock.id);
    const meeting=place&&meetings.find(m=>overlap(m,{start:lock.start,end:lock.start+place.duration}));
    if(meeting)return {plans:[],checked:0,feasible:0,reasonType:'locked-conflict',reason:`${time(meeting.start)}–${time(meeting.end)} The meeting conflicts with the locked-in ${place.name} ${time(lock.start)}–${time(lock.start+place.duration)} direct conflict. Adjusting budget or other activities cannot resolve it; you need to move the meeting or actively unlock the movie yourself.`};
  }
  if (locks.some(lock => !constraints.activities.includes(PLACES.find(p=>p.id===lock.id)?.type))) return { plans: [], checked: 0, reason: 'Locked-in activities must remain. Please unlock them in the calendar before removing the activity.' };
  const groups = constraints.activities.map(type => {
    const lock = locks.find(l => PLACES.find(p=>p.id===l.id)?.type === type);
    return PLACES.filter(p => p.type === type && (!lock || (p.id === lock.id && p.slot === lock.start)));
  });
  const candidates = combinations(groups).flatMap(venues => permutations(venues));
  const valid = candidates.map(v=>schedule(v,constraints,meetings)).filter(Boolean);
  const variants = [
    { id:'relaxed', name:'Take it easy', en:'TAKE IT EASY', icon:'leaf', description:'Walk less, give yourself some leeway', score:p=>p.walking*5+p.traveling+p.cost*.03+Math.max(0,45-p.buffer)*5+p.stops.reduce((n,s)=>n+s.wait,0)*.04 },
    { id:'fast', name:'Efficient travel', en:'MAKE TIME', icon:'bolt', description:'Shorten the journey, get home earlier', score:p=>p.homeAt+p.traveling*.8+p.stops.reduce((n,s)=>n+s.duration,0)*.1 },
    { id:'budget', name:'Budget wisely', en:'SPEND LESS', icon:'wallet', description:'Save the budget for what you truly enjoy', score:p=>p.cost*20+p.walking }
  ];
  const used = new Set();
  const plans = variants.map(v=>{
    const sorted=[...valid].sort((a,b)=>v.score(a)-v.score(b));
    const candidate=sorted.find(p=>!used.has(p.signature)) || sorted[0];
    if(!candidate)return null;
    used.add(candidate.signature);
    const {score,...meta}=v;
    return {...candidate,...meta};
  }).filter(Boolean);
  return { plans, checked:candidates.length, feasible:valid.length, reason: plans.length ? '' : 'Given current budget, meetings, and return‑home time, not all activities can be completed. You can increase the budget, delay returning home, or drop one activity; locked movies will not be altered automatically.' };
}
export function conflicts(plan, meetings) { return meetings.filter(m=>[...plan.stops,...plan.legs].some(s=>overlap(s,m))); }
export function validatePlan(plan, raw, meetings = [], locks = []) {
  const c = normalizeConstraints(raw);
  const venues=plan.stops.map(s=>PLACES.find(p=>p.id===s.id));
  if(venues.some(v=>!v) || new Set(venues.map(v=>v.type)).size!==c.activities.length || !c.activities.every(t=>venues.some(v=>v.type===t))) return false;
  const rebuilt=schedule(venues,c,meetings);
  return !!rebuilt && rebuilt.cost===plan.cost && rebuilt.homeAt===plan.homeAt && rebuilt.stops.every((s,i)=>s.start===plan.stops[i].start && s.end===plan.stops[i].end) && locks.every(l=>rebuilt.stops.some(s=>s.id===l.id && s.start===l.start));
}
export function parseLocal(text, current = DEFAULT) {
  const c=normalizeConstraints(current),changed=[];
  if(/\b(book|purchase|pay|hotel|flight|taxi)\b|buy.{0,15}ticket/i.test(text))return {supported:false,message:'The offline demo only plans haircuts, ramen and films, with transit or walking. Booking and purchases are not available.'};
  if(/\b(cancel|instead|except|do not|don’t|don't|skip)\b/i.test(text))return {supported:false,message:'Please use the activity, budget and time controls for changes. The offline demo only recognizes a small set of activities and numeric constraints.'};
  const activities=[];if(/\bhair(?:cut)?\b/i.test(text))activities.push('hair');if(/\bramen\b/i.test(text))activities.push('ramen');if(/\b(cinema|movie|film)\b/i.test(text))activities.push('movie');
  if(activities.length){c.activities=activities;changed.push('activities');}
  const budget=text.match(/(?:budget(?: of)?|under|up to|[¥￥])\s*(\d{1,5})/i);if(budget){c.budget=+budget[1];changed.push('budget');}
  const minutes=(h,m,period)=>{h=Number(h);if(period?.toLowerCase()==='pm'&&h<12)h+=12;if(period?.toLowerCase()==='am'&&h===12)h=0;return h*60+Number(m||0);};
  const end=text.match(/(?:back|return|home)\s*(?:by|before|at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if(end){c.deadline=minutes(end[1],end[2],end[3]);changed.push('return time');}
  const start=text.match(/(?:leave|start|depart)\s*(?:at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if(start){c.start=minutes(start[1],start[2],start[3]);changed.push('departure');}
  if(/\b(?:walk only|walking only|only walk)\b/i.test(text)){c.transport='walk';changed.push('transport');}
  if(/\b(?:bus|metro|public transport|transit)\b/i.test(text)){c.transport='transit';changed.push('transport');}
  if(!changed.length)return {supported:false,message:'Try: haircut, ramen and a film, budget 160, back by 8 pm. You can also edit the controls below.'};
  return {supported:true,constraints:normalizeConstraints(c),message:'Updated '+changed.join(', ')+'. Plans will be checked against budget, time, meetings and locked sessions. Venues and routes use fictional demo data.'};
}
export function calendarEvents(plan, date) {
  return plan.stops.map(s=>({id:`daylight-${date}-${s.type}`,title:TYPES[s.type],location:s.name,start:s.start,end:s.end,venueId:s.id,date,source:'plan'}));
}
export function makeICS(events) {
  const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const stamp=(date,min)=>{const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d,0,min-480)).toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');};
  const fold=line=>{let out='',size=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(size+bytes>75){out+='\r\n ';size=1;}out+=char;size+=bytes;}return out;};
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Daylight//Local Demo//EN','CALSCALE:GREGORIAN',...events.flatMap(e=>['BEGIN:VEVENT',`UID:${e.id}@daylight.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z')}`,`DTSTART:${stamp(e.date,e.start)}`,`DTEND:${stamp(e.date,e.end)}`,`SUMMARY:${esc(e.title)}`,`LOCATION:${esc(e.location||'Local demonstration')}`,'DESCRIPTION:Daylight demo - fictional venues and estimated routes','END:VEVENT']),'END:VCALENDAR',''].map(fold).join('\r\n');
}
