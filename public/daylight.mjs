// Daylight web app: a chat with the same assistant as the user's chat apps, and
// a page showing what that assistant remembers and does on a schedule.

import { mountJourneyMap } from './journey-map.mjs';
import { createPlayer, record } from './voice.mjs';
import { dial, dayStrip, mark, stockholm, sunTimes, sky, greeting } from './dial.mjs';
import { createAtmosphere } from './atmosphere.mjs';

const app = document.getElementById('app');
const store = {
  get(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep going without history */ } },
};
const newSession = () => 'tab' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

const state = {
  view: store.get('daylight-view', 'chat'),
  session: store.get('daylight-session', null) || newSession(),
  turns: store.get('daylight-turns', []),
  sending: false,
  working: '',
  profile: null,
  profileError: '',
  notes: {},
};
store.set('daylight-session', state.session);

// Small DOM helper: h('button', {class: 'x', onclick: fn}, 'text', child…)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
  return el;
}
const sun = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('stroke-width', '1.4');
  svg.innerHTML = '<circle class="core" cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/><g class="ring"><circle cx="12" cy="12" r="9.6" stroke-dasharray="2.2 3.4" opacity="0.55"/><circle cx="21.6" cy="12" r="1.7" fill="currentColor" stroke="none"/></g>';
  return svg;
};

// ---- talking to the server ----
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || 'Something went wrong. Please try again.');
  return body;
}

// What the assistant is doing right now, in the user's terms.
export function stepLabel(event) {
  const tool = String(event.tool || ''), label = String(event.label || '');
  if (tool === 'skill_view') {
    if (/discount/.test(label)) return 'Opening grocery offers';
    if (/research/.test(label)) return 'Opening the research tracker';
    if (/outing/.test(label)) return 'Opening the planner';
    return 'Looking up how to do this';
  }
  if (/grocery_offers/.test(tool)) return 'Reading Lidl’s offers';
  if (/food_preference/.test(tool)) return 'Updating your food preferences';
  if (/research_topics/.test(tool)) return 'Checking your research topics';
  if (/calendar_day/.test(tool)) return 'Reading your calendar';
  if (/calendar_propose/.test(tool)) return 'Checking your calendar for that time';
  if (/calendar_confirm/.test(tool)) return 'Adding it to your calendar';
  if (/job_matches/.test(tool)) return 'Looking through job postings';
  if (/job_search_profile/.test(tool)) return 'Updating your job search';
  if (/job_application_advice/.test(tool)) return 'Reading the posting against your CV';
  if (/plan_day/.test(tool)) return 'Checking places, opening hours and travel';
  if (/find_events/.test(tool)) return 'Looking up events';
  if (/local_news/.test(tool)) return 'Reading local news';
  if (tool === 'terminal' || tool === 'execute_code') {
    if (/daylight_deals/.test(label)) return 'Reading Lidl’s offers';
    if (/daylight_research/.test(label)) return 'Checking research topics';
    return 'Working through a step';
  }
  if (tool === 'memory') return 'Updating what I remember';
  if (/^web_/.test(tool)) return 'Searching the web';
  if (/cron/.test(tool)) return 'Updating the schedule';
  return 'Working';
}

// Reads the server-sent event stream: text chunks and tool-progress events.
async function streamReply(text, { onText, onStep }) {
  const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, session: state.session }) });
  if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'The assistant could not answer.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', event = 'message';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) { if (!line) event = 'message'; continue; }
      const data = line.slice(5).trim();
      if (data && data !== '[DONE]') {
        try {
          const payload = JSON.parse(data);
          if (event === 'hermes.tool.progress') { if (payload.status !== 'completed') onStep(stepLabel(payload), String(payload.tool || '')); }
          else if (payload.choices?.[0]?.delta?.content) onText(payload.choices[0].delta.content);
        } catch { /* a partial or non-JSON frame: skip it */ }
      }
      event = 'message';
    }
  }
}

// ---- chat ----
const ideas = [
  ['Jobs', 'Any jobs for me?'],
  ['Groceries', 'What’s on offer this week?'],
  ['Going out', 'Plan tomorrow: a museum and sushi, starting from Slussen'],
  ['Calendar', 'What do I have on tomorrow?'],
];

// Plain text with clickable links; nothing from the reply is treated as markup.
function richText(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0].replace(/[.,;:!?]+$/, '');
    parts.push(h('a', { href: url, target: '_blank', rel: 'noreferrer' }, url), match[0].slice(url.length));
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

let shownTurns = state.turns.length;   // turns already on screen: only later ones animate in
function turnElement(turn, index) {
  const el = h('div', { class: `turn ${turn.role}${turn.error ? ' error' : ''}${index >= shownTurns ? ' fresh' : ''}` }, richText(turn.text));
  if (turn.said) el.append(h('small', { class: 'said' }, 'Said aloud: ' + turn.said));
  if (turn.steps?.length) el.append(h('small', { class: 'steps' }, turn.steps.join(' · ') + (turn.seconds ? ` · ${turn.seconds} s` : '')));
  const journey = turn.planId && plans.get(turn.planId);
  return journey?.plans.length ? [el, planCard(turn, journey)] : el;
}

