export const ZONE = 'Europe/Stockholm';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
export function localParts(ms) { return Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value])); }
export function dateInStockholm(ms=Date.now()) { const p=localParts(ms); return `${p.year}-${p.month}-${p.day}`; }
export function validDate(date) {
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date) throw new Error('Invalid date.');
  return date;
}
export function nextDate(date) { validDate(date); return new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10); }
export function minute(value) { if(typeof value!=='string'||!/^\d{2}:\d{2}$/.test(value))throw new Error('Time should be HH:MM。'); const [h,m]=value.split(':').map(Number);if(h>24||m>59||(h===24&&m!==0))throw new Error('Invalid time.');return h*60+m; }
export function clock(min) { return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }
export function instant(date, min) {
  validDate(date); if(!Number.isInteger(min)||min<0||min>1440)throw new Error('Time exceeds daily range.');
  if(min===1440)return instant(nextDate(date),0);
  const naive=Date.parse(`${date}T${clock(min)}:00Z`), offsets=new Set();
  for(const h of [-36,0,36]) {const ms=naive+h*3600000,p=localParts(ms);offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)-ms);}
  const matches=[...offsets].map(o=>naive-o).filter(ms=>{const p=localParts(ms);return `${p.year}-${p.month}-${p.day}`===date&&Number(p.hour)*60+Number(p.minute)===min;});
  if(matches.length!==1)throw new Error('The local time falls within a daylight saving jump or repeated period; please select another time.');
  return new Date(matches[0]).toISOString();
}
export function dayBounds(date) { return {timeMin:instant(date,0),timeMax:instant(nextDate(date),0)}; }
export function intersects(a,b) { return Date.parse(a.start)<Date.parse(b.end)&&Date.parse(b.start)<Date.parse(a.end); }
