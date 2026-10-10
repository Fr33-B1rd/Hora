// Daylight web app: a chat with the same assistant as the user's chat apps, and
// a page showing what that assistant remembers and does on a schedule.

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
  for (const child of children.flat()) if (child != null && child !== false) el.append(child);
  return el;
}
const sun = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>';
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
          if (event === 'hermes.tool.progress') { if (payload.status !== 'completed') onStep(stepLabel(payload)); }
          else if (payload.choices?.[0]?.delta?.content) onText(payload.choices[0].delta.content);
        } catch { /* a partial or non-JSON frame: skip it */ }
      }
      event = 'message';
    }
  }
}

// ---- chat ----
const ideas = [
  ['Groceries', 'What’s on offer this week?'],
  ['Going out', 'Plan tomorrow: a museum and sushi, starting from Slussen'],
  ['Research', 'Track new papers on evaluating LLM agents'],
  ['Memory', 'What do you know about me?'],
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

function turnElement(turn) {
  const el = h('div', { class: `turn ${turn.role}${turn.error ? ' error' : ''}` }, richText(turn.text));
  if (turn.steps?.length) el.append(h('small', { class: 'steps' }, turn.steps.join(' · ') + (turn.seconds ? ` · ${turn.seconds} s` : '')));
  return el;
}

async function send(text) {
  text = text.trim();
  if (!text || state.sending) return;
  state.turns.push({ role: 'user', text });
  state.sending = true; state.working = 'Thinking';
  render();
  const thread = app.querySelector('.thread');
  const status = h('span', { class: 'working' }, h('i'), h('i'), h('i'), h('span', {}, state.working));
  const pending = h('div', { class: 'turn assistant', 'aria-live': 'polite' }, status);
  thread.append(pending); thread.scrollTop = thread.scrollHeight;
  const started = performance.now(), steps = [];
  let reply = '';
  try {
    await streamReply(text, {
      onStep(label) { if (steps.at(-1) !== label) steps.push(label); if (!reply) status.lastChild.textContent = label; },
      onText(chunk) {
        reply += chunk;
        pending.replaceChildren(...richText(reply.trimStart()));
        if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160) thread.scrollTop = thread.scrollHeight;
      },
    });
    if (!reply.trim()) throw Error('The assistant finished without an answer. Please try again.');
    state.turns.push({ role: 'assistant', text: reply.trim(), steps: [...new Set(steps)], seconds: Math.round((performance.now() - started) / 1000) });
  } catch (error) {
    state.turns.push({ role: 'assistant', text: error.message, error: true });
  }
  state.sending = false;
  store.set('daylight-turns', state.turns.slice(-40));
  render();
  if (steps.length) loadProfile(true);  // the assistant may have changed what it remembers
}

function chatView() {
  const input = h('textarea', {
    rows: '1', maxlength: '4000', placeholder: 'Ask, plan, or tell me something to remember', 'aria-label': 'Message', disabled: state.sending,
    onkeydown(e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } },
    oninput() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; },
  });
  const thread = h('div', { class: 'thread' },
    state.turns.length ? state.turns.map(turnElement) : h('div', { class: 'welcome' },
      h('h2', {}, 'What can I do for you?'),
      h('p', {}, 'I remember what you tell me, keep an eye on grocery offers and research topics, and can plan a day out in Stockholm.'),
      h('div', { class: 'ideas' }, ideas.map(([kind, text]) => h('button', { type: 'button', onclick: () => send(text) }, h('small', {}, kind), text)))));
  const view = [
    h('header', { class: 'head' },
      h('div', {}, h('h1', {}, 'Chat'), h('p', {}, 'The same assistant, memory and skills as your chat app.')),
      h('button', { class: 'quiet', type: 'button', disabled: state.sending || !state.turns.length, onclick: newConversation }, 'New conversation')),
    thread,
    h('form', { class: 'composer', onsubmit(e) { e.preventDefault(); send(input.value); } }, input, h('button', { class: 'send', type: 'submit', disabled: state.sending }, 'Send')),
  ];
  queueMicrotask(() => { thread.scrollTop = thread.scrollHeight; if (!state.sending) input.focus(); });
  return view;
}
function newConversation() {
  state.turns = []; state.session = newSession();
  store.set('daylight-turns', []); store.set('daylight-session', state.session);
  render();
}

// ---- what I know ----
async function loadProfile(quiet = false) {
  try { state.profile = await api('/api/profile'); state.profileError = ''; }
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
  if (!state.profile) return [head, h('div', { class: 'know' }, h('p', { class: 'empty' }, state.profileError || 'Loading…'))];
  return [head, h('div', { class: 'know' },
    memoryCard('user', 'About you', 'Kept in mind in every conversation, on every channel.'),
    foodCard(), topicsCard(), jobsCard(),
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
function go(view) { state.view = view; store.set('daylight-view', view); render(); if (view === 'profile') loadProfile(true); }

function render() {
  const tab = (view, label) => h('button', { type: 'button', 'aria-current': state.view === view ? 'page' : null, onclick: () => go(view) }, label);
  app.replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, sun(), 'Daylight'),
      h('nav', { class: 'nav', 'aria-label': 'Sections' }, tab('chat', 'Chat'), tab('profile', 'What I know')),
      statusBox(),
      h('a', { class: 'legacy', href: '/legacy.html' }, 'Earlier version')),
    h('main', { class: 'main' }, state.view === 'profile' ? profileView() : chatView())));
}

render();
loadProfile(true);