// ---- a checked plan: options, timeline, map, and adding it to the calendar ----
const PLAN_STEP = 'Checking places, opening hours and travel';
const plans = new Map();     // plan id -> the checked result from the planner
let mappedPlan = null;       // the one plan card that currently owns the map
const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const dayLabel = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

async function attachLatestPlan(turn, since) {
  try {
    const journey = await api('/api/plans/latest');
    if (Date.parse(journey.createdAt) < since - 5000) return;  // an older plan, not from this reply
    plans.set(journey.id, journey);
    turn.planId = journey.id; turn.choice = journey.plans[0]?.id ?? null;
  } catch { /* no plan to show; the reply still stands on its own */ }
}

function timeline(journey, plan) {
  const rows = [h('li', { class: 'move' }, h('time', {}, clock(plan.legs[0]?.depart ?? plan.stops[0].start)), h('span', {}, 'Leave ' + journey.origin.name))];
  plan.stops.forEach((stop, index) => {
    const leg = plan.legs[index], place = journey.places[stop.placeId];
    if (leg) rows.push(h('li', { class: 'leg' }, h('time', {}), h('span', {}, `${leg.minutes} min ${leg.mode === 'walk' ? 'walk' : 'by public transport'}`)));
    rows.push(h('li', { class: 'stop', 'data-map-stop': String(index), tabindex: '0' },
      h('time', {}, `${clock(stop.start)}–${clock(stop.end)}`),
      h('span', {}, h('b', {}, stop.label), place ? h('small', {}, place.url ? h('a', { href: place.url, target: '_blank', rel: 'noreferrer' }, place.name) : place.name, place.address ? ' · ' + place.address.split(',')[0] : '') : null)));
  });
  const home = plan.legs[plan.stops.length];
  if (home) rows.push(h('li', { class: 'leg' }, h('time', {}), h('span', {}, `${home.minutes} min ${home.mode === 'walk' ? 'walk' : 'by public transport'}`)));
  rows.push(h('li', { class: 'move' }, h('time', {}, clock(plan.homeAt)), h('span', {}, 'Back at ' + journey.origin.name)));
  return h('ol', { class: 'timeline' }, rows);
}

function calendarBox(turn, journey, plan) {
  const cal = turn.calendar ||= { step: 'idle' };
  const set = patch => { Object.assign(cal, patch); render(); };
  const run = async (work, failStep) => { set({ busy: true, error: '' }); try { await work(); } catch (error) { set({ busy: false, error: error.message, ...(failStep ? { step: failStep } : {}) }); } };
  if (cal.step === 'done') return h('div', { class: 'calendar done', role: 'status' }, h('b', {}, 'Added to your calendar.'), ' ', cal.message || '');
  if (plan.availabilityPending?.length || plan.continuityUnverified) return h('p', { class: 'calendar hint' }, 'This is a draft: a session or connection in it is not confirmed yet, so it cannot be added to the calendar.');
  if (cal.step === 'idle') return h('div', { class: 'calendar' },
    h('button', { class: 'quiet', type: 'button', disabled: cal.busy, onclick: () => run(async () => {
      const status = await api('/api/status');
      set({ busy: false, step: status.calendar?.connected ? 'ack' : 'connect' });
    }) }, 'Add to calendar…'), cal.error ? h('p', { class: 'note', role: 'alert' }, cal.error) : null);
  if (cal.step === 'connect') return h('div', { class: 'calendar' },
    h('p', {}, 'Google Calendar is not connected on this server.'),
    h('button', { class: 'quiet', type: 'button', onclick: () => run(async () => { location.href = (await api('/api/google/connect', {})).url; }) }, 'Connect Google Calendar'),
    h('button', { class: 'link', type: 'button', onclick: () => set({ step: 'idle' }) }, 'Cancel'), cal.error ? h('p', { class: 'note', role: 'alert' }, cal.error) : null);
  if (cal.step === 'ack') {
    const box = h('input', { type: 'checkbox', id: 'ack-' + journey.id });
    return h('div', { class: 'calendar' },
      h('label', { class: 'check', for: 'ack-' + journey.id }, box, 'I understand these are tentative time blocks in my own calendar, not bookings or tickets.'),
      h('button', { class: 'quiet', type: 'button', disabled: cal.busy, onclick: () => {
        if (!box.checked) return set({ error: 'Tick the box to continue.' });
        run(async () => set({ busy: false, step: 'preview', preview: await api('/api/journey/preview', { id: journey.id, choice: plan.id, acknowledge: true }) }));
      } }, 'Preview calendar changes'),
      h('button', { class: 'link', type: 'button', onclick: () => set({ step: 'idle', error: '' }) }, 'Cancel'), cal.error ? h('p', { class: 'note', role: 'alert' }, cal.error) : null);
  }
  return h('div', { class: 'calendar' },
    h('b', {}, `Changes to your calendar on ${dayLabel(cal.preview.date)}`),
    h('ul', { class: 'changes' }, cal.preview.changes.map(c => h('li', {}, `${c.operation || 'Create'}: ${c.label || c.kind}, ${clock(c.start)}–${clock(c.end)}${c.tentative ? ' (tentative)' : ''}`))),
    h('p', { class: 'hint' }, cal.preview.notice || ''),
    h('button', { class: 'send small', type: 'button', disabled: cal.busy, onclick: () => run(async () => {
      const done = await api('/api/calendar/confirm', { id: cal.preview.id });
      set({ busy: false, step: 'done', message: done.message });
    }) }, 'Confirm and write to Google Calendar'),
    h('button', { class: 'link', type: 'button', disabled: cal.busy, onclick: () => set({ step: 'idle', preview: null, error: '' }) }, 'Cancel'),
    cal.error ? h('p', { class: 'note', role: 'alert' }, cal.error) : null);
}

