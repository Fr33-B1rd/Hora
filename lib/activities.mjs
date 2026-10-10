import {minute} from './time.mjs';
export const kinds={hair:{label:'Haircut',query:'hair salon',type:'hair_salon',duration:45,allowance:350},ramen:{label:'Ramen',query:'ramen',type:'ramen_restaurant',duration:45,allowance:180},movie:{label:'Movie',query:'cinema',type:'movie_theater',duration:120,allowance:200}};
const safeId=id=>typeof id==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(id)&&!['return','meeting','constructor','prototype','__proto__'].includes(id);
export function activityDefinitions(activities,definitions={}){
  if(!Array.isArray(activities)||activities.length>6)throw Error('Plan  1–6  activities at a time; split longer lists into separate trips.');
  const seen=new Set();
  return activities.map(a=>{
    const id=typeof a==='string'?a:a?.id;
    if(!safeId(id)||seen.has(id))throw Error('Invalid or duplicate activity ID.');seen.add(id);
    const v=typeof a==='string'?(Object.hasOwn(definitions,id)?definitions[id]:kinds[id]):a;
    if(!v)throw Error('Activity  '+id+'  is missing a definition; provide  label  and  query。');
    if(typeof v.label!=='string'||!v.label.trim()||v.label.length>220)throw Error('Activity  '+id+'   label  must be  1–220  characters; current length:  '+(v.label?.length??0)+'. Shorten the display label; eventRef  retains source identity.');
    if(typeof v.query!=='string'||!v.query.trim()||v.query.length>160)throw Error('Activity  '+id+'   query  must be  1–160  characters; current length:  '+(v.query?.length??0)+'. Please use short venue name or location search term.');
    const duration=v.duration??60,allowance=v.allowance??200;
    if(!Number.isInteger(duration)||duration<10||duration>240||!Number.isFinite(allowance)||allowance<0||allowance>1000000)throw Error('Invalid activity duration or budget allowance.');
    const requiredNames=v.requiredNames??[];
    if(!Array.isArray(requiredNames)||requiredNames.length>5||requiredNames.some(n=>typeof n!=='string'||!n.trim()||n.length>100))throw Error('Invalid specified location name.');
    const windowStart=v.windowStart??null,windowEnd=v.windowEnd??null,eventRef=v.eventRef??null;
    const windowQuote=v.windowQuote??null;
    if(windowQuote!==null&&(typeof windowQuote!=='string'||windowQuote.length>300))throw Error('Invalid activity time period source.');
    for(const t of [windowStart,windowEnd])if(t!==null)minute(t);
    if(windowStart&&windowEnd&&minute(windowStart)>=minute(windowEnd))throw Error('Invalid activity time window.');
    if(eventRef!==null&&(typeof eventRef!=='string'||!/^event_[a-f0-9]{12}$/.test(eventRef)))throw Error('Invalid activity source ID: eventRef must be copied exactly from a ref in eventEvidence, or be null for an activity that is not a discovered event.');
    const availability=v.availability??'venue';
    if(!['venue','session'].includes(availability))throw Error('Invalid activity opening mode.');
    const hours=v.hours??'venue';
    if(!['venue','not_needed'].includes(hours))throw Error('Invalid activity opening-hours mode.');
    return {...(hours==='not_needed'?{hours}:{}),id,label:v.label.trim(),query:v.query.trim(),duration,allowance,requiredNames,availability,windowStart,windowEnd,windowQuote,eventRef,...(kinds[id]&&v.query===kinds[id].query?{type:kinds[id].type}:{})};
  });
}
export function precedenceRules(raw=[],ids){
  if(!Array.isArray(raw)||raw.length>12)throw Error('Too many activity order requirements.');
  const edges=raw.map(e=>{
    if(!e||!ids.includes(e.before)||!ids.includes(e.after)||e.before===e.after)throw Error('Invalid activity order reference.');
    return {before:e.before,after:e.after};
  });
  const remaining=new Set(ids);
  while(remaining.size){const next=[...remaining].find(id=>!edges.some(e=>e.after===id&&remaining.has(e.before)));if(!next)throw Error('Activity order conflicts; please specify which to do first.');remaining.delete(next);}
  return edges;
}
export function budgetState(raw,{conversation=false}={}){
  const mode=raw.budgetMode??(raw.budget!=null?'limited':conversation?'unknown':'limited');
  if(!['unknown','limited','unlimited','flexible'].includes(mode))throw Error('Invalid budget status.');
  const budget=mode==='limited'?(raw.budget??(conversation?null:1000)):null;
  if(mode==='limited'&&(!Number.isFinite(budget)||budget<0||budget>1000000))throw Error('Please provide a valid budget amount, or clearly state no limit.');
  return {budgetMode:mode,budget};
}
