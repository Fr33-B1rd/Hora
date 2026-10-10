import {modelResponse} from './model-response.mjs';

export const outputPolicy=Object.freeze({initialMaxTokens:4096,retryMaxTokens:8192,initialTimeoutMs:45000,retryTimeoutMs:75000,minRetryMs:15000});
// Evaluated independently from the deterministic state-extraction stage.
export const actorSampling=Object.freeze({temperature:1,top_p:.95});

// Retries only generation: no partial response leaves this boundary, so a retry
// cannot repeat tools or state commits that the caller already completed.
export async function requestModel(config,request,{fetchImpl=fetch,deadline=Date.now()+120000,signal,retryBudget={remaining:1},policy=outputPolicy,onFirst=()=>{},onContent=()=>{},onAttempt=()=>{},onRetry=()=>{}}={}){
 for(let attempt=1;attempt<=2;attempt++){
  signal?.throwIfAborted();
  const remaining=deadline-Date.now();if(remaining<=0)throw new DOMException('model call exceeded this round’s time budget.','TimeoutError');
  const maxTokens=attempt===1?policy.initialMaxTokens:policy.retryMaxTokens;
  const timeout=Math.min(remaining,attempt===1?policy.initialTimeoutMs:policy.retryTimeoutMs);
  const body={...request,max_tokens:maxTokens,stream:true,stream_options:{include_usage:true}};
  const started=Date.now(),row={attempt,maxTokens,timeoutMs:timeout};let failure;
  try{
   const r=await fetchImpl(`${config.base.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
   row.httpStatus=r.status;row.headersMs=Date.now()-started;if(!r.ok)throw Error(`model service temporarily unavailable (${r.status}）`);
   const message=await modelResponse(r,{onContent,onFirst:()=>{row.firstResponseMs=Date.now()-started;onFirst();},onMetrics:m=>Object.assign(row,m)});
   if(!message)throw Error('model did not return a valid response.');
   return message;
  }catch(error){failure=error;row.errorCode=error.code||error.name;}
  finally{row.totalMs=Date.now()-started;onAttempt(row);}
  if(failure.code!=='MODEL_OUTPUT_LIMIT'||attempt===2||retryBudget.remaining<=0||policy.retryMaxTokens<=maxTokens||deadline-Date.now()<policy.minRetryMs||signal?.aborted)throw failure;
  retryBudget.remaining--;onRetry({attempt:2,maxTokens:policy.retryMaxTokens});
 }
}