function planCard(turn, journey) {
  const plan = journey.plans.find(p => p.id === turn.choice) || journey.plans[0];
  const latest = state.turns.findLast(t => t.planId) === turn;
  const open = journey.open || {};
  const limits = [open.start && 'leave time', open.deadline && 'return time', open.budget && 'budget'].filter(Boolean);
  if (latest) mappedPlan = { journey, plan };
  return h('section', { class: 'plan', 'aria-label': 'Checked plan' },
    h('header', {},
      h('div', {}, h('b', {}, `Checked plan · ${dayLabel(journey.constraints.date)}`), h('small', {}, `From ${journey.origin.name}${journey.calendarConnected ? ' · checked against your calendar' : ''}`)),
      journey.plans.length > 1 ? h('div', { class: 'options', role: 'tablist', 'aria-label': 'Plan options' }, journey.plans.map((p, i) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': p.id === plan.id ? 'true' : 'false', title: p.name, onclick: () => { turn.choice = p.id; turn.calendar = { step: 'idle' }; render(); } }, `Option ${i + 1}`))) : null),
    h('div', { class: 'plan-body' },
      h('div', {},
        timeline(journey, plan),
        h('p', { class: 'hint' }, `About ${plan.reservedTotal} SEK including transport · ${plan.walking} min walking in total. Times and costs are estimates; opening hours do not guarantee a table or a ticket.`
          + (limits.length ? ` No ${limits.join(', ').replace(/, ([^,]*)$/, ' or $1')} limit was applied.` : '')),
        calendarBox(turn, journey, plan)),
      latest
        ? h('div', { class: 'plan-map' }, h('details', { class: 'journey-map-disclosure', open: true }, h('summary', {}, 'Map'), h('div', { id: 'journey-map-host', 'aria-label': 'Map of this plan' })), h('p', { class: 'journey-map-status hint', role: 'status' }, 'Loading map…'))
        : null));
}

async function send(text, options = {}) {
  text = text.trim();
  if (!text || state.sending) return;
  const spoken = options.spoken === true;   // the request was spoken, so the answer is announced aloud too
  state.turns.push({ role: 'user', text });
  state.sending = true; state.working = 'Thinking';
  render();
  const thread = app.querySelector('.thread');
  const status = h('span', { class: 'working' }, h('i'), h('i'), h('i'), h('span', {}, state.working));
  const pending = h('div', { class: 'turn assistant fresh', 'aria-live': 'polite' }, status);
  thread.append(pending); thread.scrollTop = thread.scrollHeight;
  const started = performance.now(), sentAt = Date.now(), steps = [];
  let reply = '', lastTool = '';
  // If nothing has come back after a few seconds, one spoken phrase says what is actually happening.
  const waiting = spoken ? setTimeout(() => { if (!reply) sayPhrase({ tool: lastTool }); }, 3000) : null;
  try {
    await streamReply(text, {
      onStep(label, tool) { lastTool = tool; if (steps.at(-1) !== label) steps.push(label); if (!reply) status.lastChild.textContent = label; },
      onText(chunk) {
        reply += chunk;
        pending.replaceChildren(...richText(reply.trimStart()));
        if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160) thread.scrollTop = thread.scrollHeight;
      },
    });
    if (!reply.trim()) throw Error('The assistant finished without an answer. Please try again.');
    const turn = { role: 'assistant', text: reply.trim(), steps: [...new Set(steps)], seconds: Math.round((performance.now() - started) / 1000) };
    if (steps.includes(PLAN_STEP)) await attachLatestPlan(turn, sentAt);
    state.turns.push(turn); shownTurns++;   // it replaces the bubble already on screen, so it does not animate again
    if (spoken) announce(turn, text);
  } catch (error) {
    state.turns.push({ role: 'assistant', text: error.message, error: true }); shownTurns++;
  }
  clearTimeout(waiting);
  state.sending = false;
  saveTurns();
  render();
  if (steps.length) loadProfile(true);  // the assistant may have changed what it remembers
}

// ---- the day: the dial, the strip, and the page's own light ----
const activeJobs = () => (state.profile?.jobs || []).filter(job => !job.paused && job.expr);
let lightChoice = 'auto';
try { lightChoice = ['auto', 'light', 'dark'].includes(localStorage.getItem('daylight-light')) ? localStorage.getItem('daylight-light') : 'auto'; } catch { /* storage unavailable: follow the sun */ }
// The page is lit by the real sun over Stockholm: light by day, dark after dusk, warm at each end.
const heaven = { theme: 'light', phase: 'day', sunX: 0.5 };   // what the background needs to know
let atmosphere = null;
function applySky() {
  const here = stockholm(), above = sky(here.minutes, sunTimes(here.dayOfYear, here.offset)), root = document.documentElement;
  root.dataset.theme = lightChoice === 'auto' ? above.theme : lightChoice;
  root.dataset.phase = lightChoice === 'auto' ? above.phase : lightChoice === 'dark' ? 'night' : 'day';
  root.style.setProperty('--sun-x', above.x + '%');
  Object.assign(heaven, { theme: root.dataset.theme, phase: root.dataset.phase, sunX: above.x / 100 });
  atmosphere?.redraw();
}
function cycleLight() {
  lightChoice = { auto: 'light', light: 'dark', dark: 'auto' }[lightChoice];
  try { localStorage.setItem('daylight-light', lightChoice); } catch { /* not remembered, still applied */ }
  applySky(); render();
}
function dayPanel(settled = false) {
  const jobs = activeJobs(), face = dial({ jobs });
  if (settled) face.classList.add('settled');
  return h('div', { class: 'day' }, face,
    jobs.length ? h('ul', { class: 'legend', 'aria-label': 'What runs for you today' }, jobs.map(job => h('li', {}, h('b', {}, job.title), ' ', job.schedule.replace(/^Every day at /, '').toLowerCase()))) : null);
}
// Once a minute, and when the jobs become known, the sun and the marks are moved without redrawing the page.
function refreshDay() {
  applySky();
  app.querySelector('.day')?.replaceWith(dayPanel(true));
  app.querySelector('.daystrip')?.replaceWith(dayStrip({ jobs: activeJobs() }));
  app.querySelector('.brand .mark')?.replaceWith(mark());
}
applySky();
setInterval(refreshDay, 60000);
// The glow sits over the main column, so the background's sun is placed there too, not over the sidebar.
try {
  const field = document.getElementById('atmosphere');
  if (field?.getContext) atmosphere = createAtmosphere(field, () => {
    const main = app.querySelector('.main')?.getBoundingClientRect();
    return { ...heaven, busy: state.sending, sunX: main ? (main.left + main.width * heaven.sunX) / innerWidth : heaven.sunX };
  });
} catch { /* the page works without its background */ }

// ---- voice ----
const player = createPlayer();
const voice = { ready: false, speakReady: false, phase: 'idle', level: 0, acknowledgements: [], clips: new Map(), recording: null, note: '' };
async function loadVoice() {
  try {
    const status = await api('/api/voice/status');
    voice.ready = !!status.hear?.configured && !!navigator.mediaDevices?.getUserMedia; voice.speakReady = !!status.speak?.configured; voice.acknowledgements = status.acknowledgements || [];
    // Fetch the acknowledgements ahead of time, so the first one plays the instant the speaker stops.
    if (voice.ready && voice.speakReady) for (const text of voice.acknowledgements) api('/api/voice/say', { text }).then(clip => { if (clip.audio) voice.clips.set(text, clip.audio); }).catch(() => {});
  } catch { voice.ready = false; }
  if (state.view === 'chat') render();
}
async function sayPhrase({ text, tool }) {
  try {
    if (text && voice.clips.has(text)) return player.say({ audio: voice.clips.get(text) });
    const clip = await api('/api/voice/say', tool ? { tool } : { text });
    return player.say({ audio: clip.audio, text: clip.text });
  } catch { /* speaking is an extra: the text on screen is the answer */ }
}
// The short line made for the ear; it is shown under the answer too, so what was said can be read.
async function announce(turn, asked) {
  try {
    const made = await api('/api/voice/line', { asked, written: turn.text });
    turn.said = made.line; saveTurns(); if (state.view === 'chat' && !state.sending) render();
    player.say({ audio: made.audio, text: made.line });
  } catch { /* the written answer stands on its own */ }
}
async function listen() {
  if (voice.phase === 'listening') return voice.recording?.stop();
  if (voice.phase !== 'idle' || state.sending) return;
  player.stop(); voice.note = '';
  try {
    voice.recording = await record({ onLevel(level) { voice.level = level; const meter = app.querySelector('.mic i'); if (meter) meter.style.transform = `scale(${1 + Math.min(1.2, level * 12)})`; } });
    voice.phase = 'listening'; render();
    const captured = await voice.recording.finished; voice.recording = null;
    if (!captured) { voice.phase = 'idle'; voice.note = 'I did not hear anything.'; return render(); }
    voice.phase = 'hearing'; render();
    const acknowledgement = voice.acknowledgements[Math.floor(Math.random() * voice.acknowledgements.length)];
    if (acknowledgement) sayPhrase({ text: acknowledgement });      // covers the moment it takes to transcribe and to think
    const heard = await api('/api/voice/hear', captured);
    voice.phase = 'idle';
    if (!heard.text?.trim()) { player.stop(); voice.note = 'I could not make that out. Try again, or type it.'; return render(); }
    send(heard.text.trim(), { spoken: true });
  } catch (error) { voice.recording = null; voice.phase = 'idle'; voice.note = error.message; player.stop(); render(); }
}
function micButton() {
  if (!voice.ready) return null;
  const label = { idle: 'Speak', listening: 'Listening… click to stop', hearing: 'One moment…' }[voice.phase];
  return h('button', { class: 'mic ' + voice.phase, type: 'button', title: label, 'aria-label': label, 'aria-pressed': voice.phase === 'listening' ? 'true' : 'false', disabled: voice.phase === 'hearing' || (state.sending && voice.phase === 'idle'), onclick: listen },
    h('i', { 'aria-hidden': 'true' }), micIcon());
}
const micIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>';
  return svg;
};

function chatView() {
  const input = h('textarea', {
    rows: '1', maxlength: '4000', placeholder: 'Ask, plan, or tell me something', 'aria-label': 'Message', disabled: state.sending,
    onkeydown(e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } },
    oninput() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; },
  });
  const thread = h('div', { class: 'thread' },
    state.turns.length ? state.turns.map(turnElement) : h('div', { class: 'welcome' }, h('div', { class: 'welcome-words' },
      h('p', { class: 'kicker' }, greeting(stockholm().minutes)),
      h('h2', {}, 'It keeps working ', h('em', {}, 'while you’re away.')),
      h('p', {}, 'I remember what you tell me, watch job postings, grocery offers and research topics while you are away, keep your calendar in view, and can plan a day out in Stockholm.'),
      h('div', { class: 'ideas' }, ideas.map(([kind, text]) => h('button', { type: 'button', onclick: () => send(text) }, h('small', {}, kind), text)))),
      dayPanel()));
  const view = [
    state.turns.length ? pageCurl() : null,
    thread,
    voice.note ? h('p', { class: 'voice-note', role: 'status' }, voice.note) : null,
    h('form', { class: 'composer', onsubmit(e) { e.preventDefault(); send(input.value); } }, micButton(), input, h('button', { class: 'send', type: 'submit', disabled: state.sending }, 'Send')),
  ];
  queueMicrotask(() => { thread.scrollTop = state.turns.length ? thread.scrollHeight : 0; if (!state.sending) input.focus(); });
  return view;
}
// The corner of the page is curled. Pointing at it lifts it further and shows what is underneath;
// clicking turns the whole page over to a fresh one.
function pageCurl() {
  return h('button', { class: 'curl', type: 'button', 'aria-label': 'New conversation', disabled: state.sending, onclick: turnPage },
    h('span', { class: 'curl-under', 'aria-hidden': 'true' }, h('b', {}, 'New'), h('b', {}, 'conversation')),
    h('span', { class: 'curl-flap', 'aria-hidden': 'true' }));
}
let turning = false;
function turnPage() {
  if (turning || state.sending) return;
  const main = app.querySelector('.main');
  if (!main || matchMedia('(prefers-reduced-motion: reduce)').matches) return newConversation();
  turning = true; player.stop();
  // The turning page is drawn over the main column and outlives the redraw underneath it.
  const box = main.getBoundingClientRect();
  const sheet = h('div', { class: 'pageturn', 'aria-hidden': 'true', style: `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px` },
    h('span', { class: 'curl-under' }), h('span', { class: 'curl-flap' }));
  document.body.append(sheet);
  sheet.style.setProperty('--full', Math.ceil((box.width + box.height) * 1.02) + 'px');
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('go')));
  const finish = () => { if (!turning) return; turning = false; newConversation(); sheet.classList.add('done'); setTimeout(() => sheet.remove(), 420); };
  sheet.addEventListener('transitionend', event => { if (event.propertyName === 'width' && event.target === sheet.firstChild) finish(); });
  setTimeout(finish, 1100);   // in case the browser never reports the end of the animation
}
function newConversation() {
  state.turns = []; shownTurns = 0; state.session = newSession();
  store.set('daylight-turns', []); store.set('daylight-session', state.session);
  render();
}

