// What Hermes itself recorded about the chat a tool is being called from. Hermes
// keeps every chat in $HERMES_HOME/state.db, and it writes the user's message and
// the assistant's tool call there before the tool runs. Reading them back tells a
// tool, from the record rather than from the model's say-so, whether it was called
// from a group, who asked, and what they actually wrote.
import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const hermesHome=()=>process.env.HERMES_HOME||join(homedir(),'.hermes');
const GROUP_TYPES=['group','forum','supergroup'];
const groupTypes=GROUP_TYPES.map(t=>`'${t}'`).join(',');

// Read-only, opened per call: the gateway writes the file all the time.
export async function openChats(home=hermesHome()){
  const file=join(home,'state.db');if(!existsSync(file))return null;
  try{const {DatabaseSync}=await import('node:sqlite');return new DatabaseSync(file,{readOnly:true});}catch{return null;}
}

// Group messages are stored as "[Name|telegram id]\ntext" by the Telegram adapter.
export function speakerOf(content){
  const m=/^\[([^\]\n]*)\|([^\]|\n]*)\]\n?([\s\S]*)$/.exec(String(content||''));
  return m?{name:m[1].trim()||null,id:m[2].trim()||null,text:m[3]}:{name:null,id:null,text:String(content||'')};
}

// The chat the named tool is being called from: the newest recorded call of it,
// and the user message that call answers. Null when there is no record (tests, or
// a Hermes without state.db), and callers then behave as in a private chat.
export function currentTurn(db,tool,now=Date.now()){
  if(!db)return null;
  try{
    const call=db.prepare(`select m.id,m.session_id,s.source,s.chat_type,s.chat_id,s.session_key from messages m join sessions s on s.id=m.session_id
      where m.role='assistant' and instr(m.tool_calls,?)>0 and m.timestamp>? order by m.id desc limit 1`).get(`__${tool}"`,now/1000-180);
    if(!call)return null;
    const asked=db.prepare(`select content from messages where session_id=? and role='user' and coalesce(observed,0)=0 and id<? order by id desc limit 1`).get(call.session_id,call.id);
    const who=speakerOf(asked?.content);
    return {source:call.source,group:call.source==='telegram'&&GROUP_TYPES.includes(call.chat_type),chatId:call.chat_id,sessionKey:call.session_key,
      speaker:{name:who.name,id:who.id},said:who.text.replace(/^(\s*@\w+[,:]?\s*)+/,'').trim()};
  }catch{return null;}
}

// The newest Telegram group conversation, for when the calling turn is not on record.
export function latestGroupKey(db){
  try{return db.prepare(`select s.session_key k from messages m join sessions s on s.id=m.session_id where s.source='telegram' and s.chat_type in (${groupTypes}) order by m.id desc limit 1`).get()?.k||null;}catch{return null;}
}

// Messages the bot was not addressed in, for one group, since a time (oldest first).
// A group's conversation may span several Hermes sessions; rows are de-duplicated.
export function observedMessages(db,sessionKey,sinceMs){
  const rows=db.prepare(`select m.content,m.timestamp from messages m join sessions s on s.id=m.session_id
    where s.session_key=? and m.role='user' and m.observed=1 and m.timestamp>=? order by m.timestamp,m.id`).all(sessionKey,sinceMs/1000);
  const seen=new Set();
  return rows.filter(r=>{const k=r.timestamp+'\n'+r.content;if(seen.has(k))return false;seen.add(k);return true;})
    .map(r=>({...speakerOf(r.content),at:Math.round(r.timestamp*1000)}));
}

// The owner's Telegram user id(s), from the gateway's own settings.
export function ownerIds(home=hermesHome()){
  let raw=process.env.TELEGRAM_ALLOWED_USERS;
  if(!raw)try{raw=/^TELEGRAM_ALLOWED_USERS=(.*)$/m.exec(readFileSync(join(home,'.env'),'utf8'))?.[1];}catch{/* no settings file */}
  return String(raw||'').replace(/["']/g,'').split(',').map(s=>s.trim()).filter(Boolean);
}
