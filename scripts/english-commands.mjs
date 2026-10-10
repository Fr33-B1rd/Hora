import {readFileSync,writeFileSync} from 'node:fs';
const voice='public/voice-core.mjs';let s=readFileSync(voice,'utf8');
s=s.slice(0,s.indexOf('export function voiceCommand'))+`export function voiceCommand(text,plans=[]){
  const s=text.trim().replace(/[!?.,]/g,'').replace(/\\b(one|two|three|first|second|third)\\b/gi,w=>({one:'1',two:'2',three:'3',first:'1',second:'2',third:'3'}[w.toLowerCase()]));
  if(/^(?:please )?(?:read|explain) (?:the |my |current )?(?:plan|itinerary)$/i.test(s))return {type:'read'};
  if(/^(?:please )?(?:replan|refresh (?:the )?calendar and replan)$/i.test(s))return {type:'replan'};
  const n=s.match(/^(?:please )?(?:choose|select) (?:the )?(?:plan )?([123])(?: plan)?$/i);
  if(n)return plans[Number(n[1])-1]?{type:'select',id:plans[Number(n[1])-1].id}:{type:'unavailable'};
  const named=plans.find(p=>[p.name,'choose '+p.name,'select '+p.name].some(v=>s.toLowerCase()===v.toLowerCase()));if(named)return {type:'select',id:named.id};
  if(/\\b(?:confirm|book|purchase|invite)\\b|save.*calendar|buy.*tickets/i.test(s))return {type:'approval'};
  return {type:'intent'};
}
const time=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export function spokenPlan(result,plan){
  if(!plan)return 'There is no plan yet. Tell me where you want to start, what you want to do, and any budget or time preferences.';
  const labels={hair:'get a haircut',ramen:'eat ramen',movie:'watch a film'};
  const budget=result.constraints?.budgetMode==='unlimited'?'There is no budget ceiling. ':result.constraints?.budgetMode==='flexible'?'Spending is flexible; estimates are shown for comparison. ':'';
  const stops=plan.stops.map((s,i)=>'Stop '+(i+1)+', '+time(s.start)+' to '+time(s.end)+': '+(s.label||labels[s.kind]||'activity')+' at '+(result.places[s.placeId]?.name||'the selected venue')+(s.locked?'. This time is locked':'')+'. ').join('');
  return budget+'Selected: '+plan.name+'. '+stops+'Return to the starting point at '+time(plan.homeAt)+'. '+(plan.budgetVerified?'Verified total: ':'Estimated reserve: ')+plan.reservedTotal+' SEK. '+(plan.budgetVerified?'Prices may change. ':'This is not a merchant quote. ')+'Calendar changes require a preview and manual confirmation.';
}
`+s.slice(s.indexOf('// No action execution'));
writeFileSync(voice,s);
const planner='public/planner.mjs';s=readFileSync(planner,'utf8');
s=s.slice(0,s.indexOf('export function parseLocal'))+`export function parseLocal(text, current = DEFAULT) {
  const c=normalizeConstraints(current),changed=[];
  if(/\\b(book|purchase|pay|hotel|flight|taxi)\\b|buy.{0,15}ticket/i.test(text))return {supported:false,message:'The offline demo only plans haircuts, ramen and films, with transit or walking. Booking and purchases are not available.'};
  if(/\\b(cancel|instead|except|do not|don’t|don\u0027t|skip)\\b/i.test(text))return {supported:false,message:'Please use the activity, budget and time controls for changes. The offline demo only recognizes a small set of activities and numeric constraints.'};
  const activities=[];if(/\\bhair(?:cut)?\\b/i.test(text))activities.push('hair');if(/\\bramen\\b/i.test(text))activities.push('ramen');if(/\\b(cinema|movie|film)\\b/i.test(text))activities.push('movie');
  if(activities.length){c.activities=activities;changed.push('activities');}
  const budget=text.match(/(?:budget(?: of)?|under|up to|[¥￥])\\s*(\\d{1,5})/i);if(budget){c.budget=+budget[1];changed.push('budget');}
  const minutes=(h,m,period)=>{h=Number(h);if(period?.toLowerCase()==='pm'&&h<12)h+=12;if(period?.toLowerCase()==='am'&&h===12)h=0;return h*60+Number(m||0);};
  const end=text.match(/(?:back|return|home)\\s*(?:by|before|at)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?/i);
  if(end){c.deadline=minutes(end[1],end[2],end[3]);changed.push('return time');}
  const start=text.match(/(?:leave|start|depart)\\s*(?:at)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?/i);
  if(start){c.start=minutes(start[1],start[2],start[3]);changed.push('departure');}
  if(/\\b(?:walk only|walking only|only walk)\\b/i.test(text)){c.transport='walk';changed.push('transport');}
  if(/\\b(?:bus|metro|public transport|transit)\\b/i.test(text)){c.transport='transit';changed.push('transport');}
  if(!changed.length)return {supported:false,message:'Try: haircut, ramen and a film, budget 160, back by 8 pm. You can also edit the controls below.'};
  return {supported:true,constraints:normalizeConstraints(c),message:'Updated '+changed.join(', ')+'. Plans will be checked against budget, time, meetings and locked sessions. Venues and routes use fictional demo data.'};
}
`+s.slice(s.indexOf('export function calendarEvents'));
writeFileSync(planner,s);
console.log('English-only offline commands and spoken plan narration applied.');