// ---- what I know ----
async function loadProfile(quiet = false) {
  try { state.profile = await api('/api/profile'); state.profileError = ''; refreshDay(); }
  catch (error) { if (!quiet) state.profileError = error.message; }
  if (state.view === 'profile' || !quiet) render(); else renderStatus();
}
async function change(area, data, noteKey = area) {
  try { state.profile = await api('/api/profile', { area, ...data }); state.notes[noteKey] = ''; }
  catch (error) { state.notes[noteKey] = error.message; }
  render();
}
const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const note = key => state.notes[key] ? h('p', { class: 'note', role: 'alert' }, state.notes[key]) : null;

function memoryCard(key, title, blurb) {
  const memory = state.profile.memory[key];
  const input = h('input', { type: 'text', maxlength: '300', placeholder: 'Add something to remember', 'aria-label': 'New memory' });
  return h('section', { class: 'card' },
    h('h2', {}, title), h('p', {}, `${blurb} ${memory.used} of ${memory.limit} characters used.`),
    memory.entries.length
      ? h('ul', { class: 'rows' }, memory.entries.map((text, index) => h('li', {}, h('span', {}, text),
        h('span', { class: 'actions' }, h('button', { class: 'link danger', type: 'button', onclick: () => change('memory', { file: key, action: 'remove', index, text }, key) }, 'Forget')))))
      : h('p', { class: 'empty' }, 'Nothing yet.'),
    key === 'user' && h('form', { class: 'add', onsubmit(e) { e.preventDefault(); if (input.value.trim()) change('memory', { file: 'user', action: 'add', text: input.value }, key); } }, input, h('button', { type: 'submit' }, 'Remember')),
    note(key));
}

