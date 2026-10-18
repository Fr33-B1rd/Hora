// Calendar tools for conversation: read a day, and add one event in two steps.
// The assistant may propose an event; only a later, separate confirmation by
// the user writes it. Three things in code hold that line, because an
// instruction alone would not: a proposal is stored here and expires, the
// confirming call must quote an agreeing message from the user, and it is
// refused if it comes within seconds of the proposal (the same turn).
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createStore} from '../lib/store.mjs';
import {createCalendar} from '../lib/calendar.mjs';
import {validDate,minute,clock,localParts,instant,dateInStockholm} from '../lib/time.mjs';
import {openChats,currentTurn,ownerIds} from '../lib/hermes-chat.mjs';

const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables.';
const PROPOSAL_MINUTES=15,MIN_SECONDS_BEFORE_CONFIRM=4;
const clockText={type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',description:'24-hour HH:MM, Stockholm time'};
export const calendarTools=[
  {name:'calendar_day',description:'What is in the user’s Google Calendar on one day, with titles and times. Use it when they ask what they have on, and before advising on or planning anything for a day, so that you can tell them what is already there.',inputSchema:{type:'object',additionalProperties:false,required:['date'],properties:{
    date:{type:'string',description:'YYYY-MM-DD in Stockholm; today is in the server instructions'}}}},
  {name:'calendar_propose',description:'First step of adding an event to the user’s Google Calendar: checks the day and prepares the event, but writes nothing. Use it when the user asks to put something in their calendar. Then tell them exactly what would be added and ask them to confirm. Never call calendar_confirm in the same turn.',inputSchema:{type:'object',additionalProperties:false,required:['title','date','start','end'],properties:{
    title:{type:'string',maxLength:200,description:'The event’s title in the user’s words'},
    date:{type:'string',description:'YYYY-MM-DD in Stockholm'},
    start:clockText,end:{...clockText,description:'24-hour HH:MM, after start. If the user gave no end or length, use one hour and say so.'},
    location:{type:'string',maxLength:300},notes:{type:'string',maxLength:1000}}}},
  {name:'calendar_confirm',description:'Second step: writes a proposed event to the calendar. Call it only in a later turn, after the user has replied to your question with a clear yes. If they said no, changed a detail, or said anything unclear, do not call it: propose again or drop it.',inputSchema:{type:'object',additionalProperties:false,required:['proposalId','userSaid'],properties:{
    proposalId:{type:'string',description:'From calendar_propose'},
    userSaid:{type:'string',maxLength:300,description:'The user’s confirming message, word for word'}}}},
];

const agrees=/^\W*(yes|yep|yeah|yup|ok(ay)?|sure|please do|do it|go ahead|go for it|confirm(ed)?|add it|sounds good|that(’|')?s (right|correct|fine)|correct|right|absolutely|definitely|perfect|ja|japp|gärna|kör)\b/i;
const refuses=/\b(no|nope|not|don(’|')t|do not|cancel|stop|wait|never mind|nevermind|instead|change|move|rather|but|except|actually|make it|unless|maybe|nej|inte|men)\b/i;
// Whether a message is a plain yes. Anything hedged, changed or negative is not.
export const saysYes=text=>{const t=String(text||'').trim();return t.length<=120&&agrees.test(t)&&!refuses.test(t);};

let shared=null;
export const open=()=>shared||=(()=>{const store=createStore(process.env.DAYLIGHT_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url)));
  return {store,calendar:createCalendar({clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirect:process.env.GOOGLE_REDIRECT_URI||'http://127.0.0.1:4318/api/google/callback'},store)};})();
const hhmm=iso=>{const p=localParts(Date.parse(iso));return p.hour+':'+p.minute;};
const notConnected={status:'not_connected',howToAnswer:[plain,'Say that Google Calendar is not connected yet, and that they can connect it on the Daylight web page under “What I know”. Offer nothing else about the calendar.']};
// The day's events as the user would read them, earliest first; an all-day event has no times.
export function eventsOf(day){
  return [...day.busy,...day.own].map(e=>({title:e.title||'(no title)',...(e.allDay?{allDay:true}:{start:hhmm(e.start),end:hhmm(e.end)})})).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
}

// The chat a calendar tool is called from, as Hermes recorded it (see lib/hermes-chat.mjs).
// In a group the owner's calendar stays private: nothing in it is read out, a meeting
// the group agreed on may be proposed, and only the owner's own yes writes it.
async function chatTurn(tool){
  const db=await openChats();if(!db)return null;
  try{const turn=currentTurn(db,tool);return turn&&{...turn,owners:ownerIds()};}finally{db.close();}
}
const privateInGroup={status:'private',howToAnswer:[plain,'Say the owner’s calendar is private and is not read out in a group; they can ask in a private chat.']};

export async function calendarDay({date},services=open(),turn=null){
  validDate(date);
  if(turn?.group)return privateInGroup;
  if(!services.calendar.status().connected)return notConnected;
  const events=eventsOf(await services.calendar.day(date));
  return {date,events,howToAnswer:[plain,events.length?'List the events in order, one per line: time, then title.':'Say the day is free.',
    events.length?'If the user is planning something or asking for advice about this day, your reply must begin by naming what is already there, with its time, before any question or suggestion: they may have forgotten it.':null,
    'Use only the titles and times given here.'].filter(Boolean)};
}

export async function calendarPropose({title,date,start,end,location,notes},services=open(),now=Date.now(),turn=null){
  validDate(date);const name=String(title||'').trim();if(!name)throw Error('Give the event a title.');
  const from=minute(start),to=minute(end);if(to<=from)throw Error('The end must be after the start.');
  if(date<dateInStockholm(now))throw Error('That date is in the past.');
  if(!services.calendar.status().connected)return notConnected;
  const day=await services.calendar.day(date),slot={start:instant(date,from),end:instant(date,to)};
  const overlaps=[...day.busy,...day.own].filter(e=>Date.parse(slot.start)<Date.parse(e.end)&&Date.parse(e.start)<Date.parse(slot.end)).map(e=>({title:e.title||'(no title)',...(e.allDay?{allDay:true}:{start:hhmm(e.start),end:hhmm(e.end)})}));
  const proposalId='ev-'+randomBytes(6).toString('hex');
  services.store.put('chatproposal:'+proposalId,{title:name.slice(0,200),date,start:from,end:to,location:location||null,notes:notes||null,created:now,expires:now+PROPOSAL_MINUTES*60000,done:null,...(turn?.group?{group:turn.chatId}:{})});
  const wouldAdd={title:name.slice(0,200),date,start:clock(from),end:clock(to),...(location?{location}:{})};
  if(turn?.group)return {status:'awaiting_confirmation',proposalId,wouldAdd,ownerIsBusyThen:overlaps.length>0,nothingWrittenYet:true,
    howToAnswer:[plain,'Nothing has been added. Say exactly what would be added to the owner’s calendar (title, day, start and end) and ask the owner to confirm: only their yes adds it.',
      overlaps.length?'The owner already has something at that time. Say only that; never what it is.':null,
      'Stop there. Call calendar_confirm only in a later turn, after the owner replies with a clear yes.'].filter(Boolean)};
  return {status:'awaiting_confirmation',proposalId,wouldAdd,overlapsWith:overlaps,nothingWrittenYet:true,
    howToAnswer:[plain,'Nothing has been added. Say exactly what would be added (title, day, start and end) and ask whether to add it.',
      overlaps.length?'It overlaps with what is already there: name each overlapping event with its time before asking, so they can decide.':null,
      'Stop there. Call calendar_confirm only in a later turn, and only if their reply is a clear yes.'].filter(Boolean)};
}

export async function calendarConfirm({proposalId,userSaid},services=open(),now=Date.now(),turn=null){
  const key='chatproposal:'+String(proposalId||''),p=services.store.get(key);
  const refuse=(status,line)=>({status,written:false,howToAnswer:[plain,line]});
  if(!p)return refuse('no_such_proposal','Say you have nothing waiting to be added, and offer to prepare it again.');
  if(p.done)return {status:'already_added',written:true,link:p.done.url,howToAnswer:[plain,'Say it is already in their calendar.']};
  if(p.expires<now)return refuse('expired','Say the request timed out after a quarter of an hour without being added, and offer to prepare it again.');
  if(now-p.created<MIN_SECONDS_BEFORE_CONFIRM*1000)return refuse('too_soon','Nothing was added: the user has not had a chance to answer. Ask them whether to add it, and wait for their reply.');
  if(turn?.group&&!(turn.speaker.id&&turn.owners.includes(turn.speaker.id)))return refuse('owner_only','Nothing was added: only the owner can confirm an entry in their calendar. Ask the owner to reply yes themselves.');
  // In Telegram the confirming message is read from Hermes's record, not taken from the model.
  if(turn?.source==='telegram'&&turn.said)userSaid=turn.said;
  if(!saysYes(userSaid))return refuse('not_confirmed','Nothing was added, because their message was not a clear yes. If they changed a detail, propose the event again with the change; if they declined, say it was left out.');
  if(!services.calendar.status().connected)return notConnected;
  const saved=await services.calendar.add({title:p.title,date:p.date,start:p.start,end:p.end,location:p.location,notes:p.notes},proposalId);
  services.store.put(key,{...p,done:{url:saved.url,at:now}});
  return {status:'added',written:true,added:{title:p.title,date:p.date,start:clock(p.start),end:clock(p.end)},link:saved.url,
    howToAnswer:[plain,'Confirm in one sentence what was added and when. No invitation was sent to anyone.']};
}

export const calendarHandlers={calendar_day:async a=>calendarDay(a,open(),await chatTurn('calendar_day')),
  calendar_propose:async a=>calendarPropose(a,open(),Date.now(),await chatTurn('calendar_propose')),
  calendar_confirm:async a=>calendarConfirm(a,open(),Date.now(),await chatTurn('calendar_confirm'))};
