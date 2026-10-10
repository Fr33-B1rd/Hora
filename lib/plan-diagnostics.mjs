import {clock,instant,intersects,localParts} from './time.mjs';
export const calendarTime=(s,date)=>{const p=localParts(Date.parse(s)),day=`${p.year}-${p.month}-${p.day}`;return (day===date?'':day+' ')+p.hour+':'+p.minute;};
export function fixedConflicts(c,locks,busy){
 const out=[];
 for(const l of locks){
  const label=c.activityDefinitions[l.kind].label,end=l.start+l.duration;
  if(l.start<Number(c.start.slice(0,2))*60+Number(c.start.slice(3))||end>Number(c.deadline.slice(0,2))*60+Number(c.deadline.slice(3)))out.push({code:'fixed_window',activity:l.kind,locked:true,start:clock(l.start),end:clock(end),message:`「${label}] fixed at ${clock(l.start)}–${clock(end)}, not in this ${c.start}–${c.deadline} within the travel window.`});
  for(const b of busy)if(intersects({start:instant(c.date,l.start),end:instant(c.date,end)},b))out.push({code:'fixed_calendar',activity:l.kind,locked:true,start:clock(l.start),end:clock(end),busyStart:calendarTime(b.start,c.date),busyEnd:calendarTime(b.end,c.date),message:`「${label}] fixed at ${clock(l.start)}–${clock(end)}, with existing calendar arrangements ${calendarTime(b.start,c.date)}–${calendarTime(b.end,c.date)} overlap; adjusting the order of other activities cannot eliminate this conflict.`});
 }
 for(let i=0;i<locks.length;i++)for(let j=i+1;j<locks.length;j++){const a=locks[i],b=locks[j];if(a.start<b.start+b.duration&&b.start<a.start+a.duration)out.push({code:'fixed_overlap',activities:[a.kind,b.kind],locked:true,message:`「${c.activityDefinitions[a.kind].label}] and [${c.activityDefinitions[b.kind].label}]’s fixed time slots overlap.`});}
 return out;
}
export function repairOptions(diagnostics,c){
 const options=[];const add=(id,action,requiresDecision,explanation)=>{if(!options.some(o=>o.id===id))options.push({id,action,requiresDecision,explanation});};
 for(const d of diagnostics){
  if(['fixed_calendar','fixed_overlap'].includes(d.code)){
   add('preserve-calendar','choose_other_date_or_session',true,'Keep the existing calendar, first discuss changing date, session or activity with you; availability of other dates has not been checked yet.');
   add('review-calendar','review_calendar',true,'Check whether conflicting time slots still need to be retained; without your explicit decision, do not move or ignore existing arrangements.');
  }else if(d.code==='fixed_window')add('window','adjust_window',c.timeMode!=='flexible',c.timeMode==='flexible'?'Keep fixed sessions, adjust the assistant’s tentative travel window, then recalculate.':'Fixed sessions exceed your given travel window; you need to decide whether to adjust the time.');
  else if(['hours','opening_window','identity'].includes(d.code))add('places','search_alternatives',false,'Keep activity requirements, compare candidate locations with more suitable business hours, then verify the route; specified locations cannot be arbitrarily replaced.');
  else if(d.code==='time_window')add('depart-earlier','adjust_window',c.timeMode!=='flexible','The stop cannot be reached and completed inside the time the user asked for. Start the day earlier or shorten the stay; venue opening hours are not the blocker.');
  else if(d.code==='time')add('timing','revise_estimates',false,'Check unconfirmed stay durations and sequence; only adjust the assistant’s estimates, retain user requirements and fixed sessions, then reorder.');
  else if(d.code==='calendar')add('free-window','use_free_intervals',c.timeMode!=='flexible','Keep calendar occupancy, compare consecutive free slots; discuss before changing user‑specified time slots.');
  else if(d.code==='walking')add('walking','compare_closer_places',false,'Keep the walking limit, look for more concentrated locations or places more convenient by public transport.');
  else if(d.code==='budget')add('cost','compare_costs',false,'Keep the budget cap, compare other candidates with price basis; cannot claim to meet the budget by arbitrarily lowering cost estimates.');
  else if(d.code==='search_limit')add('continue','targeted_search',false,'This is a limited query that found no results; continue searching in the next round targeting discovered bottlenecks, cannot conclude there is no solution based on this.');
 }
 return options;
}