function foodCard() {
  const { likes, dislikes, offersChecked } = state.profile.food;
  const chip = (pref, avoid) => h('span', { class: 'chip' + (avoid ? ' avoid' : ''), title: 'Matches: ' + pref.terms.join(', ') }, pref.label,
    h('button', { class: 'x', type: 'button', 'aria-label': `Remove ${pref.label}`, onclick: () => change('food', { action: 'remove', label: pref.label }) }, '×'));
  const label = h('input', { type: 'text', maxlength: '60', placeholder: 'Food, e.g. pork', 'aria-label': 'Food' });
  const kind = h('select', { 'aria-label': 'Like or avoid' }, h('option', { value: 'dislikes' }, 'I avoid it'), h('option', { value: 'likes' }, 'I like it'));
  const terms = h('input', { type: 'text', maxlength: '200', placeholder: 'Words on a price tag, e.g. fläsk, bacon', 'aria-label': 'Words that identify it' });
  return h('section', { class: 'card' },
    h('h2', {}, 'Food'), h('p', {}, `Used to filter grocery offers${offersChecked ? `, last read from Lidl on ${offersChecked}` : ''}. What you avoid is never sent to you.`),
    h('h3', {}, 'You avoid'), dislikes.length ? h('div', { class: 'chips' }, dislikes.map(p => chip(p, true))) : h('p', { class: 'empty' }, 'Nothing listed here.'),
    h('h3', {}, 'You like'), likes.length ? h('div', { class: 'chips' }, likes.map(p => chip(p, false))) : h('p', { class: 'empty' }, 'Nothing listed here.'),
    h('form', { class: 'add', onsubmit(e) { e.preventDefault(); if (label.value.trim()) change('food', { action: 'add', kind: kind.value, label: label.value, terms: terms.value }); } }, label, kind, terms, h('button', { type: 'submit' }, 'Add')),
    note('food'));
}

