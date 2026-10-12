import test from 'node:test';
import assert from 'node:assert/strict';
import {jobSearchProfile,jobMatches,jobApplicationAdvice,jobTools,jobHandlers} from '../mcp/job-tools.mjs';

const cvText='Maria Lind. Data scientist, six years. Python, SQL, PyTorch. Built demand forecasting models; led a team of three. '.repeat(3);
const match={id:'jobtech:1',title:'Data Scientist',employer:'Acme AB',place:'Stockholm',remote:false,url:'https://arbetsformedlingen.se/platsbanken/annonser/1',published:'2026-10-11',deadline:'2026-11-09',fit:86,meets:['Python: six years'],gaps:['No Azure'],found:'2026-10-12',source:'Arbetsförmedlingen Platsbanken'};
// A stand-in for the job script: records calls and answers in its shapes.
const script=(state={})=>{
  const calls=[],s={cv:state.cv??null,prefs:{roles:[],places:[],languages:[],avoid:[],notes:[],remote:'yes',country:'Sweden',seniority:null,...state.prefs},matches:state.matches||[]};
  const run=async(name,args,input)=>{
    calls.push({args:args.join(' '),input});assert.equal(name,'daylight_jobs.py');const [command,...rest]=args;
    if(command==='cv'){s.cv={name:rest[rest.indexOf('--name')+1],characters:input.length,added:'2026-10-12'};return {cv:s.cv};}
    if(command==='forget-cv'){s.cv=null;return {cv:null};}
    if(command==='prefs'){for(let i=0;i<rest.length;i+=2){const key=rest[i].slice(2);if(key==='note')s.prefs.notes.push(rest[i+1]);else s.prefs[key]=['roles','places','languages','avoid'].includes(key)?rest[i+1].split(','):rest[i+1];}return {prefs:s.prefs,cv:s.cv,changed:rest.length>0};}
    if(command==='current'){const ready=!!s.cv&&s.prefs.roles.length>0;return {ready,...(ready?{}:{missing:s.cv?'No roles are stated yet, so there is nothing to search for.':'No CV is stored yet.'}),cv:s.cv,prefs:s.prefs,matches:s.matches,moreNotShown:0,lastLooked:state.lastLooked??null,
      ...(rest.includes('--refresh')?{looked:{read:40,new:12,ruledOut:{'written in Swedish':7},judged:5,errors:[{source:'Himalayas',error:'timed out'}]}}:{}),errors:[]};}
    if(command==='show')return {match:{...match,posting:'We need Python and Azure.'},cv:cvText,wanted:'Roles wanted: data scientist'};
    if(command==='dismiss'){const had=s.matches.some(m=>m.id===rest[0]);s.matches=s.matches.filter(m=>m.id!==rest[0]);if(rest[2])s.prefs.notes.push(rest[2]);return {dismissed:had,title:had?match.title:null,notes:s.prefs.notes};}
    throw Error('unexpected '+command);
  };
  return {run,calls,s};
};

test('the job tools all have handlers, closed inputs, and nothing that applies or sends on the user’s behalf',()=>{
  assert.deepEqual(jobTools.map(t=>t.name).sort(),Object.keys(jobHandlers).sort());
  for(const tool of jobTools){assert.equal(tool.inputSchema.additionalProperties,false);assert.doesNotMatch(tool.name,/apply|submit|send|email/);}
});

test('a pasted CV is stored through standard input, and the watch says what it still needs',async()=>{
  const f=script();
  const stored=await jobSearchProfile({action:'store_cv',cvText,cvName:'maria.pdf'},f.run);
  assert.equal(f.calls[0].args,'cv --stdin --name maria.pdf');assert.equal(f.calls[0].input,cvText.trim());
  assert.equal(stored.status,'cv_stored');assert.equal(stored.cv.name,'maria.pdf');assert.equal(stored.watching,false);assert.match(stored.stillNeeded[0],/kind of role/);
  assert.ok(!JSON.stringify(stored).includes('Maria Lind'));  // the result carries facts about the CV, not its text
  await assert.rejects(jobSearchProfile({action:'store_cv',cvText:'short'},f.run),/too short/);
  const empty=await jobSearchProfile({action:'show'},script().run);assert.equal(empty.stillNeeded.length,2);assert.match(empty.stillNeeded[0],/upload it on the Daylight web page/);
});

