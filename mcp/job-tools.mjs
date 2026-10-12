// Job-seeker tools for conversation. Like the everyday tools they run the same
// script as the scheduled job, so what the user asks in chat and what the
// background watch finds are one state. The model never decides whether a
// posting fits (the script's screening does) and may never invent experience:
// the advice tool hands it the posting, the CV and the rules together.
import {runScript} from './everyday-tools.mjs';

const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables.';
const list={type:'array',maxItems:12,items:{type:'string'}};
export const jobTools=[
  {name:'job_search_profile',description:'What the job watch looks for: the user’s CV and their preferences (roles, places, remote work, working languages, things to avoid, level). Use it to show the profile, to change a preference the user states (“only remote”, “not consulting firms”, “I’m also open to ML engineer roles”), or to store a CV the user pasted as text in the conversation. To reject one particular match (“drop the Acme one”), use job_matches with dismiss instead, even when the user adds a general reason. Pass only what the user said; leave the rest out and it stays as it is.',inputSchema:{type:'object',additionalProperties:false,required:['action'],properties:{
    action:{type:'string',enum:['show','update','store_cv','remove_cv']},
    roles:{...list,description:'Job titles to search for, in the user’s words, e.g. “data scientist”. Replaces the current list.'},
    places:{...list,description:'Towns or regions they would work in, e.g. “Stockholm”. Empty list means anywhere.'},
    remote:{type:'string',enum:['yes','no','only'],description:'yes: remote roles are welcome too; no: on-site only; only: remote roles only'},
    languages:{...list,description:'Languages they can work in, e.g. English, Swedish'},
    avoid:{...list,description:'Words that rule a posting out when they appear in it: employers, industries, kinds of role'},
    seniority:{type:'string',description:'The level they want, in their words'},
    country:{type:'string',description:'Country they live in, for remote roles that restrict where applicants may be'},
    note:{type:'string',description:'A standing preference that is not a simple list, e.g. “prefers product companies over agencies”'},
    cvText:{type:'string',description:'For store_cv: the full CV text exactly as the user pasted it'},
    cvName:{type:'string',description:'For store_cv: a short name for it'}}}},
  {name:'job_matches',description:'Job postings that fit the user’s CV and preferences, found by the background watch (Sweden’s public job listings and remote-job boards). Use for “any jobs for me?”, “what did you find?”. look_now searches again before answering and takes up to a minute. dismiss drops one match the user rejects (“drop the Acme one”, “not that one”): list first if you do not have its id, and pass their reason as why so it applies to future postings.',inputSchema:{type:'object',additionalProperties:false,required:['action'],properties:{
    action:{type:'string',enum:['list','look_now','dismiss']},
    id:{type:'string',description:'For dismiss: the match’s id from the list'},
    why:{type:'string',description:'For dismiss: the user’s reason, written as a standing preference (“not interested in defence”)'},
    limit:{type:'integer',minimum:1,maximum:10,description:'How many matches to return; default 5'}}}},
  {name:'job_application_advice',description:'Everything needed to advise the user on applying for one matched job: the full posting, their CV, and the rules for the advice. Use when they ask how to adapt their CV for a job, whether to apply, or what they are missing.',inputSchema:{type:'object',additionalProperties:false,required:['id'],properties:{
    id:{type:'string',description:'The match’s id from job_matches'}}}},
];

const matchLine=m=>({id:m.id,title:m.title,employer:m.employer,place:m.place,...(m.remote?{remote:true}:{}),fit:m.fit,whyItFits:m.meets||[],gaps:m.gaps||[],published:m.published,...(m.deadline?{applyBy:m.deadline}:{}),link:m.url,source:m.source});
const profileView=r=>({cv:r.cv?{name:r.cv.name,added:r.cv.added,characters:r.cv.characters}:null,lookingFor:{roles:r.prefs.roles,places:r.prefs.places,remote:r.prefs.remote,languages:r.prefs.languages,avoid:r.prefs.avoid,level:r.prefs.seniority,livesIn:r.prefs.country,notes:r.prefs.notes}});
const missing=p=>[!p.cv&&'a CV (they can upload it on the Daylight web page under “What I know”, or paste the text here)',!p.lookingFor.roles.length&&'the kind of role they want'].filter(Boolean);