function topicsCard() {
  const { topics, lastDigest } = state.profile.research;
  return h('section', { class: 'card' },
    h('h2', {}, 'Research topics'), h('p', {}, `New arXiv papers on these are sent only when something appears${lastDigest ? `; last digest ${lastDigest}` : ''}. Add a topic by asking in chat.`),
    topics.length
      ? h('ul', { class: 'rows' }, topics.map(topic => h('li', {},
        h('span', {}, topic.name, topic.notes.map(n => h('span', { class: 'tag' }, n)), h('small', {}, `Tracked since ${topic.added || '—'}`)),
        h('span', { class: 'actions' }, h('button', { class: 'link danger', type: 'button', onclick: () => change('topic', { id: topic.id }) }, 'Stop tracking')))))
      : h('p', { class: 'empty' }, 'No topics yet. Try “Track new papers on …” in chat.'),
    note('topic'));
}

// Reads a chosen file as base64 for upload (the server extracts the text).
const fileAsBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(Error('That file could not be read.'));
  reader.readAsDataURL(file);
});

function careerCard() {
  const { cv, prefs, matches, lastLooked } = state.profile.career;
  const ui = state.career ||= { paste: false, edit: false, busy: false };
  const act = (data) => change('career', data, 'career');
  const file = h('input', { type: 'file', accept: '.pdf,.docx,.txt,.md', 'aria-label': 'CV file', async onchange() {
    const chosen = file.files[0]; if (!chosen) return;
    if (chosen.size > 3e6) { state.notes.career = 'That file is larger than 3 MB.'; return render(); }
    ui.busy = true; render();
    try { await act({ action: 'cv_file', name: chosen.name, data: await fileAsBase64(chosen) }); } finally { ui.busy = false; render(); }
  } });
  const pasted = h('textarea', { rows: '6', placeholder: 'Paste the text of your CV', 'aria-label': 'CV text' });
  const field = (key, label, hint) => h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'text', name: key, value: (prefs[key] || []).join(', '), placeholder: hint }));
  const remote = h('select', { name: 'remote', 'aria-label': 'Remote work' }, [['yes', 'Remote roles are welcome too'], ['no', 'On-site only'], ['only', 'Remote roles only']].map(([value, text]) => h('option', { value, selected: prefs.remote === value }, text)));
  const summary = [prefs.roles.length ? prefs.roles.join(', ') : 'no roles stated', prefs.places.length ? 'in ' + prefs.places.join(', ') : 'anywhere', { yes: 'remote welcome', no: 'on-site only', only: 'remote only' }[prefs.remote], prefs.languages.length ? 'works in ' + prefs.languages.join(', ') : null, prefs.avoid.length ? 'avoiding ' + prefs.avoid.join(', ') : null].filter(Boolean).join(' · ');
  const ready = cv && prefs.roles.length;
  return h('section', { class: 'card wide' },
    h('h2', {}, 'Job search'),
    h('p', {}, ready ? `Postings from Sweden’s public listings and remote-job boards are checked against your CV every few hours${lastLooked ? `; last looked ${when(lastLooked)}` : ''}. You hear only when one fits.` : 'Add your CV and the kind of role you want, and postings will be checked against it in the background. You hear only when one fits.'),
    h('h3', {}, 'Your CV'),
    cv ? h('ul', { class: 'rows' }, h('li', {}, h('span', {}, cv.name, h('small', {}, `${cv.characters.toLocaleString('en-GB')} characters of text read · added ${cv.added}`)),
      h('span', { class: 'actions' }, h('button', { class: 'link danger', type: 'button', onclick: () => act({ action: 'cv_remove' }) }, 'Remove'))))
      : h('p', { class: 'empty' }, 'No CV yet.'),
    h('div', { class: 'add' },
      h('label', { class: 'upload' + (ui.busy ? ' busy' : '') }, ui.busy ? 'Reading…' : cv ? 'Replace with a file' : 'Upload a file', file),
      h('button', { class: 'quiet', type: 'button', onclick: () => { ui.paste = !ui.paste; render(); } }, ui.paste ? 'Cancel' : 'Paste text instead')),
    ui.paste ? h('form', { class: 'stack', onsubmit(e) { e.preventDefault(); ui.paste = false; act({ action: 'cv_text', text: pasted.value, name: 'CV (pasted)' }); } }, pasted, h('button', { class: 'send small', type: 'submit' }, 'Save CV')) : null,
    h('h3', {}, 'What you are looking for'),
    ui.edit
      ? h('form', { class: 'stack', onsubmit(e) { e.preventDefault(); const f = new FormData(e.target); ui.edit = false; act({ action: 'prefs', roles: f.get('roles'), places: f.get('places'), languages: f.get('languages'), avoid: f.get('avoid'), remote: f.get('remote') }); } },
        field('roles', 'Roles', 'data scientist, machine learning engineer'), field('places', 'Places', 'Stockholm (leave empty for anywhere)'),
        field('languages', 'Languages you work in', 'English, Swedish'), field('avoid', 'Rule out postings that mention', 'consulting, defence'),
        h('label', { class: 'field' }, h('span', {}, 'Remote work'), remote),
        h('div', { class: 'add' }, h('button', { class: 'send small', type: 'submit' }, 'Save'), h('button', { class: 'quiet', type: 'button', onclick: () => { ui.edit = false; render(); } }, 'Cancel')))
      : h('ul', { class: 'rows' }, h('li', {}, h('span', {}, summary, prefs.notes.map(n => h('span', { class: 'tag' }, n, ' ', h('button', { class: 'x', type: 'button', 'aria-label': `Remove note: ${n}`, onclick: () => act({ action: 'note_remove', text: n }) }, '×')))),
        h('span', { class: 'actions' }, h('button', { class: 'link', type: 'button', onclick: () => { ui.edit = true; render(); } }, 'Change')))),
    h('h3', {}, 'Matches'),
    matches.length
      ? h('ul', { class: 'rows matches' }, matches.map(m => h('li', {},
        h('span', {}, h('a', { href: m.url, target: '_blank', rel: 'noreferrer' }, m.title), ` · ${m.employer}${m.place ? ' · ' + m.place : ''}`,
          h('small', {}, `${m.of ? `Meets ${m.met} of ${m.of} main requirements` : `Fit ${m.fit}`}${m.deadline ? ' · apply by ' + m.deadline : ''} · via ${m.source}`),
          m.meets.length ? h('small', { class: 'fits' }, 'Shown by your CV: ' + m.meets.join('; ')) : null,
          m.gaps.length ? h('small', { class: 'gaps' }, 'Not in your CV: ' + m.gaps.join('; ')) : null),
        h('span', { class: 'actions' }, h('button', { class: 'link danger', type: 'button', onclick: () => act({ action: 'dismiss', id: m.id }) }, 'Dismiss')))))
      : h('p', { class: 'empty' }, ready ? (lastLooked ? 'Nothing fits yet.' : 'Not looked yet. Ask “any jobs for me?” in chat to look now.') : 'Nothing to show until there is a CV and a role.'),
    note('career'));
}

