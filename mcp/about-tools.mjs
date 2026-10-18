// “Who are you?” and “What can you do?”, answered from what is actually set up.
// Each of Hora's abilities comes with words to try, and where something is
// still missing (no CV, no calendar, no topics) the one step that sets it up.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hermesHome} from './digest-tools.mjs';
import {open as openCalendar} from './calendar-tools.mjs';

const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables.';
export const aboutTools=[
  {name:'about_hora',description:'Who you are (Hora) and what you can do for this user, with what is already set up and what is still missing. Call it whenever someone asks who you are, what you can do, how to use you, or how to get started.',inputSchema:{type:'object',additionalProperties:false,properties:{}}},
];

const readJson=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return {};}};
export async function aboutHora({home=hermesHome(),calendarConnected=()=>{try{return openCalendar().calendar.status().connected;}catch{return false;}},page=process.env.DAYLIGHT_PUBLIC_ORIGIN||'http://127.0.0.1:4318'}={}){
  const [research,deals,career,cron]=await Promise.all(['daylight/research.json','daylight/deals.json','daylight/jobs.json','cron/jobs.json'].map(f=>readJson(join(home,f))));
  const jobs=Array.isArray(cron)?cron:cron.jobs||[],running=name=>jobs.some(j=>j.name===name&&j.enabled!==false);
  const topics=(research.topics||[]).map(t=>t.name),avoids=(deals.dislikes||[]).map(p=>p.label),likes=(deals.likes||[]).map(p=>p.label);
  const cv=!!career.cv,roles=career.prefs?.roles||[],calendar=calendarConnected();
  const abilities=[
    {name:'Job watch',does:'checks new job postings against your CV every few hours and tells you only about ones that fit, with what fits and what is missing',
      try:['Any jobs for me?','How should I adapt my CV for the first one?'],
      ready:cv&&roles.length>0&&running('daylight-job-matches'),
      setUp:!cv?`upload your CV on the web page (${page}, What I know, Job search) and tell me the roles you want`:!roles.length?'tell me the kind of role you want, for example “I’m looking for data scientist jobs in Stockholm”':null},
    {name:'Research digest',does:'reads new arXiv papers on your topics each morning and sends the ones that matter',
      try:['Track new papers on …','Paste today’s research digest here'],ready:topics.length>0&&running('daylight-research-feed'),
      ...(topics.length?{now:'following '+topics.join(', ')}:{}),setUp:topics.length?null:'name a topic: “Track new papers on retrieval-augmented generation”'},
    {name:'Grocery offers',does:'sends Lidl Sverige’s weekly offers each morning, leaving out what you avoid',
      try:['What’s on offer this week?','I don’t eat pork'],ready:running('daylight-grocery-deals'),
      ...(avoids.length||likes.length?{now:[avoids.length?'avoiding '+avoids.join(', '):null,likes.length?'favouring '+likes.join(', '):null].filter(Boolean).join('; ')}:{})},
    {name:'Calendar',does:'tells you what is on a day, and adds an event after you confirm it',
      try:['What do I have on tomorrow?','Put lunch with Sam on Friday at 12 in my calendar'],ready:calendar,
      setUp:calendar?null:`connect Google Calendar on the web page (${page}, What I know, Calendar)`},
    {name:'Day planner',does:'plans a day out in Stockholm against real opening hours and travel times, around what is in your calendar',
      try:['Plan Saturday: a museum and sushi, starting from Slussen'],ready:true},
    {name:'Lists and reminders',does:'keeps a to-do list, also one shared by a group, and reminds you on a date',
      try:['Add “renew passport” to my list','Remind me on Friday at 9 to call the dentist'],ready:true},
    {name:'Group chats',does:'in a group, summarises what was just discussed and offers to put its tasks on the shared list and its meeting in your calendar',
      try:['@Hora summarise what we just discussed'],ready:true},
    {name:'Memory',does:'remembers what you tell it, and shows all of it on the web page so you can correct it',
      try:['Remember that I’m vegetarian','What do you know about me?'],ready:true},
  ];
  return {name:'Hora',what:'a personal assistant that keeps working while you are away, part of Daylight',page,abilities,
    howToAnswer:[plain,
      'Introduce yourself in one line as Hora, a personal assistant in Daylight that keeps working while the user is away. If asked only who you are, stop there and offer to say what you can do.',
      'For what you can do: one short line per ability, its name and one example of what to say; for an ability that is not ready, add the one step that sets it up. Never write “ready” for the others: just leave the step out. End with the web page address.',
      'For how to get started: only the abilities that are not ready, as numbered steps, then one line saying everything else works already, with one example. At most eight lines.',
      'Talk only about these abilities. Do not list your general tools (files, code, browsing) unless the user asks what else you can do.',
      'In a group chat, leave out what is set up for the owner (CV, calendar, food, topics) and give only the abilities and examples.']};
}

export const aboutHandlers={about_hora:()=>aboutHora()};