export async function jobSearchProfile(args,run=runScript){
  const {action}=args;
  if(action==='store_cv'){
    const text=String(args.cvText||'').trim();if(text.length<200)throw Error('That is too short to be a CV. Ask the user to paste the whole text or upload the file on the web page.');
    await run('daylight_jobs.py',['cv','--stdin','--name',String(args.cvName||'CV (pasted)').slice(0,60)],text);
  }else if(action==='remove_cv')await run('daylight_jobs.py',['forget-cv']);
  else if(action!=='show'&&action!=='update')throw Error('action must be show, update, store_cv or remove_cv.');
  const flags=[];
  if(action==='update'){
    for(const key of ['roles','places','languages','avoid'])if(Array.isArray(args[key]))flags.push('--'+key,args[key].map(v=>String(v).replace(/,/g,' ').trim()).filter(Boolean).join(','));
    for(const key of ['remote','seniority','country','note'])if(typeof args[key]==='string'&&args[key].trim())flags.push('--'+key,args[key].trim());
    if(!flags.length)throw Error('Nothing to change was given.');
  }
  const view=profileView(await run('daylight_jobs.py',['prefs',...flags])),need=missing(view);
  return {status:action==='show'?'shown':action==='remove_cv'?'cv_removed':action==='store_cv'?'cv_stored':'updated',...view,
    watching:need.length?false:true,...(need.length?{stillNeeded:need}:{}),
    howToAnswer:[plain,action==='show'?'Summarise what is stored in a few short lines.':'Confirm in one or two sentences what changed.',
      need.length?'The watch cannot start yet: say what is still needed, in one sentence.':action==='show'?null:'Say that postings are checked against this in the background and they will hear only when something fits.',
      action==='store_cv'?'A new CV means every posting is judged afresh, so earlier matches are cleared.':null,
      'Never state anything about the CV’s content that is not in this result.'].filter(Boolean)};
}

export async function jobMatches({action,id,why,limit=5},run=runScript){
  if(action==='dismiss'){
    if(!id)throw Error('Give the id of the match to dismiss.');
    const r=await run('daylight_jobs.py',['dismiss',id,...(why&&why.trim()?['--why',why.trim()]:[])]);
    return {status:r.dismissed?'dismissed':'no_such_match',title:r.title||null,standingNotes:r.notes,howToAnswer:[plain,r.dismissed?'Confirm in one sentence'+(why?', including that the reason will be applied to future postings.':'.'):'Say that match is not in the list any more.']};
  }
  if(!['list','look_now'].includes(action))throw Error('action must be list, look_now or dismiss.');
  const r=await run('daylight_jobs.py',['current','--limit',String(limit),...(action==='look_now'?['--refresh']:[])]);
  if(!r.ready)return {status:'not_set_up',reason:r.missing,howToAnswer:[plain,'Say what is missing in one sentence. A CV can be uploaded on the Daylight web page under “What I know”, or pasted here as text.']};
  const looked=r.looked?{postingsRead:r.looked.read,newSinceLastLook:r.looked.new,ruledOutByPreferences:r.looked.ruledOut,judgedAgainstCv:r.looked.judged,sourceProblems:(r.looked.errors||[]).map(e=>e.source||e.error)}:undefined;
  return {status:r.matches.length?'matches':'no_matches',matches:r.matches.map(matchLine),moreNotShown:r.moreNotShown,lastLooked:r.lastLooked,...(looked?{thisLook:looked}:{}),
    howToAnswer:[plain,
      r.matches.length?'Best fit first. For each: title, employer and place on one line; then one line on why it fits and one on the main gap, taken from whyItFits and gaps; then the link on its own line. At most three unless asked for more.':'Say plainly that nothing fits yet. Do not suggest postings of your own.',
      looked?'Say in one line how many postings were read and how many were ruled out, so they can see the search happened.':r.lastLooked?null:'No search has run yet: offer to look now.',
      'whyItFits and gaps were judged against their CV; do not add reasons of your own. Fit is an estimate, not a prediction of getting the job.',
      'Each posting belongs to its source: keep the link.'].filter(Boolean)};
}

export async function jobApplicationAdvice({id},run=runScript){
  if(!id)throw Error('Give the id of the match.');
  const r=await run('daylight_jobs.py',['show',id]);
  return {job:matchLine(r.match),posting:r.match.posting,cv:r.cv,whatTheyWant:r.wanted,
    rulesForAdvice:[
      'Only use experience, skills and facts that are in the CV above. Never suggest adding a skill, tool, title, number or qualification the CV does not contain, and never suggest wording that implies one.',
      'Advice may reorder sections, move matching experience up, rename a heading, tighten a sentence, or use the posting’s own term for something the CV already describes in other words. Quote the CV line you mean.',
      'List each requirement of the posting the CV does not show as a gap, plainly. For a gap, the honest options are: say nothing, or address it in the cover letter if they have something true to say. Ask the user whether they have that experience rather than assuming.',
      'If the gaps are serious, say so and say whether applying still makes sense.'],
    howToAnswer:[plain,'Three short parts: what to bring forward (two or three concrete changes, each naming the CV line), what is missing (the gaps), and one sentence on whether to apply.','Under 1200 characters. Do not rewrite the whole CV.']};
}

export const jobHandlers={job_search_profile:jobSearchProfile,job_matches:jobMatches,job_application_advice:jobApplicationAdvice};
