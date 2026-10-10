import { minute, validDate } from './time.mjs';

const clean=(value,max=300)=>{if(typeof value!=='string'||value.trim().length>max)throw Error('Verification explanation too long or invalid.');return value.trim();};
export function validateChecks(raw,plan,date,acknowledge){
  validDate(date);
  if(acknowledge!==true)throw Error('Please confirm verification information comes from your consulted sources; do not mark example values as real appointments.');
  if(!Array.isArray(raw)||raw.length!==plan.stops.length)throw Error('Please verify verification information for all activities.');
  const items={},seen=new Set();
  for(const row of raw){
    const stop=plan.stops.find(s=>s.kind===row.kind);
    if(!stop||seen.has(row.kind)||row.placeId!==stop.placeId)throw Error('Verification information does not match the currently selected activity location.');seen.add(row.kind);
    const timeStatus=row.timeStatus||'unverified';
    if(!['unverified','checked','booked'].includes(timeStatus))throw Error('Invalid verification status.');
    const price=row.price===''||row.price==null?null:Number(row.price);
    if(price!==null&&(!Number.isFinite(price)||price<0||price>10000))throw Error('Verified price must be 0–10000 SEK; unknown please leave blank.');
    const priceSource=clean(row.priceSource||''),timeSource=clean(row.timeSource||''),title=clean(row.title||'',120);
    if(price!==null&&!priceSource)throw Error('Please fill in price source, e.g., menu URL or price table you consulted.');
    let start=null,duration=null;
    if(timeStatus!=='unverified'){
      start=minute(row.start);duration=Number(row.duration);
      if(!Number.isInteger(duration)||duration<10||duration>240||start+duration>1440)throw Error('Please fill in a valid start time and 10–240 minute duration.');
      if(!timeSource||!title)throw Error('Verified time requires the film or service name and a source for the session or ／Appointment information source.');
    }
    if(price!==null||timeStatus!=='unverified')items[row.kind]={kind:row.kind,placeId:stop.placeId,date,title,price,priceSource:price!==null?priceSource:'',timeStatus,start,duration,timeSource:timeStatus!=='unverified'?timeSource:'',checkedAt:new Date().toISOString(),reportedBy:'user'};
  }
  return items;
}

export function checkFor(items,kind,placeId,date){const c=items?.[kind];return c?.placeId===placeId&&c.date===date?c:null;}
export function calendarEvidence(stop){
  const v=stop.verification;if(!v)return stop.tentative?'Provisional personal time block: price, availability, and sessions pending verification.Daylight No vendor booked or ticket purchased.':'Personal schedule;Daylight No vendor booked or ticket purchased.';
  return [`${v.title||'Personal activity'}（${v.reportedBy==='source'?'Event source':'User verification'}）`,v.timeStatus==='booked'?'User reported ticket purchased／Reservation successful.':v.timeStatus==='checked'?(v.reportedBy==='source'?'Event source lists sessions／Time slot; remaining tickets and reservation not verified.':'User has viewed sessions／Time slot; no ticket purchased or reservation made.'):'Time and availability not yet verified.',v.price!==null?`User verified price:${v.price} SEK。`:'Amount is budget reserve, price not verified.',`Verification record time:${v.checkedAt}`, 'Source records stored only locally. Daylight does not make reservations or purchase tickets on behalf.'].join('\n');
}
