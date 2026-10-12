// Runs the assistant's evaluation set against the running Hermes agent.
//   node --env-file=.env scripts/eval-assistant.mjs [--label name] [--only id,id] [--area groceries]
//                                                   [--repeat 2] [--compare artifacts/evals/<older>.json]
// Uses the real model and real data sources, so it costs tokens and takes minutes.
// Your memory, food preferences and research topics are copied aside first and
// put back afterwards, also after Ctrl+C. So is the schedule, and a conversation
// that changes it fails.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {cases} from '../evals/cases.mjs';
import {createReplyReader,protectState,seedState,readState,restoreSchedule,seedCalendar,readCalendar,everyReply} from '../evals/harness.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:null;};
const root=fileURLToPath(new URL('..',import.meta.url));
const home=process.env.DAYLIGHT_HERMES_HOME||join(homedir(),'.hermes');
const api=(process.env.HERMES_API_URL||'http://127.0.0.1:8642').replace(/\/$/,''),key=process.env.HERMES_API_KEY;
const dataDirectory=process.env.DAYLIGHT_DATA_DIR||join(root,'data');
const label=option('label')||'run',repeat=Math.max(1,Number(option('repeat'))||1);
const only=option('only')?.split(','),area=option('area');
const chosen=cases.filter(c=>(!only||only.includes(c.id))&&(!area||c.area===area));
if(!key){console.error('HERMES_API_KEY is not set (run with --env-file=.env).');process.exit(2);}
if(!chosen.length){console.error('No case matches.');process.exit(2);}

async function ask(text,session){
  const started=Date.now();
  const response=await fetch(api+'/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(240000),
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','X-Hermes-Session-Id':session},
    body:JSON.stringify({model:'hermes-agent',stream:true,messages:[{role:'user',content:text}]})});
  if(!response.ok)throw Error('assistant returned '+response.status);
  const reader=createReplyReader();for await(const chunk of response.body)reader.push(chunk);
  return {...reader.done(),seconds:Math.round((Date.now()-started)/100)/10};
}
const latestPlan=async since=>{const file=join(dataDirectory,'plans','latest.json');try{if((await stat(file)).mtimeMs<since)return null;return JSON.parse(await readFile(file,'utf8'));}catch{return null;}};

// The stand-in calendar's file, when the assistant under test was started with one (see evals/README in VALIDATION.md).
const calendarFile=process.env.DAYLIGHT_EVAL_CALENDAR||null;
const pause=seconds=>new Promise(resolve=>setTimeout(resolve,seconds*1000));
async function runCase(c,base,round){
  if(c.area==='calendar'&&!calendarFile)return {id:c.id,area:c.area,passed:false,skipped:true,problems:['skipped: needs the stand-in calendar (set DAYLIGHT_EVAL_CALENDAR)'],replies:[],seconds:0,tokens:0,toolCalls:0};
  await seedState(home,base,c.seed);await seedCalendar(calendarFile,c.seed?.calendar);
  const before=await readState(home),started=Date.now(),replies=[],stamp=started.toString(36);
  let conversation=0;
  try{
    for(const turn of c.turns){if(turn.fresh)conversation++;if(turn.after)await pause(turn.after);  // a person takes a moment to read and answer
      const reply=await ask(turn.say,`eval-${c.id}-${stamp}-${round}-${conversation}`);replies.push({say:turn.say,...reply,calendar:await readCalendar(calendarFile)});}
  }catch(error){return {id:c.id,area:c.area,passed:false,problems:['did not finish: '+(error.name==='TimeoutError'?'no reply within 4 minutes':error.message)],replies,seconds:(Date.now()-started)/1000,tokens:0,toolCalls:0};}
  const ctx={replies,last:replies.at(-1),state:await readState(home),before,plan:await latestPlan(started),calendar:await readCalendar(calendarFile)};
  // No conversation in this set asks for a change to the schedule.
  const scheduleChanged=JSON.stringify(ctx.state.jobs)!==JSON.stringify(before.jobs);
  if(scheduleChanged)await restoreSchedule(home,backupDirectory);
  const problems=[...(scheduleChanged?[`changed the user’s scheduled jobs without being asked: ${before.jobs.join(', ')||'none'} → ${ctx.state.jobs.join(', ')||'none'}`]:[]),...replies.flatMap((r,i)=>everyReply.map(check=>check(r)).filter(Boolean).map(p=>(replies.length>1?`turn ${i+1}: `:'')+p)),...c.check(ctx)];
  return {id:c.id,area:c.area,passed:!problems.length,problems,
    replies:replies.map(r=>({say:r.say,calendarWrites:r.calendar?.writes??null,text:r.text,tools:r.tools.map(t=>t.tool+(t.label?': '+t.label.slice(0,160):'')),seconds:r.seconds,promptTokens:r.usage?.prompt_tokens??null})),
    seconds:Math.round(replies.reduce((n,r)=>n+r.seconds,0)*10)/10,tokens:replies.reduce((n,r)=>n+(r.usage?.prompt_tokens||0),0),toolCalls:replies.reduce((n,r)=>n+r.tools.length,0),
    wrote:{memory:ctx.state.memory!==before.memory,likes:ctx.state.likes.map(p=>p.label),dislikes:ctx.state.dislikes.map(p=>p.label+' ['+p.terms.join(',')+']'),topics:ctx.state.topics.map(t=>t.name+(t.notes.length?' ('+t.notes.join('; ')+')':'')),planRequest:ctx.plan?.request||null}};
}

