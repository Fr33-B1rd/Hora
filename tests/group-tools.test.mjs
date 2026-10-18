import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {groupConversation,latestStretch,groupTools,groupHandlers} from '../mcp/group-tools.mjs';
import {speakerOf,currentTurn,ownerIds} from '../lib/hermes-chat.mjs';

// A Hermes state.db in memory, with only the columns the tools read.
const NOW=Date.parse('2026-10-18T15:00:00Z');   // Sunday, 17:00 in Stockholm
const at=iso=>Date.parse(iso)/1000;
function chats(){
  const db=new DatabaseSync(':memory:');
  db.exec(`create table sessions(id text primary key,source text,chat_type text,chat_id text,session_key text);
    create table messages(id integer primary key autoincrement,session_id text,role text,content text,tool_calls text,timestamp real,observed integer default 0);`);
  const session=(id,source,type,chat)=>db.prepare('insert into sessions values(?,?,?,?,?)').run(id,source,type,chat,`agent:main:${source}:${type}:${chat}`);
  const say=(session,role,content,iso,{observed=0,tool=null}={})=>db.prepare('insert into messages(session_id,role,content,tool_calls,timestamp,observed) values(?,?,?,?,?,?)')
    .run(session,role,content,tool&&JSON.stringify([{function:{name:'mcp__daylight__'+tool,arguments:'{}'}}]),at(iso),observed);
  session('g1','telegram','group','-555');session('g2','telegram','group','-555');session('dm','telegram','dm','111');
  // The morning: a digest request and chatter, hours before the discussion.
  say('g1','user','[Z|111]\n@hora_bot paste the research digest','2026-10-18T06:00:00Z');
  say('g1','assistant','Here is this morning’s research digest…','2026-10-18T06:00:30Z');
  say('g1','user','[H|222]\nmorning all','2026-10-18T06:10:00Z',{observed:1});
  // The afternoon discussion; Hermes rolled the group over to a new session in between.
  say('g2','user','[H|222]\nAre we behind the schedule','2026-10-18T14:40:00Z',{observed:1});
  say('g2','user','[Z|111]\nYes. Features by importance: 1. Computer use 2. Multi-agents deployment 3. UX re-design. Ask Eric to do the scaling experiments after.','2026-10-18T14:42:00Z',{observed:1});
  say('g2','user','[Z|111]\nYes. Features by importance: 1. Computer use 2. Multi-agents deployment 3. UX re-design. Ask Eric to do the scaling experiments after.','2026-10-18T14:42:00Z',{observed:1});  // copied by a compaction
  say('g2','user','[H|222]\nHow about we meet on Monday next week?','2026-10-18T14:45:00Z',{observed:1});
  say('g2','user','[Z|111]\nPerfect! Let’s meet at your place at 17:00.','2026-10-18T14:47:00Z',{observed:1});
  say('dm','user','what jobs are there for me','2026-10-18T14:50:00Z');
  say('g2','user','[Z|111]\n@hora_bot summarise what we just discussed','2026-10-18T14:58:00Z');
  say('g2','assistant',null,'2026-10-18T14:58:05Z',{tool:'group_conversation'});
  return {db,say};
}

test('the tool is declared with a handler and a closed input',()=>{
  assert.deepEqual(groupTools.map(t=>t.name),Object.keys(groupHandlers));assert.equal(groupTools[0].inputSchema.additionalProperties,false);
});

test('a stored group message gives its speaker, and an unattributed one is kept whole',()=>{
  assert.deepEqual(speakerOf('[Maria Lind|222]\nhello\nthere'),{name:'Maria Lind',id:'222',text:'hello\nthere'});
  assert.deepEqual(speakerOf('plain'),{name:null,id:null,text:'plain'});
});

test('“what we just discussed” is the people’s latest stretch only, not the bot’s earlier work in that group',async()=>{
  const {db}=chats();
  const r=await groupConversation({},{db,now:NOW});
  assert.equal(r.status,'found');assert.equal(r.count,4);       // the morning, the duplicate, the request and the DM are not in it
  assert.deepEqual(r.messages.map(m=>m.who),['H','Z','H','Z']);
  assert.equal(r.messages[0].at,'16:40');assert.match(r.messages[3].said,/your place at 17:00/);
  assert.equal(r.canSeeBackTo,'08:10');
  assert.equal(r.today,'Sunday 2026-10-18');
  const how=r.howToAnswer.join(' ');
  assert.match(how,/Summarise only these/);assert.match(how,/digests, reminders and your own replies .* leave them out/);
  assert.match(how,/numbered list in their words, for the group’s shared to-do list/);assert.match(how,/owner’s calendar/);assert.match(how,/add nothing yet/);
  assert.match(how,/Only the owner can confirm/);
  const day=await groupConversation({hours:24},{db,now:NOW});
  assert.equal(day.count,5);assert.equal(day.messages[0].said,'morning all');
});

test('outside a group, or with nothing seen, it says so plainly',async()=>{
  const {db,say}=chats();
  say('dm','assistant',null,'2026-10-18T14:59:00Z',{tool:'group_conversation'});
  assert.equal((await groupConversation({},{db,now:NOW})).status,'not_in_a_group');
  const empty=new DatabaseSync(':memory:');
  empty.exec('create table sessions(id text,source text,chat_type text,chat_id text,session_key text);create table messages(id integer primary key,session_id text,role text,content text,tool_calls text,timestamp real,observed integer);');
  const r=await groupConversation({},{db:empty,now:NOW});
  assert.equal(r.status,'nothing_seen');assert.match(r.howToAnswer.join(' '),/setprivacy/);
});

test('the latest stretch ends at a long silence',()=>{
  const m=[0,1,2,6,7].map(h=>({at:h*3600000}));
  assert.deepEqual(latestStretch(m).map(x=>x.at/3600000),[6,7]);
  assert.deepEqual(latestStretch([{at:5}]),[{at:5}]);
});

test('the calling turn is read from Hermes’s record: which chat, who asked, and what they wrote',()=>{
  const {db,say}=chats();
  say('g2','user','[H|222]\n@hora_bot yes','2026-10-18T14:59:00Z');
  say('g2','assistant',null,'2026-10-18T14:59:04Z',{tool:'calendar_confirm'});
  const turn=currentTurn(db,'calendar_confirm',NOW);
  assert.equal(turn.group,true);assert.deepEqual(turn.speaker,{name:'H',id:'222'});assert.equal(turn.said,'yes');
  assert.equal(currentTurn(db,'calendar_confirm',NOW+3600000),null);    // an old call is not this turn
  assert.equal(currentTurn(null,'calendar_confirm'),null);
});

test('the owner’s Telegram id comes from the gateway’s settings',()=>{
  const before=process.env.TELEGRAM_ALLOWED_USERS;
  process.env.TELEGRAM_ALLOWED_USERS='111, 333';
  try{assert.deepEqual(ownerIds('/nowhere'),['111','333']);}finally{if(before===undefined)delete process.env.TELEGRAM_ALLOWED_USERS;else process.env.TELEGRAM_ALLOWED_USERS=before;}
});
