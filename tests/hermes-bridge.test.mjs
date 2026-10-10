import test from 'node:test';
import assert from 'node:assert/strict';
import {streamAssistant,hermesStatus,hermesConfig} from '../lib/hermes.mjs';

const sink=()=>{const out={status:0,headers:{},chunks:[],ended:false};return {out,writeHead(s,h){out.status=s;out.headers=h;},write(c){out.chunks.push(Buffer.from(c).toString());},end(){out.ended=true;}};};
const config={url:'http://hermes.invalid',key:'server-side-key'};
const sse=async function*(){yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');yield new TextEncoder().encode('event: hermes.tool.progress\ndata: {"tool":"skill_view"}\n\ndata: [DONE]\n\n');};

test('the web bridge forwards one message to the agent and streams the reply through unchanged',async()=>{
  const res=sink();let seen;
  await streamAssistant({text:' Is chicken on offer? ',session:'abcd1234-tab'},res,config,{fetchImpl:async(url,opts)=>{seen={url,opts};return {ok:true,status:200,body:sse()};}});
  assert.equal(seen.url,'http://hermes.invalid/v1/chat/completions');
  assert.equal(seen.opts.headers.Authorization,'Bearer server-side-key');assert.equal(seen.opts.headers['X-Hermes-Session-Id'],'web-abcd1234-tab');
  assert.deepEqual(JSON.parse(seen.opts.body),{model:'hermes-agent',stream:true,messages:[{role:'user',content:'Is chicken on offer?'}]});
  assert.equal(res.out.status,200);assert.match(res.out.headers['Content-Type'],/text\/event-stream/);assert.ok(res.out.ended);
  assert.match(res.out.chunks.join(''),/"content":"Hel"/);assert.match(res.out.chunks.join(''),/hermes\.tool\.progress/);
  assert.doesNotMatch(JSON.stringify(res.out),/server-side-key/);
});

test('bad input, a missing key, an unreachable agent and a rejected key each get a plain error before any stream starts',async()=>{
  const fail=async(input,cfg,fetchImpl)=>{const res=sink();try{await streamAssistant(input,res,cfg,{fetchImpl});}catch(e){assert.equal(res.out.status,0);return [e.status,e.message];}assert.fail('expected an error');};
  const never=async()=>{throw Error('must not be called');};
  assert.equal((await fail({text:'',session:'abcd1234'},config,never))[0],400);
  assert.equal((await fail({text:'hi',session:'../etc'},config,never))[0],400);
  assert.equal((await fail({text:'hi',session:'abcd1234'},{...config,key:''},never))[0],503);
  assert.deepEqual(await fail({text:'hi',session:'abcd1234'},config,async()=>{throw Error('ECONNREFUSED');}),[502,'The assistant is not running. Start the Hermes gateway and try again.']);
  assert.match((await fail({text:'hi',session:'abcd1234'},config,async()=>({ok:false,status:401})))[1],/rejected this server/);
});

test('status reports configured and reachable without exposing the key',async()=>{
  assert.deepEqual(await hermesStatus({url:'x',key:''}),{configured:false,reachable:false});
  assert.deepEqual(await hermesStatus(config,{fetchImpl:async()=>({ok:true,json:async()=>({version:'0.21.6'})})}),{configured:true,reachable:true,version:'0.21.6'});
  assert.deepEqual(await hermesStatus(config,{fetchImpl:async()=>{throw Error('down');}}),{configured:true,reachable:false});
  assert.deepEqual(hermesConfig({HERMES_API_URL:'http://127.0.0.1:8642/',HERMES_API_KEY:'k'}),{url:'http://127.0.0.1:8642',key:'k'});
});
