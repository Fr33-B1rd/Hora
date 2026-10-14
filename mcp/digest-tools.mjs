// Re-posting a digest. The scheduled jobs already wrote, checked and delivered
// their messages; Hermes keeps each run, with the message it sent, under
// cron/output/<job id>/. This tool hands the newest one back, unchanged, so that
// “paste today's research digest here” needs no new fetching and repeats nothing new.
import {readFile,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {dateInStockholm} from '../lib/time.mjs';

const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables.';
const jobNames={research:'daylight-research-feed',groceries:'daylight-grocery-deals',jobs:'daylight-job-matches'};
const titles={research:'research digest',groceries:'grocery offers message',jobs:'job matches message'};
export const hermesHome=()=>process.env.HERMES_HOME||join(homedir(),'.hermes');
export const digestTools=[
  {name:'latest_digest',description:'The newest message one of the scheduled jobs delivered, word for word: the research digest, the grocery offers, or the job matches. Use it when someone asks to see or repost a digest (“paste today’s research digest here”, “what did this morning’s papers say?”) instead of looking anything up again.',inputSchema:{type:'object',additionalProperties:false,required:['digest'],properties:{
    digest:{type:'string',enum:['research','groceries','jobs']}}}},
];

// The message a saved run delivered: the part of the file after “## Response”.
export function deliveredText(file){
  const at=file.search(/^## Response\s*$/m);if(at<0)return null;
  const text=file.slice(at).replace(/^## Response\s*$/m,'').trim();
  return text||null;
}
const runTime=name=>{const m=/^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)-(\d\d)\.md$/.exec(name);return m?{date:m[1],time:`${m[2]}:${m[3]}`}:null;};

export async function latestDigest({digest},{home=hermesHome(),today=dateInStockholm()}={}){
  if(!jobNames[digest])throw Error('digest must be research, groceries or jobs.');
  let jobs;try{jobs=JSON.parse(await readFile(join(home,'cron','jobs.json'),'utf8'));}catch{jobs={};}
  const job=(Array.isArray(jobs)?jobs:jobs.jobs||[]).find(j=>j.name===jobNames[digest]);
  if(!job)return {status:'no_such_job',howToAnswer:[plain,`Say the ${titles[digest]} is not set up.`]};
  let runs=[];try{runs=(await readdir(join(home,'cron','output',job.id))).filter(runTime).sort().reverse();}catch{/* never run */}
  // Runs that found nothing new end in [SILENT]: they are skipped, but the newest one is noted.
  let quietSince=null;
  for(const name of runs){
    const text=deliveredText(await readFile(join(home,'cron','output',job.id,name),'utf8'));
    if(!text)continue;
    if(/^\[SILENT\]$/.test(text)){quietSince??=runTime(name);continue;}
    const when=runTime(name),fresh=when.date===today;
    return {status:'found',digest,deliveredOn:when.date,at:when.time,today:fresh,...(quietSince&&!fresh?{nothingNewSince:quietSince.date}:{}),text,
      howToAnswer:[plain,'Post the text exactly as it is: do not add, drop, reorder or re-describe anything in it, and keep every link.',
        fresh?'You may add one short line before it, such as “Here is this morning’s research digest.”':`Before it, say in one line that this is the digest from ${when.date}${quietSince?', and that the runs since then found nothing new':', and that there has been none since'}.`]};
  }
  return {status:'none_yet',...(quietSince?{nothingNewOn:quietSince.date}:{}),howToAnswer:[plain,quietSince?`Say the ${titles[digest]} has run but found nothing new to send, most recently on ${quietSince.date}.`:`Say there is no ${titles[digest]} yet: it has not run since it was set up.`]};
}

export const digestHandlers={latest_digest:args=>latestDigest(args)};
