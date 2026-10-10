import {readFile,writeFile} from 'node:fs/promises';
import {reviewTripIntent} from '../lib/agent-intent-review.mjs';
if(!process.argv.includes('--live'))throw Error('Explicit --live required.');
const config={key:process.env.NEBIUS_API_KEY,model:process.env.NEBIUS_MODEL,base:process.env.NEBIUS_BASE_URL};
const saved=JSON.parse(await readFile(new URL('../artifacts/agent-chain-live-ninth-partial.json',import.meta.url),'utf8'));
const trip=saved.turns[1].result.slots;
const activities=Object.values(trip.activityDefinitions).map(a=>a.label.includes('海鲜')?{...a,windowStart:null,windowEnd:null}:a);
const input={users:[saved.turns[1].text],trip:{...trip,activities,activityDefinitions:undefined},assumptions:[]};
const results=[];
for(const variant of ['forced','auto']){
 let metadata;
 try{
  const result=await reviewTripIntent(input,config,{timeout:45000,fetchImpl:async(url,opts)=>{
   const body=JSON.parse(opts.body);
   if(variant==='auto')Object.assign(body,{tool_choice:'auto',temperature:1,top_p:.95,max_tokens:4096,chat_template_kwargs:{enable_thinking:true,low_effort:true}});
   const r=await fetch(url,{...opts,body:JSON.stringify(body)});const data=await r.clone().json();
   metadata={status:r.status,finishReason:data.choices?.[0]?.finish_reason,reasoningCharacters:(data.choices?.[0]?.message?.reasoning_content||'').length,completionTokens:data.usage?.completion_tokens,tools:data.choices?.[0]?.message?.tool_calls?.map(c=>c.function.name)};
   return r;
  }});results.push({variant,metadata,result});
 }catch(error){results.push({variant,metadata,error:error.message});}
 console.log(JSON.stringify(results.at(-1)));
}
await writeFile(new URL('../artifacts/intake-settings-live.json',import.meta.url),JSON.stringify(results,null,2));
