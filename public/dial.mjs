// The day dial: the assistant's 24 hours drawn as a clock face. Midnight is at
// the bottom and noon at the top, so the sun climbs the left side in the morning
// and comes down the right. On it: today's real daylight over Stockholm, where
// the sun is now, and every time the assistant does something for the user
// unasked. The page's own light follows the same sun.

const LAT = 59.3293, LON = 18.0686, ZONE = 'Europe/Stockholm';
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const pad = n => String(n).padStart(2, '0');
export const clockOf = minutes => `${pad(Math.floor(((minutes % 1440) + 1440) % 1440 / 60))}:${pad(Math.round(((minutes % 1440) + 1440) % 1440) % 60)}`;

// Stockholm's wall clock for an instant: minutes since midnight, the date, and the offset from UTC.
export function stockholm(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = Math.round((localAsUtc - Math.floor(now.getTime() / 60000) * 60000) / 60000);
  const dayOfYear = Math.round((Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - Date.UTC(Number(parts.year), 0, 0)) / 86400000);
  return { minutes, offset, dayOfYear, weekday: parts.weekday, label: `${parts.weekday} ${Number(parts.day)} ${new Date(localAsUtc).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}` };
}

// Sunrise and sunset in Stockholm, as minutes of the local clock. The standard short formula:
// good to a few minutes, which is all a dial needs. Null when the sun does not rise or set.
export function sunTimes(dayOfYear, offsetMinutes) {
  const b = rad(360 / 365 * (dayOfYear - 81));
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const declination = rad(-23.44) * Math.cos(rad(360 / 365 * (dayOfYear + 10)));
  const cosHour = (Math.sin(rad(-0.833)) - Math.sin(rad(LAT)) * Math.sin(declination)) / (Math.cos(rad(LAT)) * Math.cos(declination));
  const noon = 720 - 4 * LON - equationOfTime + offsetMinutes;
  if (cosHour >= 1) return { rise: null, set: null, noon, polar: 'night' };
  if (cosHour <= -1) return { rise: null, set: null, noon, polar: 'day' };
  const half = 4 * deg(Math.acos(cosHour));
  return { rise: Math.round(noon - half), set: Math.round(noon + half), noon: Math.round(noon) };
}

// Which light the page should be in, and where the glow sits and what colour it is.
export function sky(minutes, sun) {
  if (sun.rise == null) return { phase: sun.polar === 'day' ? 'day' : 'night', theme: sun.polar === 'day' ? 'light' : 'dark', x: 50 };
  const x = Math.max(4, Math.min(96, (minutes - sun.rise) / (sun.set - sun.rise) * 100));
  const phase = minutes < sun.rise - 40 || minutes > sun.set + 40 ? 'night' : minutes < sun.rise + 50 ? 'dawn' : minutes > sun.set - 50 ? 'dusk' : 'day';
  return { phase, theme: minutes < sun.rise - 20 || minutes > sun.set + 20 ? 'dark' : 'light', x: phase === 'night' ? 50 : Math.round(x) };
}
export const greeting = minutes => minutes < 300 ? 'Still up?' : minutes < 720 ? 'Good morning.' : minutes < 1080 ? 'Good afternoon.' : 'Good evening.';

