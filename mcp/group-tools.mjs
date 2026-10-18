// What a group said, for “summarise what we just discussed”. Hermes keeps the
// messages the bot was not addressed in, but it hands them to the model together
// with every earlier request in that group (digests, reminders, searches), and the
// model summarised those instead. This tool returns only the people's own recent
// messages, and the answer instructions turn the summary into an offer of
// follow-ups: tasks for the shared list, a meeting for the owner's calendar.
import {openChats,currentTurn,latestGroupKey,observedMessages} from '../lib/hermes-chat.mjs';
import {hermesHome} from './digest-tools.mjs';
import {localParts,dateInStockholm} from '../lib/time.mjs';

const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables.';
const GAP_HOURS=3,MAX_MESSAGES=150,MAX_CHARS=15000;
export const groupTools=[
  {name:'group_conversation',description:'The messages people in this group chat exchanged recently, with who said what and when. Call it whenever someone in a group asks to summarise the discussion, asks what was decided or where things stand, or asks what someone said. Use it instead of your memory of this conversation.',inputSchema:{type:'object',additionalProperties:false,properties:{
    hours:{type:'number',minimum:1,maximum:72,description:'Only when they name a period (“today”, “the last two hours”). Leave it out for “what we just discussed”: the latest stretch of conversation is taken.'}}}},
];

const weekday=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',weekday:'long'}).format(new Date(ms));
const when=(ms,today)=>{const p=localParts(ms),t=`${p.hour}:${p.minute}`;return dateInStockholm(ms)===today?t:`${weekday(ms).slice(0,3)} ${p.year}-${p.month}-${p.day} ${t}`;};

// The latest stretch: walk back from the newest message until a silence of GAP_HOURS.
export function latestStretch(messages,gapHours=GAP_HOURS){
  let start=messages.length-1;
  while(start>0&&messages[start].at-messages[start-1].at<gapHours*3600000)start--;
  return messages.slice(Math.max(start,0));
}

export async function groupConversation(args={},{home=hermesHome(),now=Date.now(),db}={}){
  const own=!db;db??=await openChats(home);
  if(!db)return {status:'not_available',howToAnswer:[plain,'Say you cannot see this group’s messages on this setup.']};
  try{return read(args,db,now);}finally{if(own)db.close();}
}

function read({hours},db,now){
  const turn=currentTurn(db,'group_conversation',now);
  if(turn&&!turn.group)return {status:'not_in_a_group',howToAnswer:[plain,'Say this works in a group chat: add the assistant to a group, and ask it there to summarise what was discussed.']};
  const key=turn?.sessionKey||latestGroupKey(db);
  const span=hours||24,today=dateInStockholm(now);
  const recent=key?observedMessages(db,key,now-span*3600000):[];
  if(!recent.length)return {status:'nothing_seen',hours:span,howToAnswer:[plain,`Say you have not seen any messages in this group in the last ${span} hours that were not addressed to you. You only see what is said while you are in the group; if people have been talking, the owner may need to let the bot read group messages (in BotFather, /setprivacy, Disable, then add the bot to the group again).`]};
  let picked=hours?recent:latestStretch(recent);
  if(picked.length>MAX_MESSAGES)picked=picked.slice(-MAX_MESSAGES);
  while(picked.length>1&&picked.reduce((n,m)=>n+m.text.length,0)>MAX_CHARS)picked=picked.slice(1);
  const earlier=recent.length>picked.length?when(recent[0].at,today):null;
  return {status:'found',today:`${weekday(now)} ${today}`,from:when(picked[0].at,today),to:when(picked.at(-1).at,today),count:picked.length,...(earlier?{canSeeBackTo:earlier}:{}),
    messages:picked.map(m=>({who:m.name||'someone',at:when(m.at,today),said:m.text.trim()})),
    howToAnswer:[plain,
      `These are the group’s own messages, oldest first, from ${when(picked[0].at,today)} to ${when(picked.at(-1).at,today)}. Summarise only these. Earlier requests to you, digests, reminders and your own replies in this chat are not part of the discussion: leave them out.`,
      'Keep the summary short: what was decided, what is still open, and who is doing what, naming who said it. Add nothing they did not say.',
      `Then offer the follow-ups this discussion calls for, in one closing question, and add nothing yet: (1) tasks or actions someone named, as a numbered list in their words, for the group’s shared to-do list; (2) a meeting or deadline with a day and a time, for the owner’s calendar, giving the exact date (today is ${weekday(now)} ${today}; work out “Monday next week” and the like from it), the time and the place. Offer only what applies; if nothing does, offer nothing.`,
      'If someone then says yes to the tasks, add each with the to-do tool (list: the group’s name; by: who said yes). If the owner says yes to the meeting, prepare it with calendar_propose and ask them to confirm. Only the owner can confirm a calendar entry.',
      earlier?`If they asked about something older than this stretch, say you can see back to ${earlier} and ask whether to include it.`:null].filter(Boolean)};
}

export const groupHandlers={group_conversation:args=>groupConversation(args)};
