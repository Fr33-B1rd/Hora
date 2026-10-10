import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCompletion} from '../lib/agent-review.mjs';
const config={base:'https://fixture.invalid',model:'test',key:'test'};
const review=(reply,claims,context={})=>reviewCompletion({text:'先讨论',history:[],reply,context,observations:[],actions:[]},config,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'assess_completion',arguments:JSON.stringify({requestAct:'information',responseAct:'answer',decision:null,claims,ready:true,issues:[]})}}]}}]})})});
test('a ready verdict cannot override missing or fabricated factual evidence',async()=>{
 for(const evidenceQuote of [null,'invented source','{']){
  const r=await review('这家店上午营业。',[{text:'这家店上午营业',evidenceQuote}]);assert.equal(r.ready,false);assert.match(r.issues[0],/lack tool or user basis/);
 }
});
test('conceptual discussion and a claim with an exact supplied source can pass',async()=>{
 assert.equal((await review('我建议先逛书店，再考虑午餐。',[])).ready,true);
 assert.equal((await review('来源列出上午营业。',[{text:'来源列出上午营业',evidenceQuote:'上午营业'}],{source:'上午营业'})).ready,true);
 assert.equal((await review('短回复',[{text:'not in reply',evidenceQuote:null}])).ready,false);
});
test('a ready verdict cannot pass a recommendation request answered with the same choice question',async()=>{
 const r=await reviewCompletion({text:'你推荐哪一个？',history:[],reply:'你想选哪一个？',context:{},observations:[],actions:[]},config,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'assess_completion',arguments:JSON.stringify({requestAct:'recommendation',responseAct:'question',decision:null,claims:[],ready:true,issues:[]})}}]}}]})})});
 assert.equal(r.ready,false);assert.equal(r.needsRewrite,true);assert.match(r.issues[0],/no clear advice/);
});
