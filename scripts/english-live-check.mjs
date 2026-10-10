import {writeFileSync} from 'node:fs';
import {runAgent} from '../lib/agent.mjs';
const config={base:process.env.NEBIUS_BASE_URL,key:process.env.NEBIUS_API_KEY,model:'nvidia/nemotron-3-super-120b-a12b'};
const texts=[
 'I am starting from Östermalmstorg today. I want to visit a museum and have ramen. I have no budget limit or return deadline. For now, just remember these preferences; do not search or plan yet.',
 'Change the budget to 500 SEK and keep total walking under 10 minutes. Just update my preferences; do not search or plan yet.',
 'Before we plan, remind me of my starting place, activities, budget, return deadline and walking limit.'
];
const results=[];let slots={},history=[];
for(const text of texts){
 const result=await runAgent({text,slots,history},config,{});
 results.push({text,result});writeFileSync('artifacts/english-migration-20261009/live-check.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({turn:results.length,stop:result.stopReason,message:result.message,slots:result.slots}));
 slots=result.slots;history.push({role:'user',content:text},{role:'assistant',content:result.message});
}
