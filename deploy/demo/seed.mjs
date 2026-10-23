// The demo profile for judges: Maria Lind, a fictional data scientist in Stockholm.
// Writes her memory, job search, research topics, food preferences, to-do list and a
// stand-in calendar into the demo instance. Run again to reset what visitors changed;
// what the scheduled jobs already found (job matches, offers, papers) is kept.
//
//   node deploy/demo/seed.mjs <demo Hermes home> <demo data dir>
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dateInStockholm,nextDate,instant} from '../../lib/time.mjs';

const SEPARATOR='\n§\n';
const here=dirname(fileURLToPath(import.meta.url));
const readJson=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return {};}};
const write=async(file,text)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,text,'utf8');};

export const profile={
  memory:['The user is Maria Lind, a data scientist living in Stockholm (fictional demo profile).','Maria is looking for a new data science or machine learning role in Stockholm or remote.','Maria usually sets off from Fridhemsplan and prefers walking short distances.'],
  notes:['This is the shared demo instance for hackathon judges. Its calendar is a stand-in, not a real Google Calendar.'],
  dislikes:[{label:'pork',terms:['pork','fläsk','bacon','skinka']}],
  likes:[{label:'salmon',terms:['salmon','lax']}],
  topics:[{id:'retrieval-augmented-generation',name:'Retrieval-augmented generation',query:'(ti:retrieval OR abs:retrieval) AND (ti:augmented OR abs:augmented) AND (ti:generation OR abs:generation)',categories:['cs.CL']},
    {id:'time-series-forecasting',name:'Time-series forecasting',query:'(ti:time-series OR abs:time-series) AND (ti:forecasting OR abs:forecasting)',categories:['cs.LG']}],
  todos:['Update the portfolio with the forecasting project','Reply to the recruiter at Nordbutik'],
  prefs:{roles:['data scientist','machine learning engineer'],places:['Stockholm'],languages:['English'],avoid:['gambling'],notes:[],remote:'yes',country:'Sweden',seniority:null},
  // Days are counted from the reset day, so the calendar always looks like this week.
  calendar:[{day:1,title:'Interview prep with mentor',start:'09:00',end:'10:00'},{day:1,title:'Lunch with Sam',start:'12:00',end:'13:00'},
    {day:2,title:'Team stand-up',start:'09:30',end:'09:45'},{day:3,title:'Dentist',start:'15:00',end:'16:00'}],
};

export async function seed(home,dataDir,today=dateInStockholm()){
  const pref=p=>({label:p.label,terms:p.terms,since:today});
  await write(join(home,'memories/USER.md'),profile.memory.join(SEPARATOR));
  await write(join(home,'memories/MEMORY.md'),profile.notes.join(SEPARATOR));
  const deals=await readJson(join(home,'daylight/deals.json'));
  await write(join(home,'daylight/deals.json'),JSON.stringify({seen:{},...deals,likes:profile.likes.map(pref),dislikes:profile.dislikes.map(pref)},null,1));
  const research=await readJson(join(home,'daylight/research.json'));
  await write(join(home,'daylight/research.json'),JSON.stringify({seen:{},lastBatch:null,...research,topics:profile.topics.map(t=>({...t,notes:[],added:today,lastChecked:research.topics?.find(o=>o.id===t.id)?.lastChecked||null}))},null,1));
  await write(join(home,'daylight/todos.json'),JSON.stringify({next:profile.todos.length,lists:{me:profile.todos.map((text,i)=>({id:i+1,text,by:'Maria',added:today,due:null,done:null}))}},null,1));
  const career=await readJson(join(home,'daylight/jobs.json')),cv=await readFile(join(here,'cv-maria-lind.md'),'utf8');
  await write(join(home,'daylight/jobs.json'),JSON.stringify({seen:{},matches:[],sent:{},remote:null,lastRun:null,errors:[],...career,
    cv:{name:'cv-maria-lind.md',text:cv,added:today},prefs:profile.prefs},null,1));
  let date=today;const days=[today];for(let i=0;i<7;i++)days.push(date=nextDate(date));
  const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
  const events=Object.fromEntries(profile.calendar.map((e,i)=>['seed'+i,{id:'seed'+i,summary:e.title,etag:'s'+i,start:{dateTime:instant(days[e.day],minutes(e.start))},end:{dateTime:instant(days[e.day],minutes(e.end))}}]));
  await write(join(dataDir,'provider.json'),JSON.stringify({events,writes:0}));
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [home,dataDir]=process.argv.slice(2);
  if(!home||!dataDir){console.error('usage: node deploy/demo/seed.mjs <demo Hermes home> <demo data dir>');process.exit(2);}
  await seed(home,dataDir);
  console.log(`Demo profile written: Maria Lind, ${profile.topics.length} research topics, ${profile.calendar.length} calendar entries.`);
}