// Every time of day a scheduled job runs, from its cron expression (“30 7 * * *”, “15 */3 * * *”).
export function runTimes(expr) {
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr || ''), every = /^(\d{1,2}) \*\/(\d{1,2}) \* \* \*$/.exec(expr || '');
  if (daily) return [Number(daily[2]) * 60 + Number(daily[1])];
  if (every && Number(every[2]) > 0) return Array.from({ length: Math.ceil(24 / Number(every[2])) }, (_, i) => i * Number(every[2]) * 60 + Number(every[1])).filter(m => m < 1440);
  return [];
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, ...children) => { const node = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v); node.append(...children); return node; };
// A point on the face: midnight at the bottom, time running clockwise.
export const point = (minutes, radius, c = 200) => { const a = minutes / 1440 * 2 * Math.PI; return [c - radius * Math.sin(a), c + radius * Math.cos(a)]; };
function arc(from, to, radius) {
  const [x1, y1] = point(from, radius), [x2, y2] = point(to, radius);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${radius} ${radius} 0 ${to - from > 720 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// The full dial for the welcome screen. `jobs` are the assistant's scheduled jobs ({title, expr, paused}).
export function dial({ now = new Date(), jobs = [] } = {}) {
  const here = stockholm(now), sun = sunTimes(here.dayOfYear, here.offset), R = 150;
  const svg = el('svg', { viewBox: '0 0 400 400', class: 'dial', role: 'img', 'aria-label': `The assistant’s day. It is ${clockOf(here.minutes)} in Stockholm.` });
  const face = el('g', { class: 'dial-face' });
  for (let i = 0; i < 96; i++) {
    const m = i * 15, major = i % 12 === 0, hour = i % 4 === 0, [x1, y1] = point(m, R + 10), [x2, y2] = point(m, R + (major ? 26 : hour ? 18 : 14));
    face.append(el('line', { x1, y1, x2, y2, class: major ? 'tick major' : hour ? 'tick hour' : 'tick', style: `--i:${i}` }));
    if (major) { const [x, y] = point(m, R + 40); face.append(el('text', { x, y, class: 'dial-hour', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, pad(m / 60))); }
  }
  face.append(el('circle', { cx: 200, cy: 200, r: R, class: 'dial-night' }));
  if (sun.rise != null) face.append(el('path', { d: arc(sun.rise, sun.set, R), class: 'dial-day', pathLength: 100 }));
  else if (sun.polar === 'day') face.append(el('circle', { cx: 200, cy: 200, r: R, class: 'dial-day' }));
  // What the assistant does unasked: a mark at every run, on a ring just inside the day.
  const marks = el('g', { class: 'dial-jobs' });
  jobs.filter(job => !job.paused).forEach((job, n) => runTimes(job.expr).forEach(m => {
    const [x, y] = point(m, R - 20);
    // A diamond drawn as its own outline: a rotated square would be moved by the styles that animate it.
    const mark = el('path', { d: `M${x.toFixed(2)} ${(y - 6).toFixed(2)}l6 6l-6 6l-6-6z`, class: 'dial-job' + (m < here.minutes ? ' done' : ''), style: `--n:${n}` });
    mark.append(el('title', {}, `${job.title} · ${clockOf(m)}`));
    marks.append(mark);
  }));
  // The sun: drawn at midnight and turned to the present, so that on opening it sweeps through the day so far.
  const turn = here.minutes / 1440 * 360;
  const sunGroup = el('g', { class: 'dial-sun', style: `--turn:${turn}deg` },
    el('line', { x1: 200, y1: 200, x2: 200, y2: 200 + R, class: 'dial-hand' }),
    el('circle', { cx: 200, cy: 200 + R, r: 20, class: 'dial-halo' }),
    el('circle', { cx: 200, cy: 200 + R, r: 8, class: 'dial-disc' }));
  const centre = el('g', { class: 'dial-centre' },
    el('text', { x: 200, y: 190, class: 'dial-time', 'text-anchor': 'middle' }, clockOf(here.minutes)),
    el('text', { x: 200, y: 216, class: 'dial-date', 'text-anchor': 'middle' }, here.label.toUpperCase()),
    el('text', { x: 200, y: 236, class: 'dial-sunline', 'text-anchor': 'middle' }, sun.rise != null ? `↑ ${clockOf(sun.rise)}   ↓ ${clockOf(sun.set)}` : sun.polar === 'day' ? 'THE SUN DOES NOT SET TODAY' : 'THE SUN DOES NOT RISE TODAY'));
  svg.append(face, marks, sunGroup, centre);
  return svg;
}

// The same day as a strip under the page's heading: night, daylight, now, and the assistant's runs.
export function dayStrip({ now = new Date(), jobs = [] } = {}) {
  const here = stockholm(now), sun = sunTimes(here.dayOfYear, here.offset), pct = m => (m / 1440 * 100).toFixed(2) + '%';
  const strip = document.createElement('div'); strip.className = 'daystrip'; strip.setAttribute('aria-hidden', 'true');
  const add = (className, style, title) => { const node = document.createElement('i'); node.className = className; node.style.cssText = style; if (title) node.title = title; strip.append(node); return node; };
  if (sun.rise != null) add('light', `left:${pct(sun.rise)};width:${pct(sun.set - sun.rise)}`);
  jobs.filter(job => !job.paused).forEach(job => runTimes(job.expr).forEach(m => add('run' + (m < here.minutes ? ' done' : ''), `left:${pct(m)}`, `${job.title} · ${clockOf(m)}`)));
  add('now', `left:${pct(here.minutes)}`, clockOf(here.minutes));
  return strip;
}

// The small mark beside the name: the same face, reduced to a ring, the daylight arc and the sun.
export function mark({ now = new Date() } = {}) {
  const here = stockholm(now), sun = sunTimes(here.dayOfYear, here.offset), r = 9.5;
  const p = m => { const a = m / 1440 * 2 * Math.PI; return [12 - r * Math.sin(a), 12 + r * Math.cos(a)]; };
  const svg = el('svg', { viewBox: '0 0 24 24', class: 'mark', 'aria-hidden': 'true' }, el('circle', { cx: 12, cy: 12, r, class: 'mark-night' }));
  if (sun.rise != null) { const [x1, y1] = p(sun.rise), [x2, y2] = p(sun.set); svg.append(el('path', { d: `M${x1} ${y1}A${r} ${r} 0 ${sun.set - sun.rise > 720 ? 1 : 0} 1 ${x2} ${y2}`, class: 'mark-day' })); }
  svg.append(el('g', { class: 'mark-sun', style: `--turn:${here.minutes / 1440 * 360}deg` }, el('circle', { cx: 12, cy: 12 + r, r: 2.6 })), el('circle', { cx: 12, cy: 12, r: 1.4, class: 'mark-core' }));
  return svg;
}
