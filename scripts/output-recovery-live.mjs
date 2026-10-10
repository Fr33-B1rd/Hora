import {mkdirSync,readFileSync,writeFileSync,cpSync,existsSync} from 'node:fs';
import {runAgent} from '../lib/agent.mjs';
import {requestModel,outputPolicy,actorSampling} from '../lib/model-call.mjs';
const root='artifacts/output-recovery-20261008';
if(existsSync(root+'/protocol.json'))throw Error('Preserve existing run; choose a new directory for a new acceptance.');
mkdirSync(root,{recursive:true});
const save=(name,data)=>writeFileSync(root+'/'+name,JSON.stringify(data,null,2));
const original=JSON.parse(readFileSync('artifacts/repair-regression-20261008-r4/protocol.json'));
const start=original.scenarios.find(s=>s.id==='budget').raw;
const texts=[start.text,'改一下，预算最多500瑞典克朗，全程步行最多10分钟。先只更新条件并告诉我记住了什么，不要生成行程。','先不要搜索或安排，把已经记住的预算、步行限制和活动选择复述一下。'];
save('protocol.json',{scope:'Three independent three-turn conversations using real configured model and synthetic saved state. No live business services. Plus one deliberately truncated generation to test recovery.',repeats:3,texts,start,outputPolicy,actorSampling,intakeTemperature:.2,noCalendarWrites:true});
cpSync('lib',root+'/snapshot/lib',{recursive:true});cpSync('agent',root+'/snapshot/agent',{recursive:true});cpSync(import.meta.filename,root+'/runner-snapshot.mjs');
const config={base:process.env.NEBIUS_BASE_URL,key:process.env.NEBIUS_API_KEY,model:'nvidia/nemotron-3-super-120b-a12b'};
// The deliberately tiny allowance tests the actual provider's length outcome,
// not a fabricated HTTP failure. No returned tool is executed in this test.
const replay=JSON.parse(readFileSync('artifacts/output-budget-20261008/protocol.json')).cases.find(c=>c.id==='rep3-turn3').request;
const attempts=[],retries=[];let recovery;
try{const message=await requestModel(config,{...replay,...actorSampling},{policy:{...outputPolicy,initialMaxTokens:16},deadline:Date.now()+100000,onAttempt:r=>attempts.push(r),onRetry:r=>retries.push(r)});recovery={message,attempts,retries};}catch(e){recovery={error:{code:e.code||e.name,message:e.message},attempts,retries};}
save('forced-recovery.json',recovery);console.log(JSON.stringify({forcedRecovery:!recovery.error,attempts:attempts.map(a=>({maxTokens:a.maxTokens,finishReason:a.finishReason,error:a.errorCode})),retries:retries.length}));
const results=[];
for(let rep=1;rep<=3;rep++){
 let slots=structuredClone(start.slots),history=structuredClone(start.history);
 for(const [i,text] of texts.entries()){
  const audit=[];const result=await runAgent({text,slots,history},config,{}, {onDiagnostic:e=>audit.push(e)});
  const row={rep,turn:i+1,text,result,audit};results.push(row);save('turns.json',results);
  console.log(JSON.stringify({rep,turn:i+1,stop:result.stopReason,retries:audit.filter(e=>e.kind==='model_retry').length,budgetMode:result.slots.budgetMode,budget:result.slots.budget,maxWalking:result.slots.maxWalking,timeMode:result.slots.timeMode,message:result.message}));
  slots=result.slots;history.push({role:'user',content:text},{role:'assistant',content:result.message.slice(0,1000)});history=history.slice(-12);
 }
}
const summary=[1,2,3].map(rep=>{const rs=results.filter(r=>r.rep===rep),last=rs.at(-1).result.slots;return {rep,allFinished:rs.every(r=>r.result.stopReason==='finished'),initialUnlimited:rs[0].result.slots.budgetMode==='unlimited',retained:last.budget===500&&last.budgetMode==='limited'&&last.maxWalking===10&&last.transport==='transit'&&last.activities.length===3,timeMode:last.timeMode,retries:rs.reduce((n,r)=>n+r.audit.filter(e=>e.kind==='model_retry').length,0)};});
save('summary.json',summary);console.log(JSON.stringify(summary));
