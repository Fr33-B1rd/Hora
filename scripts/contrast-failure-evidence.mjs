import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const dir='artifacts/controlled-contrast-20261008/';
const p=JSON.parse(readFileSync(dir+'protocol.json'));
const rows=p.schedule.filter(t=>existsSync(dir+t.id+'.json')).map(t=>JSON.parse(readFileSync(dir+t.id+'.json')));
const evidence={groups:p.groups.map(g=>{const r=rows.filter(x=>x.group===g.id);const lengths={main:0,intake:0,review:0};for(const x of r)for(const q of x.requests)if(q.finishReason==='length')lengths[q.stage==='check_trip_intent'?'intake':q.stage==='assess_completion'?'review':'main']++;return {group:g.id,n:r.length,correctionFalseSave:r.filter(x=>x.scenario==='correction'&&x.result.stopReason==='finished'&&(!x.objective.budget||!x.objective.walking)).map(x=>x.id),unrequestedWalkMode:r.filter(x=>x.scenario==='correction'&&x.result.slots?.transport==='walk').map(x=>x.id),delegatePlanProduced:r.filter(x=>x.scenario==='delegate'&&x.result.journey?.plans?.length).map(x=>x.id),delegatePlanBlocked:r.filter(x=>x.scenario==='delegate'&&x.result.journey?.plans?.length&&x.result.stopReason!=='finished').map(x=>x.id),lengthLimitedCalls:lengths,serviceErrorWithLength:r.filter(x=>x.result.stopReason==='service_error'&&x.requests.some(q=>q.finishReason==='length')).map(x=>x.id),httpNon200:r.flatMap(x=>x.requests.filter(q=>q.status!==200).map(q=>({id:x.id,status:q.status??'no headers'})))};}),examples:[
 {id:'clarify-A-1',finding:'合法追问被拦截：用户缺起点，需求复核把应问起点解释为重复问题，完成复核又把提问当成需来源的事实。'},
 {id:'correction-A-1',finding:'未调用状态更新却声称已更新500SEK和10分钟；完成复核claims为空并放行。'},
 {id:'recommend-A-1',finding:'给出符合看画偏好的暂定建议，复核仍要求状态必须已选定，混淆讨论与执行。'},
 {id:'delegate-A-1',finding:'已生成可行计划，复核返回合成的字段加数值字符串作为引用，逐字证据检查无法匹配叶值而拦截。'},
 {id:'discovery-D-1',finding:'新闻和活动都已读取，但present_events作为终止动作直接返回活动列表，遗漏新闻。'}
 ]};
writeFileSync(dir+'failure-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
