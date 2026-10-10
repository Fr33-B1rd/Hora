import test from 'node:test';
import assert from 'node:assert/strict';
import {modelResponse} from '../lib/model-response.mjs';
import {requestModel,outputPolicy} from '../lib/model-call.mjs';
import {runAgent} from '../lib/agent.mjs';
const config={base:'https://model.invalid',key:'not-logged',model:'fixture'};
const event=x=>'data: '+JSON.stringify(x)+'\n\n';
const stream=parts=>new Response(parts.map(event).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
const call=(name,args,finish='tool_calls')=>({ok:true,json:async()=>({choices:[{finish_reason:finish,message:{tool_calls:[{id:'call',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})});
const request={model:'fixture',messages:[{role:'user',content:'fixture'}],tools:[],temperature:.2};

test('length-limit telemetry drains trailing usage without exposing reasoning or partial calls',async()=>{
 let metrics;
 const r=stream([
  {choices:[{delta:{reasoning_content:'PRIVATE THOUGHT'}}]},
  {choices:[{delta:{content:'abc',tool_calls:[{index:0,function:{name:'update_trip',arguments:'{"patch":'}}]},finish_reason:'length'}]},
  {choices:[],usage:{prompt_tokens:12,completion_tokens:4096,total_tokens:4108,completion_tokens_details:{reasoning_tokens:77},secret:'DO NOT RETAIN'}}
 ]);
 await assert.rejects(()=>modelResponse(r,{onMetrics:m=>metrics=m}),e=>e.code==='MODEL_OUTPUT_LIMIT');
 assert.equal(metrics.usage.completionTokens,4096);assert.equal(metrics.usage.reasoningTokens,77);assert.equal(metrics.reasoningChars,15);assert.equal(metrics.contentChars,3);assert.equal(metrics.toolArgumentChars,9);assert.equal(metrics.streamComplete,true);
 assert.doesNotMatch(JSON.stringify(metrics),/PRIVATE|DO NOT RETAIN|patch/);
});

test('JSON also strips reasoning and keeps absent usage unknown instead of zero',async()=>{
 let metrics;
 const message=await modelResponse({json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'hello',reasoning:'PRIVATE'}}]})},{onMetrics:m=>metrics=m});
 assert.equal(metrics.usage,null);assert.equal(metrics.reasoningChars,7);assert.equal(message.reasoning,undefined);assert.doesNotMatch(JSON.stringify(message),/PRIVATE/);
});

test('one length retry uses identical context, discards partial tools and records both attempts',async()=>{
 const requests=[],attempts=[],retries=[];
 const result=await requestModel(config,request,{onAttempt:r=>attempts.push(r),onRetry:r=>retries.push(r),fetchImpl:async(url,o)=>{
  requests.push(JSON.parse(o.body));return requests.length===1?call('update_trip',{patch:{budget:9999}},'length'):call('finish',{message:'done'});
 }});
 assert.equal(result.tool_calls[0].function.name,'finish');assert.deepEqual(requests.map(r=>r.max_tokens),[4096,8192]);assert.deepEqual(requests[0].messages,requests[1].messages);assert.deepEqual(requests[0].tools,requests[1].tools);assert.equal(retries.length,1);assert.equal(attempts.length,2);assert.equal(attempts[0].errorCode,'MODEL_OUTPUT_LIMIT');assert.equal(attempts[1].finishReason,'tool_calls');assert.equal(requests[1].stream_options.include_usage,true);
});

test('a second length failure stops and a shared turn has only one retry credit',async()=>{
 const retryBudget={remaining:1};let calls=0;
 const fetchImpl=async()=>{calls++;return call('finish',{},'length');};
 await assert.rejects(()=>requestModel(config,request,{retryBudget,fetchImpl}),e=>e.code==='MODEL_OUTPUT_LIMIT');assert.equal(calls,2);assert.equal(retryBudget.remaining,0);
 await assert.rejects(()=>requestModel(config,request,{retryBudget,fetchImpl}),e=>e.code==='MODEL_OUTPUT_LIMIT');assert.equal(calls,3);
});

test('insufficient time and cancellation cannot start another attempt',async()=>{
 let calls=0;
 await assert.rejects(()=>requestModel(config,request,{deadline:Date.now()+5000,fetchImpl:async()=>{calls++;return call('finish',{},'length');}}),e=>e.code==='MODEL_OUTPUT_LIMIT');assert.equal(calls,1);
 const controller=new AbortController();
 await assert.rejects(()=>requestModel(config,request,{signal:controller.signal,onRetry:()=>controller.abort(),fetchImpl:async()=>{calls++;return call('finish',{},'length');}}),e=>e.name==='AbortError');assert.equal(calls,2);
 await assert.rejects(()=>requestModel(config,request,{deadline:Date.now()-1,fetchImpl:async()=>{calls++;}}),e=>e.name==='TimeoutError');assert.equal(calls,2);
});

test('HTTP, network, timeout and disconnected stream errors are never length retries',async()=>{
 for(const response of [()=>({ok:false,status:503}),()=>{throw Error('network');},()=>{throw new DOMException('timeout','TimeoutError');},()=>new Response(event({choices:[{delta:{content:'partial'}}]}),{headers:{'content-type':'text/event-stream'}})]){
  let calls=0;await assert.rejects(()=>requestModel(config,request,{fetchImpl:async()=>{calls++;return response();}}));assert.equal(calls,1);
 }
});

test('runtime retries only generation after a tool; news is read once and state survives',async()=>{
 let businessCalls=0,main=0;const retries=[],audit=[],requests=[];
 const r=await runAgent({text:'查新闻',slots:{budgetMode:'limited',budget:500,maxWalking:10}},config,{readNews:async()=>{businessCalls++;return {cards:[{type:'news',title:'fixture',url:'https://fixture.invalid/news'}]};}},{onProgress:e=>{if(e.phase==='model_retry')retries.push(e);},onDiagnostic:e=>audit.push(e),fetchImpl:async(url,o)=>{
  const req=JSON.parse(o.body);requests.push(req);
  if(req.tools[0].function.name==='commit_turn')return call('commit_turn',{intent:'information',patch:{budgetMode:'limited',budget:500,timeMode:'unknown',start:null,deadline:null},sources:[],assumptions:[],categories:['news']});
  main++;
  if(main===1)return call('load_skill',{name:'local-discovery'});
  if(main===2)return call('read_news',{});
  if(main===3)return call('update_trip',{patch:{budget:9999}},'length');
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'已查到来源新闻。'}}]})};
 }});
 assert.equal(r.stopReason,'finished');assert.equal(businessCalls,1);assert.equal(r.slots.budget,500);assert.equal(r.slots.maxWalking,10);assert.equal(r.rounds,3);assert.equal(retries.length,1);assert.equal(audit.filter(e=>e.kind==='turn_committed').length,1);assert.deepEqual(requests[3].messages,requests[4].messages);assert.equal(r.timings.filter(t=>t.errorCode==='MODEL_OUTPUT_LIMIT').length,1);
});

