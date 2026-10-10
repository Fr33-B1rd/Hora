// Replay the observed conversation through the live local API. Read-only external tools.
import {writeFile} from 'node:fs/promises';
const history=[
 {role:'user',content:'我还没有想好，给我推荐几个方案？'},
 {role:'assistant',content:'第三个方案是斯德哥尔摩美食之旅：上午 Östermalm Saluhall 美食市场、Hötorget 市场；下午瑞典肉桂卷烘焙工作坊；傍晚在 Södermalm 吃传统肉丸。'},
 {role:'user',content:'我对第三个很感兴趣'},
 {role:'assistant',content:'你从哪个公共地标出发？'}
];
const request={text:'从Gamla Stan地铁站出发',history};
const started=Date.now();
const response=await fetch('http://127.0.0.1:4318/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(210000)});
const result=await response.json();
await writeFile(new URL('../artifacts/agent-food-recovery-live.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started,httpStatus:response.status,request,result},null,2));
console.log(JSON.stringify({status:response.status,elapsedMs:Date.now()-started,message:result.message,stopReason:result.stopReason,rounds:result.rounds,plans:result.journey?.plans.length,activities:result.slots?.activityDefinitions,trace:result.trace},null,2));
if(!response.ok)process.exitCode=1;
