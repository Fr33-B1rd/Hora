// Replay only saved fictional model requests; no business tools are executed.
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateArguments} from '../lib/agent-tools.mjs';
const root=resolve('artifacts/output-sampling-20261008');
const json=(name,value)=>writeFileSync(join(root,name),JSON.stringify(value,null,2));
const hash=s=>createHash('sha256').update(s).digest('hex');
if(process.argv.includes('--prepare')){
 assert.ok(!existsSync(join(root,'protocol.json')),'Do not overwrite a frozen run');mkdirSync(root,{recursive:true});
 const previous=JSON.parse(readFileSync('artifacts/repair-multiturn-20261008/turns.json'));
 const cases=previous.filter(r=>[1,3].includes(r.rep)&&[2,3].includes(r.turn)).map(r=>({id:`rep${r.rep}-turn${r.turn}`,originalStop:r.result.stopReason,request:r.audit.find(e=>e.kind==='model_request'&&e.stage==='model').body}));
 assert.equal(cases.length,4);
 const schedule=[];for(let rep=1;rep<=3;rep++)for(let i=0;i<cases.length;i++)for(let j=0;j<2;j++){const arm=['current','recommended'][(j+i+rep)%2];schedule.push({id:`${cases[i].id}-${arm}-${rep}`,caseId:cases[i].id,cap:4096,arm,rep});}
 copyFileSync('lib/model-response.mjs',join(root,'parser.mjs'));
 json('protocol.json',{scope:'Exploratory fixed-request replay: two previously failed and two successful synthetic conversation contexts; 3 repeats x 2 sampling profiles x 4 contexts. No tool execution, no real user data. Measures generation reliability, not whole-agent success.',cases,schedule,timeoutMs:75000,concurrency:3,model:cases[0].request.model,changed:'Fixed 4096 tokens. Current temperature .2 and default top_p versus NVIDIA recommended temperature 1.0/top_p .95. Same messages/tools and usage reporting. No reasoning-control change.',stopping:'All 24 trials, unless auth/payment failure, 5 consecutive 429s, or 20 minutes. Preserve failures; no retry in comparison.',parserHash:hash(readFileSync(join(root,'parser.mjs'))),inputHashes:Object.fromEntries(cases.map(c=>[c.id,hash(JSON.stringify(c.request))]))});
 copyFileSync(import.meta.filename,join(root,'runner-snapshot.mjs'));console.log('Prepared 24 sampling trials.');
}else if(process.argv.includes('--run')){
 const p=JSON.parse(readFileSync(join(root,'protocol.json')));assert.equal(hash(readFileSync(join(root,'parser.mjs'))),p.parserHash);
 const {modelResponse}=await import(pathToFileURL(join(root,'parser.mjs')));
 const base=process.env.NEBIUS_BASE_URL?.replace(/\/$/,''),key=process.env.NEBIUS_API_KEY;assert.ok(base&&key);
 let cursor=0,halt=null,rateLimits=0;const started=Date.now();
 async function worker(){while(cursor<p.schedule.length&&!halt){
  if(Date.now()-started>1200000){halt='time limit';break;}
  const task=p.schedule[cursor++];if(existsSync(join(root,task.id+'.json')))continue;
  const c=p.cases.find(c=>c.id===task.caseId),row={...task,startedAt:new Date().toISOString()},t=Date.now();
  const request={...c.request,max_tokens:task.cap,stream:true,stream_options:{include_usage:true},temperature:task.arm==='recommended'?1:.2,...(task.arm==='recommended'?{top_p:.95}:{})};
  try{
   const r=await fetch(base+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(p.timeoutMs)});
   row.httpStatus=r.status;row.headersMs=Date.now()-t;
   if([401,402,403].includes(r.status))halt='authentication/payment error';rateLimits=r.status===429?rateLimits+1:0;if(rateLimits>=5)halt='rate limit';
   if(!r.ok)throw Error('HTTP '+r.status);
   row.message=await modelResponse(r,{onFirst:()=>row.firstResponseMs=Date.now()-t,onMetrics:m=>row.metrics=m});
   row.complete=true;row.validTools=!!row.message?.tool_calls?.length;
   for(const call of row.message?.tool_calls||[]){const def=request.tools.find(x=>x.function.name===call.function.name);if(!def){row.validTools=false;break;}try{validateArguments(JSON.parse(call.function.arguments),def.function.parameters);}catch(e){row.validTools=false;row.validationError=e.message;}}
   row.finishedAnswer=row.validTools&&row.message.tool_calls.length===1&&row.message.tool_calls[0].function.name==='finish';
  }catch(e){row.complete=false;row.error={code:e.code||e.name,message:e.message};}
  row.ms=Date.now()-t;json(task.id+'.json',row);console.log(JSON.stringify({id:row.id,complete:row.complete,finishedAnswer:row.finishedAnswer,ms:row.ms,metrics:row.metrics,error:row.error}));
 }}
 await Promise.all(Array.from({length:p.concurrency},worker));
 const rows=p.schedule.filter(t=>existsSync(join(root,t.id+'.json'))).map(t=>JSON.parse(readFileSync(join(root,t.id+'.json'))));
 const median=xs=>{xs.sort((a,b)=>a-b);return xs.length%2?xs[(xs.length-1)/2]:(xs[xs.length/2-1]+xs[xs.length/2])/2;};
 const summary=['current','recommended'].map(arm=>{const rs=rows.filter(r=>r.arm===arm);return {arm,n:rs.length,complete:rs.filter(r=>r.complete).length,validTools:rs.filter(r=>r.validTools).length,finishedAnswer:rs.filter(r=>r.finishedAnswer).length,lengthLimits:rs.filter(r=>r.error?.code==='MODEL_OUTPUT_LIMIT').length,medianMs:median(rs.map(r=>r.ms)),usageReported:rs.filter(r=>r.metrics?.usage).length};});
 json('summary.json',{halt,completed:rows.length,summary});console.log(JSON.stringify(summary));if(halt)process.exitCode=1;
}else throw Error('Use --prepare or --run');