test('intake retries before committing, and metrics retain no response reasoning text',async()=>{
 let intake=0;const audit=[];
 const r=await runAgent({text:'Budget500'},config,{}, {onDiagnostic:e=>audit.push(e),fetchImpl:async(url,o)=>{
  const req=JSON.parse(o.body);
  if(req.tools[0].function.name==='commit_turn'){
   intake++;return call('commit_turn',{intent:'update',patch:{budgetMode:'limited',budget:intake===1?9999:500,timeMode:'unknown',start:null,deadline:null},sources:[{field:'budgetMode',messageIndices:[0]},{field:'budget',messageIndices:[0]}],assumptions:[],categories:[]},intake===1?'length':'tool_calls');
  }
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'已记住500。'}}]})};
 }});
 assert.equal(intake,2);assert.equal(r.slots.budget,500);assert.equal(audit.filter(e=>e.kind==='turn_committed').length,1);assert.equal(audit.filter(e=>e.kind==='model_metrics').length,3);assert.equal(r.stopReason,'finished');
});

test('stray protocol prose is not replayed as history or saved in model-response diagnostics',async()=>{
 let main=0;const audit=[];
 const r=await runAgent({text:'只聊聊'},config,{}, {onDiagnostic:e=>audit.push(e),fetchImpl:async(url,o)=>{
  const req=JSON.parse(o.body);
  if(req.tools[0].function.name==='commit_turn')return call('commit_turn',{intent:'discussion',patch:{budgetMode:'unknown',budget:null,timeMode:'unknown',start:null,deadline:null},sources:[],assumptions:[],categories:[]});
  main++;assert.equal(req.temperature,1);assert.equal(req.top_p,.95);
  if(main===1)return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{content:'UNWANTED_PROTOCOL_NOISE',tool_calls:[{id:'a',type:'function',function:{name:'load_skill',arguments:'{"name":"plan-outing"}'}}]}}]})};
  assert.doesNotMatch(JSON.stringify(req.messages),/UNWANTED_PROTOCOL_NOISE/);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'可以聊聊。'}}]})};
 }});
 assert.equal(r.stopReason,'finished');assert.doesNotMatch(JSON.stringify(audit),/UNWANTED_PROTOCOL_NOISE/);assert.ok(r.timings.some(t=>t.contentChars>0));
});

test('exhausted intake retry preserves previous state and discloses unsaved new conditions',async()=>{
 let calls=0;const audit=[];
 const r=await runAgent({text:'改成预算500',slots:{budgetMode:'limited',budget:1000}},config,{}, {onDiagnostic:e=>audit.push(e),fetchImpl:async()=>{calls++;return call('commit_turn',{patch:{budget:500}},'length');}});
 assert.equal(calls,2);assert.equal(r.stopReason,'output_limit');assert.equal(r.slots.budget,1000);assert.equal(audit.filter(e=>e.kind==='turn_committed').length,0);assert.deepEqual(r.turnReceipt.committedFields,[]);assert.match(r.message,/Failed to fully save.*new conditions/);assert.doesNotMatch(r.message,/conditions have been remembered|continue adding/);
});
