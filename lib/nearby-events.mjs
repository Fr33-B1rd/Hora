import {createHash} from 'node:crypto';
import {dateInStockholm} from './time.mjs';
import {validLocation} from './event-venue.mjs';
const source='https://www.visitstockholm.com/events/';
export const eventDescription=html=>String(html||'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:amp|quot|apos|#39|nbsp|lt|gt);/g,s=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&nbsp;':' ','&lt;':'<','&gt;':'>'}[s])).replace(/\s+/g,' ').trim().slice(0,3000);
export const eventRef=url=>'event_'+createHash('sha256').update(new URL(url).pathname.split('/').slice(0,3).join('/')).digest('hex').slice(0,12);
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.visitstockholm.com'&&u.pathname.startsWith('/events/')?u.href:null;}catch{return null;}};
export function parseEvents(html){
  const match=html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if(!match)throw Error('event source page format changed, temporarily unable to verify events.');
  const data=JSON.parse(match[1]).props?.pageProps?.componentProps;if(!Array.isArray(data?.contentBlocks))throw Error('event source returned incomplete content.');
  const found=new Map();
  for(const e of [...(data.events||[]),...data.contentBlocks.flatMap(b=>b.value?.items||[])]){
    const url=safeUrl(e.href);if(!url||!e.title||!/^\d{4}-\d\d-\d\d$/.test(e.startDate)||!/^\d{4}-\d\d-\d\d$/.test(e.endDate))continue;
    found.set(String(e.id),{ref:eventRef(url),scheduleStatus:'date_only',occurrences:[],title:String(e.title).slice(0,220),start:e.startDate,end:e.endDate,venue:String(e.venueName||e.address||'location pending verification').slice(0,250),url,categories:Array.isArray(e.categories)?e.categories:[],location:e.location});
  }
  return [...found.values()];
}
const km=(a,b)=>{const rad=Math.PI/180,x=(b.longitude-a.longitude)*rad*Math.cos((a.latitude+b.latitude)*rad/2),y=(b.latitude-a.latitude)*rad;return 6371*Math.hypot(x,y);};
export function selectEvents(events,origin,{today=dateInStockholm(),days=7,category='all',radius=3}={}){
  const end=new Date(Date.parse(today+'T12:00:00Z')+(days-1)*86400000).toISOString().slice(0,10);
  return events.filter(e=>e.start<=end&&e.end>=today&&e.start<=e.end).filter(e=>category==='all'||e.categories.some(c=>category==='music'?/music/i.test(c):/exhibition/i.test(c))).filter(e=>Number.isFinite(e.location?.latitude)&&Number.isFinite(e.location?.longitude)).map(e=>({...e,distance:km(origin,e.location)})).filter(e=>e.distance<=radius).sort((a,b)=>a.distance-b.distance||a.start.localeCompare(b.start)).slice(0,4).map(e=>({...e,distance:Math.round(e.distance*10)/10}));
}
export async function nearbyEvents(query,maps,{days=7,category='all',from=dateInStockholm(),fetchImpl=fetch}={}){
  const places=await maps.search(query,null);if(!places.length)throw Error('landmark not found; try a nearby station or specify a clear location.');
  const origin=places[0],r=await fetchImpl(source,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('temporarily unable to read Visit Stockholm activity source, please try again later.');
  const html=await r.text();if(html.length>2000000)throw Error('activity source response too large.');
  const candidates=selectEvents(parseEvents(html),origin.location,{today:from,days,category});
  const events=await Promise.all(candidates.map(async e=>{try{return {...e,...await eventDetails(e.url,{fetchImpl}),distance:e.distance};}catch{return {...e,scheduleStatus:'unavailable'};}}));
  const last=new Date(Date.parse(from+'T12:00:00Z')+(days-1)*86400000).toISOString().slice(0,10);
  for(const e of events){e.occurrences=(e.occurrences||[]).filter(o=>o.date>=from&&o.date<=last);e.distanceOrigin=origin.name;e.checkedAt=new Date().toISOString();}

  return {events:events.filter(e=>e.scheduleStatus!=='confirmed'||e.occurrences.length),origin:origin.name,days,from,to:last,source,checkedAt:new Date().toISOString(),message:`I checked  Visit Stockholm ’s selected activities, centered at  ${origin.name}  within approximately  3 km radius, for ${from===last?from:from+' to '+last}.${events.length?'Found the following events, dates and locations from the source page.':'No matches were found this time; this does not mean there are no other activities nearby.'}Distance is a straight‑line estimate, not walking distance; multi‑day events require checking specific sessions, ticket prices and remaining tickets on the source page, which have not been verified.`};
}


export function parseEventDetails(html,url){
  const m=html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const e=m&&JSON.parse(m[1]).props?.pageProps?.componentProps?.event;
  if(!e||!e.title||!safeUrl(e.href)||eventRef(e.href)!==eventRef(url))throw Error('Event details do not match the source.');
  const time=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v)?v.slice(0,5):null;
  const rows=Array.isArray(e.occurrences)?e.occurrences:[];
  const occurrences=rows.flatMap(o=>{
    const start=time(o.startTime),end=time(o.endTime);
    return /^\d{4}-\d\d-\d\d$/.test(o.date)&&start&&end&&start<end?[{date:o.date,start,end}]:[];
  });
  return {ref:eventRef(e.href),title:String(e.title).slice(0,220),description:eventDescription(e.description),venue:String(e.venueName||e.address||'location pending verification').slice(0,250),address:String(e.address||'').slice(0,250),location:validLocation(e.location)?e.location:null,url:safeUrl(e.href),start:e.startDate,end:e.endDate,occurrences,scheduleStatus:occurrences.length?'confirmed':'date_only',ticketStatus:'unknown',checkedAt:new Date().toISOString()};
}
export async function eventDetails(url,{fetchImpl=fetch}={}){
  if(!safeUrl(url))throw Error('Can only verify discovered Visit Stockholm Event source.');
  const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Event details temporarily unavailable.');
  const html=await r.text();if(html.length>2000000)throw Error('Event details too large.');
  return parseEventDetails(html,url);
}
