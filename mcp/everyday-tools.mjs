// Everyday tools for conversation: grocery offers, food preferences, research
// topics. They run the same job scripts the scheduler runs, so a question in
// chat and the morning digest read and write the same state. Offered as tools
// (always visible to the model) rather than as steps in a skill, because the
// model does not reliably open a skill before acting.
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

const scripts=fileURLToPath(new URL('../hermes/scripts/',import.meta.url));
// Runs one job script and returns its JSON output. The scripts inherit this
// process's environment, which is where the small model's key comes from.
// `input`, when given, is passed on standard input (a CV is too long for an argument).
export const runScript=(name,args,input)=>new Promise((resolve,reject)=>{
  const child=execFile(process.env.DAYLIGHT_PYTHON||'python3',[scripts+name,...args],{timeout:240000,maxBuffer:4e6,windowsHide:true},(error,stdout,stderr)=>{
    if(error)return reject(Error((stderr||error.message).trim().split('\n').at(-1).slice(0,300)));
    try{resolve(JSON.parse(stdout));}catch{reject(Error('The script returned something unreadable.'));}
  });
  if(input!==undefined)child.stdin.end(input);
});

// What the agent's own memory says about the user, one entry per item.
export const readMemory=async()=>{try{return (await readFile(join(process.env.HERMES_HOME||join(homedir(),'.hermes'),'memories','USER.md'),'utf8')).split(/\r?\n§\r?\n/).map(e=>e.trim()).filter(Boolean);}catch{return [];}};

const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables.';
export const everydayTools=[
  {name:'grocery_offers',description:'This week’s food offers at Lidl Sverige, with the user’s stored likes and dislikes and what you remember about them already applied. Use this for any question about grocery discounts, deals or offers; do not answer those from a web search. Lidl is the only shop covered.',inputSchema:{type:'object',additionalProperties:false,properties:{
    find:{type:'string',description:'One product to look for, as a Swedish word (kyckling, lax, ost). Omit for the best offers overall.'},
    limit:{type:'integer',minimum:1,maximum:20,description:'How many offers to return; default 8'}}}},
  {name:'food_preference',description:'Record a food the user likes or avoids, so the daily offers message and every later answer apply it. Call this every time the user states one, in any conversation and however briefly: “I hate pork”, “no shellfish”, “I’m vegetarian” (avoid meat and fish), “I love salmon”, “pork is fine again” (forget). Also save the fact with your memory tool.',inputSchema:{type:'object',additionalProperties:false,required:['action','food'],properties:{
    action:{type:'string',enum:['like','avoid','forget'],description:'forget removes a like or dislike the user has withdrawn'},
    food:{type:'string',description:'The food in the user’s word, e.g. “pork”, “shellfish”, “meat and fish”'},
    terms:{type:'array',maxItems:20,items:{type:'string'},description:'Lowercase Swedish and English product words that identify it on a price tag, e.g. for pork: fläsk, kotlett, karré, bacon, skinka, revben. Give the common ones.'}}}},
  {name:'research_topics',description:'The research topics the user follows on arXiv: list them, add one, stop one, or save a standing preference about one (“skip surveys”, “more benchmarks”). The morning digest is built from these. Use this, not the schedule, when the user says to track or stop tracking a topic. Pass the topic as the user named it, abbreviations included (“RAG”): the tool works out which one they mean, so do not ask them first.',inputSchema:{type:'object',additionalProperties:false,required:['action'],properties:{
    action:{type:'string',enum:['list','add','remove','note']},
    topic:{type:'string',description:'For add: the topic in the user’s words. For remove and note: the topic’s name, id or common abbreviation.'},
    note:{type:'string',description:'For note: the preference written as a standing instruction, e.g. “skip survey papers; prefers new benchmarks”'},
    categories:{type:'array',maxItems:4,items:{type:'string'},description:'For add: arXiv categories such as cs.CL, only if the user named a field'}}}},
];

const offerLine=o=>({name:o.title,priceKr:o.price,...(o.was?{wasKr:o.was}:{}),...(o.percentOff?{percentOff:o.percentOff}:{}),...(o.unitPrice?{unit:o.unitPrice}:{}),...(o.needsLidlPlus?{needsLidlPlus:true}:{}),until:o.until,...(o.youLike?{userLikes:o.youLike}:{})});
export async function groceryOffers({find,limit=8}={},run=runScript){
  const r=await run('daylight_deals.py',['current','--limit',String(limit),...(find?['--find',find]:[])]);
  if(r.error)return {status:'unavailable',reason:r.error};
  const leftOut=(r.leftOut||[]).map(l=>({because:l.reason,count:l.count,examples:l.examples}));
  return {shop:'Lidl Sverige, national weekly offers',date:r.date,...(find?{lookedFor:find}:{}),offers:r.offers.map(offerLine),moreNotShown:r.moreNotShown,leftOutForThisUser:leftOut,
    preferencesApplied:{likes:r.likes,avoids:r.dislikes,rememberedFactsChecked:r.screenedByModel===true},
    howToAnswer:[plain,'One short line per offer: name, price, the previous price or percentage, last day. Offers the user likes first.',
      'Say once that these are Lidl Sverige’s weekly offers'+(r.moreNotShown?` and that ${r.moreNotShown} more exist.`:'.'),
      leftOut.length?'End with one line saying what was left out for them and why.':null,
      r.screenedByModel===true?null:'What you remember about the user was NOT checked against this list: leave out anything they avoid yourself and say so.',
      find&&!r.offers.length?'Nothing matched. Say so; if you searched an English word, try the Swedish one once.':null].filter(Boolean)};
}

