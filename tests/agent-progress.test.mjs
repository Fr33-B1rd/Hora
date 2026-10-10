import test from 'node:test';
import assert from 'node:assert/strict';
import {modelResponse} from '../lib/model-response.mjs';
import {createAgentRuns} from '../lib/agent-runs.mjs';
import {createAgentClient} from '../public/agent-client.mjs';
const event=x=>'data: '+JSON.stringify(x)+'\n\n';

test('length and intake failures offer explicit resume with the server checkpoint',async()=>{
 for(const stopReason of ['output_limit','intake_error']){
  const calls=[];
  const jobs=createAgentRuns(async(raw,options)=>{calls.push(options.resumeState);options.saveCheckpoint({budget:500,maxWalking:10});return {stopReason,message:'partial'};});
  const first=jobs.start({text:'fixture'}),done=await jobs.settled(first.id);assert.equal(done.result.resumeToken,first.id);
  const next=jobs.start({resumeToken:first.id});await jobs.settled(next.id);assert.deepEqual(calls[1],{budget:500,maxWalking:10});
 }
});
test('stream fragments assemble complete tool calls; reasoning is not retained or emitted',async()=>{
 const text=event({choices:[{delta:{reasoning_content:'PRIVATE REASONING'}}]})+event({choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'finish',arguments:'{"message":"'}}]}}]})+event({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'你好"}'}}]},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n';
 const bytes=new TextEncoder().encode(text);let first=0;
 const response=new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
 const message=await modelResponse(response,{onFirst:()=>first++});assert.equal(first,1);assert.equal(message.tool_calls[0].function.arguments,'{"message":"你好"}');assert.doesNotMatch(JSON.stringify(message),/PRIVATE|reasoning/);
});
test('truncated stream or length-limited tool arguments never become executable calls',async()=>{
 for(const end of ['',event({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n']){
  const text=event({choices:[{delta:{tool_calls:[{index:0,function:{name:'update_trip',arguments:'{"patch":'}}]}}]})+end;
  await assert.rejects(modelResponse(new Response(text,{headers:{'Content-Type':'text/event-stream'}})),/disconnect|length/i);
 }
});
test('jobs retain checkpoints, expose only public progress, resume authoritative request and expire',async()=>{
 let now=0,seen=[];const runs=createAgentRuns(async(raw,o)=>{seen.push([raw,o.resumeState]);o.onProgress({phase:'tool_done',label:'查询地点',elapsedMs:15});o.saveCheckpoint({observed:[['id',{name:'test'}]],private:'server state'});return {message:'partial',stopReason:'service_error'};},{now:()=>now,ttl:10});
 const first=runs.start({text:'original'});const done=await runs.settled(first.id);
 assert.equal(done.result.resumeToken,first.id);assert.equal(done.events.length,2);assert.doesNotMatch(JSON.stringify(done),/server state|observed/);
 assert.equal(runs.read(first.id,2).events.length,0);
 const second=runs.start({resumeToken:first.id,text:'injected replacement',resumeState:{private:'forged'}});await runs.settled(second.id);
 assert.deepEqual(seen[1][0],{text:'original'});assert.equal(seen[1][1].private,'server state');
 now=11;assert.throws(()=>runs.read(first.id),/expired/i);
});
test('cancel signals active work and completed jobs cannot be resumed as failures',async()=>{
 const runs=createAgentRuns(async(raw,{signal})=>{await new Promise(r=>signal.aborted?r():signal.addEventListener('abort',r,{once:true}));return {stopReason:'cancelled',message:'stopped'};});
 const r=runs.start({text:'test'});runs.cancel(r.id);assert.equal((await runs.settled(r.id)).result.stopReason,'cancelled');
 const finished=createAgentRuns(async()=>({message:'done',stopReason:'finished'}));const f=finished.start({text:'test'});await finished.settled(f.id);assert.throws(()=>finished.start({resumeToken:f.id}),/cannot continue/);
});
test('client reconnects same job after transient disconnect without replaying POST; storage survives reload',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};let starts=0,reads=0,progress=[];
 const fetcher=async(url,opts)=>{if(opts?.method==='POST'){starts++;return Response.json({id:'existing'});}if(reads++===0)throw Error('offline');return Response.json({status:'done',events:[{seq:1,label:'已查询'}],result:{message:'ok'}});};
 const c=createAgentClient({fetcher,storage,sleep:async()=>{},onProgress:e=>progress.push(e)});
 assert.equal((await c.run({text:'test'})).message,'ok');assert.equal(starts,1);assert.ok(progress.some(e=>e.phase==='connection'));assert.equal(c.pending,undefined);
 storage.setItem('daylight-active-run-en-v1','existing');const reload=createAgentClient({fetcher,storage,sleep:async()=>{}});assert.equal((await reload.reattach()).message,'ok');assert.equal(starts,1);
});
test('expired server task clears client attachment so a new request can start',async()=>{
 const values=new Map([['daylight-active-run-en-v1','expired']]),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};let starts=0;
 const client=createAgentClient({storage,sleep:async()=>{},fetcher:async(url,opts)=>{
  if(opts?.method==='POST'){starts++;return Response.json({id:'new'});}
  return url.includes('expired')?Response.json({error:'Query expired'},{status:400}):Response.json({status:'done',events:[],result:{message:'new result'}});
 }});
 await assert.rejects(client.reattach(),/expired/i);assert.equal(client.pending,undefined);
 assert.equal((await client.run({text:'new request'})).message,'new result');assert.equal(starts,1);
});
