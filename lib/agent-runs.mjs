import {randomBytes} from 'node:crypto';
const recoverable=new Set(['service_error','output_limit','intake_error','limit','partial_result','review_error','needs_review','cancelled']);
export function createAgentRuns(execute,{ttl=15*60000,max=20,now=Date.now}={}){
 const runs=new Map();
 function prune(){for(const [id,r]of runs)if(r.status!=='running'&&now()-r.touched>ttl)runs.delete(id);}
 function get(id){prune();const r=runs.get(id);if(!r)throw Error('This query record has expired or the service restarted; please resend your request.');return r;}
 function start(raw){
  prune();if([...runs.values()].filter(r=>r.status==='running').length>=2)throw Error('The assistant is busy with other requests; please try again later.');
  let resume;if(raw.resumeToken){const prior=get(raw.resumeToken);if(prior.status==='running'||!prior.result?.resumeToken)throw Error('This query cannot continue at the moment.');resume=structuredClone(prior.checkpoint);raw=structuredClone(prior.raw);}
  if(runs.size>=max){const old=[...runs].find(([,r])=>r.status!=='running');if(old)runs.delete(old[0]);else throw Error('Too many query tasks.');}
  const id=randomBytes(20).toString('hex'),controller=new AbortController();
  const r={id,raw:structuredClone(raw),status:'running',events:[],seq:0,touched:now(),checkpoint:resume,controller};runs.set(id,r);
  const progress=e=>{r.events.push({...e,seq:++r.seq});r.events=r.events.slice(-80);r.touched=now();};
  progress({phase:'queued',label:resume?'Restoring previous query results':'Starting query',elapsedMs:0});
  r.promise=Promise.resolve().then(()=>execute(raw,{signal:controller.signal,resumeState:resume,onProgress:progress,saveCheckpoint:s=>{r.checkpoint=structuredClone(s);}})).then(result=>{r.result={...result,...(recoverable.has(result.stopReason)?{resumeToken:id}:{})};},error=>{r.result={message:'Query not completed:'+error.message,stopReason:'service_error',resumeToken:id};}).finally(()=>{r.status='done';r.touched=now();});
  return {id};
 }
 return {start,read(id,after=0){const r=get(id);return {id,status:r.status,events:r.events.filter(e=>e.seq>after),...(r.status==='done'?{result:r.result}:{})};},cancel(id){const r=get(id);if(r.status==='running')r.controller.abort();return {stopping:r.status==='running'};},async settled(id){await get(id).promise;return this.read(id);}};
}