const health=await fetch(api+'/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.ok,()=>false);
if(!health){console.error('The assistant is not running at '+api+'. Start the Hermes gateway first.');process.exit(2);}
const backupDirectory=join(dataDirectory,'eval-backup');
const guard=await protectState(home,backupDirectory);
if(guard.recovered)console.log('Restored state left behind by an interrupted run.');
let restored=false;const restore=async()=>{if(!restored){restored=true;await guard.restore();}};
process.on('SIGINT',async()=>{await restore();console.log('\nInterrupted; your state was put back.');process.exit(130);});

const results=[];
try{
  const real=await readState(home),base={deals:{seen:real.deals.seen||{},cache:real.deals.cache||null},research:{seen:real.research.seen||{},lastBatch:real.research.lastBatch||null}};
  console.log(`${chosen.length} conversations × ${repeat}, against ${api}\n`);
  for(let round=1;round<=repeat;round++)for(const c of chosen){
    const r=await runCase(c,base,round);results.push({...r,round});
    console.log(`${r.passed?'pass':'FAIL'}  ${c.id.padEnd(30)} ${String(r.seconds).padStart(6)} s  ${String(r.toolCalls).padStart(2)} tools  ${String(Math.round(r.tokens/1000)).padStart(4)}k tokens in`);
    for(const p of r.problems)console.log('        - '+p);
  }
}finally{await restore();}

const byCase=chosen.map(c=>{const runs=results.filter(r=>r.id===c.id);return {id:c.id,area:c.area,passes:runs.filter(r=>r.passed).length,runs:runs.length};});
const passed=results.filter(r=>r.passed).length,median=list=>{const s=[...list].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};
const turns=results.flatMap(r=>r.replies);
const summary={label,at:new Date().toISOString(),conversations:results.length,passed,medianSecondsPerTurn:median(turns.map(t=>t.seconds)),slowestTurnSeconds:Math.max(0,...turns.map(t=>t.seconds)),medianPromptTokensPerTurn:median(turns.map(t=>t.promptTokens||0)),byArea:Object.fromEntries([...new Set(chosen.map(c=>c.area))].map(a=>[a,results.filter(r=>r.area===a&&r.passed).length+'/'+results.filter(r=>r.area===a).length]))};
console.log(`\n${passed}/${results.length} passed · median ${summary.medianSecondsPerTurn} s per turn, slowest ${summary.slowestTurnSeconds} s · median ${Math.round(summary.medianPromptTokensPerTurn/1000)}k prompt tokens per turn`);
console.log(Object.entries(summary.byArea).map(([a,s])=>a+' '+s).join(' · '));
if(option('compare')){
  const older=JSON.parse(await readFile(option('compare'),'utf8')),was=Object.fromEntries(older.byCase.map(c=>[c.id,c]));
  const changed=byCase.filter(c=>was[c.id]&&(was[c.id].passes/was[c.id].runs)!==(c.passes/c.runs));
  console.log(`\nAgainst “${older.summary.label}” (${older.summary.passed}/${older.summary.conversations}):`+(changed.length?'':' no case changed.'));
  for(const c of changed)console.log(`  ${c.id}: ${was[c.id].passes}/${was[c.id].runs} → ${c.passes}/${c.runs}`);
}
const out=join(root,'artifacts','evals');await mkdir(out,{recursive:true});
const file=join(out,`assistant-${label}-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`);
await writeFile(file,JSON.stringify({summary,byCase,results},null,1));
console.log('\nSaved '+file);
process.exit(passed===results.length?0:1);