function calendarCard() {
  const calendar = state.profile.calendar || {};
  const run = async work => { try { await work(); state.notes.calendar = ''; } catch (error) { state.notes.calendar = error.message; } render(); };
  return h('section', { class: 'card' },
    h('h2', {}, 'Calendar'),
    h('p', {}, calendar.connected ? 'Google Calendar is connected. The assistant can read your day, and adds an event only after you confirm it in the conversation. It cannot change or delete events, or invite anyone.'
      : 'Connect Google Calendar so plans are fitted around what you already have, and so you can ask for an event to be added.'),
    !calendar.configured ? h('p', { class: 'empty' }, 'Calendar access is not set up on this server.')
      : calendar.connected
        ? h('div', { class: 'add' }, h('button', { class: 'quiet', type: 'button', onclick: () => run(async () => { await api('/api/google/disconnect', {}); await loadProfile(); }) }, 'Disconnect'))
        : h('div', { class: 'add' }, h('button', { type: 'button', onclick: () => run(async () => { location.href = (await api('/api/google/connect', {})).url; }) }, 'Connect Google Calendar')),
    note('calendar'));
}

function jobsCard() {
  const { jobs, jobsError } = state.profile;
  return h('section', { class: 'card wide' },
    h('h2', {}, 'Working while you are away'), h('p', {}, 'Scheduled checks. Each one sends a message only when there is something new.'),
    jobsError ? h('p', { class: 'empty' }, jobsError) : jobs.length
      ? h('ul', { class: 'rows' }, jobs.map(job => h('li', {},
        h('span', {}, job.title + (job.paused ? ' (paused)' : ''),
          h('small', {}, `${job.schedule} · delivered to ${job.deliver} · next ${job.paused ? 'paused' : when(job.next)} · last run ${when(job.last)}${job.lastStatus ? ` (${job.lastStatus})` : ''}`)),
        h('span', { class: 'actions' },
          h('button', { class: 'link', type: 'button', onclick: () => change('job', { id: job.id, action: job.paused ? 'resume' : 'pause' }) }, job.paused ? 'Resume' : 'Pause'),
          h('button', { class: 'link', type: 'button', onclick: () => change('job', { id: job.id, action: 'run' }) }, 'Run now')))))
      : h('p', { class: 'empty' }, 'Nothing is scheduled.'),
    note('job'));
}

