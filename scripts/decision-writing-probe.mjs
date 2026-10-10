import {writeReply} from '../lib/reply.mjs';
import {writeFileSync} from 'node:fs';
const text='明天从 KTH 早上出发，没有返回时间和预算，想去博物馆或书店中的一个，另外吃中餐。先讨论安排，不查路线，你更推荐哪一种？';
const facts={task:'Answer the user recommendation request. Choose a provisional theme and explain the tradeoff using only supplied preferences. General advice does not require choosing a verified venue. No venue/opening/route/availability facts have been searched.',request:text,userPreferences:{origin:'KTH',departure:'morning',returnLimit:null,budgetCeiling:null,alternatives:['museum','bookstore'],otherActivity:'Chinese food'},verifiedVenueFacts:[],calendarWritten:false};
const message=await writeReply(facts,{base:process.env.NEBIUS_BASE_URL,key:process.env.NEBIUS_API_KEY,model:process.env.NEBIUS_MODEL},{history:[],fallback:'WRITING_FAILED'});
writeFileSync('artifacts/decision-writing-probe.json',JSON.stringify({text,facts,message},null,2));console.log(message);