test('only the preferences the user stated are changed, and the watch starts once CV and roles are there',async()=>{
  const f=script({cv:{name:'cv',characters:900,added:'2026-10-12'}});
  const r=await jobSearchProfile({action:'update',roles:['data scientist','ML engineer'],remote:'only',avoid:['consulting, agencies'],note:'prefers product companies'},f.run);
  assert.equal(f.calls[0].args,'prefs --roles data scientist,ML engineer --avoid consulting  agencies --remote only --note prefers product companies');
  assert.equal(r.status,'updated');assert.equal(r.watching,true);assert.equal(r.stillNeeded,undefined);
  assert.deepEqual(r.lookingFor.roles,['data scientist','ML engineer']);assert.deepEqual(r.lookingFor.places,[]);assert.match(r.howToAnswer.join(' '),/only when something fits/);
  await assert.rejects(jobSearchProfile({action:'update'},f.run),/Nothing to change/);await assert.rejects(jobSearchProfile({action:'erase'},f.run),/action/);
  assert.equal((await jobSearchProfile({action:'remove_cv'},f.run)).cv,null);
});

test('matches come back with their reasons, gaps, link and source; an empty result does not invite invention',async()=>{
  const f=script({cv:{name:'cv',characters:900,added:'x'},prefs:{roles:['data scientist']},matches:[match],lastLooked:'2026-10-12T08:00:00+00:00'});
  const listed=await jobMatches({action:'list'},f.run);
  assert.equal(f.calls[0].args,'current --limit 5');
  assert.deepEqual(listed.matches[0],{id:'jobtech:1',title:'Data Scientist',employer:'Acme AB',place:'Stockholm',fit:86,whyItFits:['Python: six years'],gaps:['No Azure'],published:'2026-10-11',applyBy:'2026-11-09',link:match.url,source:'Arbetsförmedlingen Platsbanken'});
  assert.match(listed.howToAnswer.join(' '),/keep the link/);assert.equal(listed.thisLook,undefined);
  const looked=await jobMatches({action:'look_now',limit:3},f.run);
  assert.equal(f.calls[1].args,'current --limit 3 --refresh');
  assert.deepEqual(looked.thisLook,{postingsRead:40,newSinceLastLook:12,ruledOutByPreferences:{'written in Swedish':7},judgedAgainstCv:5,sourceProblems:['Himalayas']});
  const none=await jobMatches({action:'list'},script({cv:{name:'cv',characters:900,added:'x'},prefs:{roles:['x']}}).run);
  assert.equal(none.status,'no_matches');assert.match(none.howToAnswer.join(' '),/Do not suggest postings of your own/);assert.match(none.howToAnswer.join(' '),/offer to look now/);
  const unset=await jobMatches({action:'list'},script().run);assert.equal(unset.status,'not_set_up');assert.match(unset.reason,/No CV/);
});

test('dismissing a match keeps the reason as a standing note',async()=>{
  const f=script({cv:{name:'cv',characters:900,added:'x'},prefs:{roles:['x']},matches:[match]});
  const r=await jobMatches({action:'dismiss',id:'jobtech:1',why:'not interested in consulting'},f.run);
  assert.equal(f.calls[0].args,'dismiss jobtech:1 --why not interested in consulting');assert.equal(r.status,'dismissed');assert.deepEqual(r.standingNotes,['not interested in consulting']);
  assert.equal((await jobMatches({action:'dismiss',id:'jobtech:1'},f.run)).status,'no_such_match');
  await assert.rejects(jobMatches({action:'dismiss'},f.run),/id/);
});

test('advice is given the posting, the CV and rules that forbid inventing experience',async()=>{
  const r=await jobApplicationAdvice({id:'jobtech:1'},script().run);
  assert.equal(r.posting,'We need Python and Azure.');assert.ok(r.cv.includes('Maria Lind'));assert.deepEqual(r.job.gaps,['No Azure']);
  const rules=r.rulesForAdvice.join(' ');
  assert.match(rules,/Never suggest adding a skill/);assert.match(rules,/as a gap, plainly/);assert.match(rules,/Ask the user whether they have that experience/);
  await assert.rejects(jobApplicationAdvice({},script().run),/id/);
});