function profileView() {
  const head = h('header', { class: 'head' },
    h('div', {}, h('h1', {}, 'What I know'), h('p', {}, 'Everything the assistant remembers and does for you. Correct or remove anything.')),
    h('button', { class: 'quiet', type: 'button', onclick: () => loadProfile() }, 'Refresh'));
  if (!state.profile) return [head, dayStrip({ jobs: activeJobs() }), h('div', { class: 'know' }, h('p', { class: 'empty' }, state.profileError || 'Loading…'))];
  return [head, dayStrip({ jobs: activeJobs() }), h('div', { class: 'know' },
    memoryCard('user', 'About you', 'Kept in mind in every conversation, on every channel.'),
    calendarCard(), careerCard(), foodCard(), topicsCard(), jobsCard(),
    state.profile.memory.notes.entries.length ? memoryCard('notes', 'Assistant’s own notes', 'What it has learned about doing things for you.') : null)];
}

// ---- shell ----
function statusBox() {
  const assistant = state.profile?.assistant, online = !!assistant?.reachable;
  return h('div', { class: 'status' },
    h('b', {}, h('span', { class: 'dot' + (online ? ' on' : '') }), online ? 'Assistant online' : state.profile ? 'Assistant offline' : 'Checking…'),
    online ? 'Running on Hermes Agent with NVIDIA Nemotron on Nebius.' : 'Start the Hermes gateway to chat.');
}
function renderStatus() { app.querySelector('.status')?.replaceWith(statusBox()); }
let entering = true;   // a section that has just been opened draws itself in once
function go(view) { entering = state.view !== view || entering; state.view = view; store.set('daylight-view', view); render(); if (view === 'profile') loadProfile(true); }

// Calendar steps are not kept across reloads: a preview must always be fresh.
function saveTurns() { store.set('daylight-turns', state.turns.slice(-40).map(({ calendar, ...turn }) => turn)); }

// After a reload, the newest plan can be shown again if the server still has it.
async function restorePlan() {
  const turn = state.turns.findLast(t => t.planId);
  if (!turn) return;
  try { const journey = await api('/api/plans/latest'); if (journey.id === turn.planId) { plans.set(journey.id, journey); render(); } } catch { /* nothing to restore */ }
}

function render() {
  mappedPlan = null;
  queueMicrotask(() => { if (mappedPlan && state.view === 'chat') mountJourneyMap(mappedPlan.journey, mappedPlan.plan); });
  const tab = (view, label) => h('button', { type: 'button', 'aria-current': state.view === view ? 'page' : null, onclick: () => go(view) }, label);
  const enter = entering && (state.view !== 'profile' || !!state.profile);
  if (enter) entering = false;
  app.replaceChildren(h('div', { class: 'shell' + (state.sending ? ' busy' : '') },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, mark(), 'Daylight'),
      h('nav', { class: 'nav', 'aria-label': 'Sections' }, tab('chat', 'Chat'), tab('profile', 'What I know')),
      statusBox(),
      h('button', { class: 'theme', type: 'button', title: 'The page is lit by the real sun over Stockholm unless you choose otherwise', onclick: cycleLight }, 'Light: ', h('b', {}, { auto: 'the sun', light: 'day', dark: 'night' }[lightChoice])),
      h('a', { class: 'legacy', href: '/privacy.html' }, 'Data and services')),
    h('main', { class: 'main' + (enter ? ' enter' : '') }, state.view === 'profile' ? profileView() : chatView())));
  shownTurns = state.turns.length;
}

render();
loadProfile(true);
loadVoice();
restorePlan();