export async function foodPreference({action,food,terms=[]},run=runScript,memory=readMemory){
  const label=String(food||'').trim();if(!label)throw Error('Name the food.');
  if(action==='forget'){
    const r=await run('daylight_deals.py',['forget',label]);
    const left=await run('daylight_deals.py',['prefs']);
    const stale=(await memory()).filter(e=>e.toLowerCase().includes(label.toLowerCase()));
    return {status:r.found?'forgotten':'was_not_stored',food:label,stillStored:{likes:left.likes.map(p=>p.label),avoids:left.dislikes.map(p=>p.label)},...(stale.length?{memoryEntriesNowOutOfDate:stale}:{}),
      howToAnswer:[plain,'Confirm in one sentence.',stale.length?'Your memory still holds the entries in memoryEntriesNowOutOfDate. Remove or replace each of them with your memory tool now; adding a second, contradicting entry is not enough.':null,r.found?null:'Nothing was stored under that name: if it is listed under another word in stillStored, call this tool again with that word.'].filter(Boolean)};
  }
  if(!['like','avoid'].includes(action))throw Error('action must be like, avoid or forget.');
  const words=[...new Set(terms.map(t=>String(t).trim().toLowerCase()).filter(Boolean))];
  const r=await run('daylight_deals.py',[action==='like'?'like':'dislike',label,...(words.length?['--terms',words.join(',')]:[])]);
  const stored=(r.likes||r.dislikes).find(p=>p.label.toLowerCase()===label.toLowerCase());
  return {status:'stored',[action==='like'?'likes':'avoids']:label,matchWords:stored?.terms||words,
    howToAnswer:[plain,'Confirm in one sentence what changes from now on (the daily offers and your answers).','Save the same fact with your memory tool if you have not yet.',words.length<2?'Only one match word is stored, so Swedish price tags may be missed: call again with the Swedish product words in terms.':null].filter(Boolean)};
}

const initials=name=>name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(w=>w[0]).join('');
// A topic named loosely by the user: its id, its name, its abbreviation, or words from its name.
export function findTopic(topics,wanted){
  const q=String(wanted||'').trim().toLowerCase();if(!q)return [];
  const exact=topics.filter(t=>t.id===q||t.name.toLowerCase()===q);if(exact.length)return exact;
  const short=topics.filter(t=>initials(t.name)===q.replace(/[^a-z0-9]/g,''));if(short.length)return short;
  const words=q.split(/[^a-z0-9]+/).filter(w=>w.length>2&&!['the','topic','papers','paper','research','about','new'].includes(w));
  return words.length?topics.filter(t=>words.every(w=>(t.name+' '+t.id).toLowerCase().includes(w))):[];
}
export async function researchTopics({action,topic,note,categories=[]},run=runScript){
  const listed=(await run('daylight_research.py',['list'])).topics||[];
  const brief=t=>({id:t.id,name:t.name,...(t.notes?.length?{preferences:t.notes}:{}),following_since:t.added});
  if(action==='list')return {topics:listed.map(brief),howToAnswer:[plain,listed.length?'Name each topic in one line, with its preferences if any.':'Say that no topic is followed yet and that they can name one.']};
  if(action==='add'){
    const name=String(topic||'').trim();if(!name)throw Error('Name the topic.');
    const already=findTopic(listed,name);if(already.length)return {status:'already_followed',topic:brief(already[0]),howToAnswer:[plain,'Say it is already followed.']};
    const r=await run('daylight_research.py',['add',name,...categories.flatMap(c=>['--category',c])]);
    return {status:'added',topic:brief(r.added),howToAnswer:[plain,'Confirm in one or two sentences: what is followed, and that new papers arrive with the morning research digest, the first one covering the past week.','Do not state a clock time for the digest.']};
  }
  if(!['remove','note'].includes(action))throw Error('action must be list, add, remove or note.');
  const found=findTopic(listed,topic);
  if(found.length!==1)return {status:found.length?'ambiguous':'no_such_topic',followed:listed.map(brief),howToAnswer:[plain,found.length?'Ask which of the matching topics they mean.':'Say that topic is not followed and name the ones that are.']};
  if(action==='remove'){await run('daylight_research.py',['remove',found[0].id]);return {status:'stopped',topic:found[0].name,stillFollowed:listed.filter(t=>t.id!==found[0].id).map(t=>t.name),howToAnswer:[plain,'Confirm in one sentence. The schedule itself is unchanged; do not touch it.']};}
  const text=String(note||'').trim();if(!text)throw Error('Give the preference to save.');
  const r=await run('daylight_research.py',['note',found[0].id,text]);
  return {status:'saved',topic:r.topic,preferences:r.notes,howToAnswer:[plain,'Confirm in one sentence what the next digest will do differently.','Do not fetch or list papers now.']};
}

export const everydayHandlers={grocery_offers:groceryOffers,food_preference:foodPreference,research_topics:researchTopics};
