import {composeDecision} from './experiments/decision-reply.mjs';
import {writeFileSync} from 'node:fs';
const text='明天从 KTH 早上出发，没有返回时间和预算，想去博物馆或书店中的一个，另外吃中餐。先讨论安排，不查路线，你更推荐哪一种？';
const message=await composeDecision({text,history:[],context:{trip:{},currentPlan:null},purpose:'recommendation',issues:['Do not ask the same preference question or invent local venue facts.']},{base:process.env.NEBIUS_BASE_URL,key:process.env.NEBIUS_API_KEY,model:process.env.NEBIUS_MODEL});
writeFileSync('artifacts/decision-writing-focused.json',JSON.stringify({text,message},null,2));console.log(message);
