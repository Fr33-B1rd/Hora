import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../lib/agent.mjs';
import {agentSkills} from '../lib/agent-skills.mjs';
import {createAgentEnvironment,hasTimeAnchor} from '../lib/agent-tools.mjs';
import {reviewTripIntent} from '../lib/agent-intent-review.mjs';
const resolvedTurn=(req,turn)=>{const trip=JSON.parse(req.messages[0].content.split('Interpretation context (data):\n').at(-1)).trip;return {...turn,patch:{...Object.fromEntries(['budgetMode','budget','timeMode','start','deadline'].map(k=>[k,trip[k]])),...turn.patch}};};
const config={key:'test',base:'https://model.invalid',model:'test'};
const date='2026-10-10',origin={id:'station',name:'Station',location:{latitude:59.33,longitude:18.06},periods:null};
const book={...origin,id:'books',name:'Nordic Books'},wrong={...origin,id:'other',name:'Other Shop'};
const trip={date,origin:'Station',start:'10:00',deadline:'24:00',timeMode:'fixed',budgetMode:'unlimited',activities:[{id:'books',label:'逛指定书店',query:'bookshop',requiredNames:['Nordic Books'],duration:60,allowance:null}]};
function services(){let saved=[],queries=[];return {saved,queries,maps:{search:async(q)=>{queries.push(q);return q==='Station'?[origin]:q==='Nordic Books'?[book]:[wrong];},details:async id=>id==='books'?book:origin,route:async()=>({minutes:10,walking:10,mode:'walk',fare:{currencyCode:'SEK',units:'0'}})},calendarDay:async d=>({date:d,connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:v=>{saved.push(v);return 'journey-'+saved.length;},readNews:async()=>({message:'来源受限',cards:[{type:'news',title:'Observed headline',url:'https://www.svt.se/nyheter/lokalt/stockholm/test',source:'SVT',publishedAt:'2026-10-10'}]}),nearbyEvents:async()=>({events:[],message:'没有匹配的活动'})};}
// A scripted ['finish',{message}] step stands for the model answering in plain text.
const replyText=a=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:[a.message,...(a.sections||[]).map(s=>s.text)].filter(Boolean).join('\n\n')}}]})});
function model(steps,inspect=()=>{},turn={intent:"planning",patch:{},sources:[],assumptions:[],categories:[]}){let i=0;return async(_url,opts)=>{const req=JSON.parse(opts.body);if(req.tools[0].function.name==='commit_turn')return responseCall('commit_turn',resolvedTurn(req,turn));if(['assess_completion','check_trip_intent'].includes(req.tools[0].function.name))return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:req.tools[0].function.name,arguments:JSON.stringify(req.tools[0].function.name==='check_trip_intent'?{missing:[]}:{requestAct:'information',responseAct:'answer',decision:null,claims:[],ready:true,issues:[]})}}]}}]})};inspect(req,i);const step=steps[i++];assert.ok(step,'Unexpected model round');const calls=Array.isArray(step[0])?step:[step];if(calls.length===1&&calls[0][0]==='finish')return replyText(calls[0][1]);return {ok:true,json:async()=>({choices:[{message:{role:'assistant',tool_calls:calls.map(([name,args],n)=>({id:`call-${i}-${n}`,type:'function',function:{name,arguments:JSON.stringify(args, (key,value)=>key==='activities'&&Array.isArray(value)?value.map(a=>typeof a==='object'?{availability:'venue',eventRef:null,windowStart:null,windowEnd:null,windowQuote:null,...a}:a):value)}}))}}]})};};}
const responseCall=(name,args)=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})});
const finish=message=>['finish',{message}];

test('skills are local, discoverable, and expose only allowlisted tools',async()=>{
  const c=await agentSkills();assert.equal(c.entries.length,4);assert.ok(c.policy.includes('bounded tool loop'));assert.ok(c.entries.every(s=>s.body&&s.description));
});
test('model observes mismatch and chooses its own revised search before planning',async()=>{
  const svc=services();const steps=[['load_skill',{name:'plan-outing'}],['update_trip',{patch:trip}],['search_places',{query:'Station'}],['select_candidates',{activityId:'origin',placeIds:['station']}],['search_places',{query:'bookshop'}],['search_places',{query:'Nordic Books'}],['select_candidates',{activityId:'books',placeIds:['books']}],['plan_itinerary',{}],finish('找到符合要求的书店，可以查看候选。')];
  const r=await runAgent({text:'from Station 出发逛指定书店'},config,svc,{fetchImpl:model(steps,(req,i)=>{
    // A planning turn starts with its skill already loaded; unrelated skills stay out.
    if(i===0){assert.ok(req.tools.some(t=>t.function.name==='search_places'));assert.ok(req.messages[0].content.includes('# Plan an outing'));assert.ok(!req.messages[0].content.includes('# Local discovery'));}
    if(i===1){assert.equal(JSON.parse(req.messages.at(-1).content).alreadyLoaded,true);assert.equal(req.messages[0].content.split('# Plan an outing').length,2);assert.ok(req.tools.some(t=>t.function.name==='search_places'));assert.ok(req.messages.some(m=>m.role==='system'&&m.content.includes('# Plan an outing')));assert.ok(!req.tools.some(t=>t.function.name==='read_news'));}
    if(i===5){const result=JSON.parse(req.messages.filter(m=>m.role==='tool').at(-1).content);assert.equal(result.candidates[0].name,'Other Shop');}
  })});
  assert.equal(r.stopReason,'finished');assert.equal(r.journey.plans.length,2);assert.ok(r.journey.plans.every(p=>p.stops[0].placeId==='books'));assert.deepEqual(svc.queries,['Station','bookshop','Nordic Books']);assert.equal(svc.saved.length,1);assert.deepEqual(r.skills,['plan-outing']);
});
test('clarifications are chosen by the model without a fixed missing-field question',async()=>{
  const r=await runAgent({text:'想出去逛逛'},config,services(),{fetchImpl:model([['load_skill',{name:'plan-outing'}],finish('你更想看展，还是找个安静的地方走走？')])});
  assert.equal(r.message,'你更想看展，还是找个安静的地方走走？');assert.equal(r.journey,undefined);
});
test('unknown tools and path traversal cannot execute, even if a skill asks for them',async()=>{
  const r=await runAgent({text:'保存到日历'},config,services(),{fetchImpl:model([['load_skill',{name:'../../.env'}],['load_skill',{name:'calendar-review'}],['calendar_confirm',{id:'x'}],finish('需要在页面确认。')])});
  assert.equal(r.trace.filter(t=>t.status==='error').length,2);assert.equal(r.journey,undefined);
});
test('news skill selects read tools independently of outing requirements',async()=>{
  const r=await runAgent({text:'本地有什么新闻'},config,services(),{fetchImpl:model([['load_skill',{name:'local-discovery'}],['read_news',{}],finish('读到了地区新闻，链接见下方。')])});
  assert.equal(r.cards.length,1);assert.equal(r.slots.origin,null);assert.equal(r.slots.activities.length,0);
});
test('calendar tool output omits private event titles and descriptions',async()=>{
  const svc=services();svc.calendarDay=async()=>({date,busy:[{start:'2026-10-10T10:00:00Z',end:'2026-10-10T11:00:00Z',summary:'PRIVATE',description:'SECRET'}],own:[],connected:true});
  const env=createAgentEnvironment({},svc),result=await env.handlers.calendar_availability({date});assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET/);assert.equal(result.busy.length,1);
});
test('sparse updates preserve unrelated estimates and invalidate stale candidates',async()=>{
  const svc=services(),env=createAgentEnvironment({},svc);await env.handlers.update_trip({patch:trip});await env.handlers.search_places({query:'Station'});await env.handlers.select_candidates({activityId:'origin',placeIds:['station']});await env.handlers.search_places({query:'Nordic Books'});await env.handlers.select_candidates({activityId:'books',placeIds:['books']});await env.handlers.plan_itinerary({});
  await env.handlers.update_trip({patch:{start:'11:00'}});assert.equal(env.state.activityDefinitions.books.duration,60);assert.equal(env.output().stale,true);assert.equal(env.output().journey,undefined);await assert.rejects(env.handlers.calendar_changes({}),/not generated valid candidates/);
});
test('a bounded runtime cannot loop indefinitely or convert failure into a successful write',async()=>{
  const r=await runAgent({text:'一直尝试'},config,services(),{maxTools:2,fetchImpl:model([['load_skill',{name:'plan-outing'}],['plan_itinerary',{}],['plan_itinerary',{}]])});assert.equal(r.stopReason,'limit');assert.equal(r.toolCount,2);assert.equal(r.journey,undefined);
});
test('model can inspect infeasibility then revise its own assumption, without a hardcoded retry window',async()=>{
  const svc=services();const r=await runAgent({text:'from Station 出发帮我安排书店，时间你决定'},config,svc,{fetchImpl:model([
    ['load_skill',{name:'plan-outing'}],['update_trip',{patch:{...trip,start:'10:00',deadline:'10:20',timeMode:'flexible'},assumptions:['先试上午短行程']}],['search_places',{query:'Station'}],['select_candidates',{activityId:'origin',placeIds:['station']}],['search_places',{query:'Nordic Books'}],['select_candidates',{activityId:'books',placeIds:['books']}],['plan_itinerary',{}],['update_trip',{patch:{deadline:'12:30'},assumptions:['延长到中午以容纳书店停留和交通']}],['plan_itinerary',{}],finish('短窗口排不下，延长暂定时间后找到候选。')
  ],(req,i)=>{if(i===7)assert.equal(JSON.parse(req.messages.filter(m=>m.role==='tool').at(-1).content).alternatives,0);})});
  assert.ok(r.journey.plans.length);assert.equal(r.journey.constraints.deadline,'12:30');assert.equal(svc.saved.length,2);assert.ok(r.routeCalls<=36);
});

test('planning retries after distinct state changes are not mistaken for identical loops',async()=>{
  const svc=services(),r=await runAgent({text:'from Station 出发，先查再决定'},config,svc,{fetchImpl:model([
    ['load_skill',{name:'plan-outing'}],['plan_itinerary',{}],['update_trip',{patch:trip,assumptions:['上午出发由助手暂定']}],['plan_itinerary',{}],['search_places',{query:'Station'}],['select_candidates',{activityId:'origin',placeIds:['station']}],['search_places',{query:'Nordic Books'}],['select_candidates',{activityId:'books',placeIds:['books']}],['plan_itinerary',{}],finish('Complete')
  ])});
  assert.ok(r.journey.plans.length);assert.equal(r.trace.filter(t=>t.summary.includes('重复两次')).length,0);
  const resumed=createAgentEnvironment({slots:r.slots},services());assert.deepEqual(resumed.context().assumptions,['上午出发由助手暂定']);
});

test('search is observational and cannot silently replace a chosen origin',async()=>{
  const env=createAgentEnvironment({},services());
  await env.handlers.update_trip({patch:trip});await env.handlers.search_places({query:'Station'});await env.handlers.select_candidates({activityId:'origin',placeIds:['station']});
  const revision=env.revision;await env.handlers.search_places({query:'Nordic Books'});assert.equal(env.revision,revision);
  await assert.rejects(env.handlers.select_candidates({activityId:'books',placeIds:['unobserved']}),/already queried/);
  await env.handlers.select_candidates({activityId:'books',placeIds:['books']});await env.handlers.plan_itinerary({});assert.equal(env.output().journey.origin.id,'station');
});

test('requested information coverage is checked without a second model reviewer',async()=>{
 const r=await runAgent({text:'查新闻'},config,services(),{fetchImpl:model([
 ['load_skill',{name:'local-discovery'}],finish('已查询'),
 ['read_news',{}],finish('已取得来源标题，完整报道仍需阅读。')
 ],()=>{},{intent:'information',patch:{},sources:[],assumptions:[],categories:['news']})});
 assert.equal(r.stopReason,'finished');assert.match(r.message,/来源标题/);assert.equal(r.cards.length,1);
 assert.ok(r.trace.some(t=>t.action==='reply'&&t.status==='error'&&/has not been looked up/.test(t.summary)));
 assert.equal(r.timings.filter(t=>t.stage==='review').length,0);
});


async function prepared(svc=services(),patch={}){
  const env=createAgentEnvironment({},svc);
  await env.handlers.update_trip({patch:{...trip,...patch}});
  await env.handlers.search_places({query:'Station'});
  await env.handlers.select_candidates({activityId:'origin',placeIds:['station']});
  await env.handlers.search_places({query:'Nordic Books'});
  await env.handlers.select_candidates({activityId:'books',placeIds:['books']});
  return env;
}

test('official offer interpretation requires a fetched quotation and cannot restore a contradicted candidate',async()=>{
 const svc=services(),page={url:'https://books.example/',text:'Public bookshop. Author talks require a ticket.',links:[{url:'https://books.example/events',label:'Events'}],checkedAt:'2026-10-10T08:00:00Z'};
 svc.maps.details=async()=>({...book,website:page.url});svc.readPlaceWebsite=async()=>page;
 const env=await prepared(svc);await env.handlers.place_details({placeId:'books'});
 const record={activityId:'books',placeId:'books',sourceUrl:page.url,quote:'Public bookshop.',status:'supported',explanation:'官网说明是公众书店；当天服务仍待确认。'};
 await assert.rejects(env.handlers.assess_place_offer(record),/read.*this round/);
 await assert.rejects(env.handlers.read_place_website({placeId:'books',url:'https://books.example/guessed'}),/do not guess the URL/);
 await env.handlers.read_place_website({placeId:'books'});
 await assert.rejects(env.handlers.assess_place_offer({...record,quote:'Free access to everything'}),/original text/);
 await env.handlers.assess_place_offer(record);await env.handlers.plan_itinerary({});
 let e=env.output().journey.plans[0].experienceChecks[0];assert.equal(e.status,'supported');assert.equal(e.sourceUrl,page.url);assert.equal(e.evidenceType,'model_interpretation_of_official_page');
 await env.handlers.assess_place_offer({...record,status:'not_supported',quote:'Author talks require a ticket.',explanation:'所需免票讲座与原文不符（控制性测试）。'});
 assert.equal(env.readiness().ready,false);await assert.rejects(env.handlers.select_candidates({activityId:'books',placeIds:['books']}),/website evidence/);
 // A changed requirement must not inherit old semantic support or rejection.
 await env.handlers.update_trip({patch:{activities:[{...trip.activities[0],label:'买一本书'}]}});
 await env.handlers.select_candidates({activityId:'books',placeIds:['books']});await env.handlers.plan_itinerary({});
 e=env.output().journey.plans[0].experienceChecks[0];assert.equal(e.status,'uncertain');assert.equal(e.sourceUrl,undefined);
});

test('checkpoint resumes observed candidates without fresh searches, while calendar is freshly checked',async()=>{
 const svc=services(),env=await prepared(svc);const checkpoint=env.checkpoint();let calendars=0;
 const resumed=createAgentEnvironment({text:'继续',slots:env.output().slots},{...svc,resumeState:checkpoint,maps:{...svc.maps,search:async()=>assert.fail('must reuse observed candidates')},calendarDay:async()=>{calendars++;return {date,own:[],busy:[],connected:true};}});
 assert.equal(resumed.readiness().ready,true);const r=await resumed.handlers.plan_itinerary({});assert.ok(r.alternatives);assert.equal(calendars,1);assert.equal(resumed.output().searches,0);
});

test('runtime emits real progress and timing, saves checkpoints, and cancels before another tool',async()=>{
 const progress=[],snapshots=[],controller=new AbortController();
 const r=await runAgent({text:'查新闻'},config,services(),{signal:controller.signal,onProgress:e=>{progress.push(e);if(e.phase==='tool_done')controller.abort();},saveCheckpoint:s=>snapshots.push(s),fetchImpl:model([['load_skill',{name:'local-discovery'}],['read_news',{}]])});
 assert.equal(r.stopReason,'cancelled');assert.equal(r.toolCount,1);assert.ok(progress.some(e=>e.phase==='model_start'));assert.ok(progress.some(e=>e.phase==='tool_done'));assert.ok(snapshots.length>=2);assert.ok(r.timings.some(t=>t.stage==='model'&&Number.isFinite(t.totalMs)));assert.ok(!r.trace.some(t=>t.action==='read_news'));
});

test('changing the date expires experience interpretation; plan and page budgets remain bounded',async()=>{
 const svc=services(),page={url:'https://books.example/',text:'Public bookshop.',links:[],checkedAt:'2026-10-10T08:00:00Z'};
 svc.maps.details=async()=>({...book,website:page.url});svc.readPlaceWebsite=async()=>page;
 const env=await prepared(svc);await env.handlers.place_details({placeId:'books'});await env.handlers.read_place_website({placeId:'books'});
 await env.handlers.assess_place_offer({activityId:'books',placeId:'books',sourceUrl:page.url,quote:page.text,status:'supported',explanation:'公众书店'});
 await env.handlers.plan_itinerary({});await env.handlers.update_trip({patch:{date:'2026-10-11'}});
 await env.handlers.plan_itinerary({});assert.equal(env.output().journey.plans[0].experienceChecks[0].status,'uncertain');
 await env.handlers.plan_itinerary({});await assert.rejects(env.handlers.plan_itinerary({}),/three schedule checks/);
 for(let i=0;i<3;i++)await env.handlers.read_place_website({placeId:'books'});
 await assert.rejects(env.handlers.read_place_website({placeId:'books'}),/Four website pages/);
});

test('one preflight reports all missing prerequisites without consuming routes or calendar reads',async()=>{
  const svc=services();svc.calendarDay=async()=>{throw Error('must not read yet');};
  const env=createAgentEnvironment({},svc);
  const r=await env.handlers.update_trip({patch:{activities:trip.activities}});
  assert.deepEqual(r.progress.missingFields,['date','origin']);assert.deepEqual(r.progress.missingDecisions,[]);
  assert.equal(r.progress.originSelected,false);
  assert.equal(r.progress.missingCandidates[0].id,'books');
  await assert.rejects(env.handlers.plan_itinerary({}),e=>{
    assert.deepEqual(e.details,r.progress);assert.match(e.message,/departure point/);assert.match(e.message,/逛指定书店/);return true;
  });
  assert.equal(env.output().routeCalls,0);
});

test('duration and reserve changes preserve relevant places but invalidate the schedule; no-op does not',async()=>{
  const env=await prepared();await env.handlers.plan_itinerary({});
  const revision=env.revision;await env.handlers.update_trip({patch:{start:trip.start}});assert.equal(env.revision,revision);assert.equal(env.output().stale,false);
  const r=await env.handlers.update_trip({patch:{activities:[{...trip.activities[0],duration:90,allowance:300}]}});
  assert.equal(r.progress.ready,true);assert.equal(env.output().stale,true);
  const next=await env.handlers.plan_itinerary({});assert.ok(next.alternatives);assert.equal(env.output().searches,2);
  await env.handlers.update_trip({patch:{activities:[{...trip.activities[0],query:'different experience'}]}});
  assert.equal(env.readiness().ready,false);
});

test('a venue result cannot verify a scheduled experience, even when its route fits',async()=>{
  const svc=services(),env=await prepared(svc,{activities:[{...trip.activities[0],label:'书店讲座',availability:'session'}]});
  const r=await env.handlers.plan_itinerary({});
  assert.equal(r.status,'route_draft');assert.deepEqual(r.availabilityPending,[{id:'books',label:'书店讲座'}]);
  assert.match(r.outcome,/sessions have not yet been verified/);assert.match((await env.handlers.calendar_changes({})).handoff,/verify specific sessions/);
  const stored=env.output().slots;assert.equal(stored.activityDefinitions.books.availability,'session');
  // Dated user evidence is the only path that can remove the pending status.
  svc.getChecks=()=>({revision:1,items:{books:{kind:'books',placeId:'books',date,timeStatus:'checked',start:660,duration:60,title:'讲座',timeSource:'user checked schedule',price:null}}});
  const checked=await env.handlers.plan_itinerary({});assert.equal(checked.status,'candidate');assert.deepEqual(checked.availabilityPending,[]);
});

test('reserved final round exposes only response controls, with current evidence and response budget',async()=>{
  const svc=services();const r=await runAgent({text:'查新闻'},config,svc,{maxRounds:4,fetchImpl:model([
    ['load_skill',{name:'local-discovery'}],['read_news',{}],finish('已查到一条新闻，来源见下方。')
  ],(req,i)=>{if(i===2){assert.deepEqual(req.tools.map(t=>t.function.name),['clarify','present_events']);assert.equal(req.tool_choice,'auto');assert.match(req.messages[0].content,/Reply now in plain text/);}})});
  assert.equal(r.stopReason,'finished');assert.equal(r.rounds,3);assert.equal(r.cards.length,1);
});

test('service failure after zero plans preserves actual calendar conflict, assumptions and next options',async()=>{
  const svc=services();svc.calendarDay=async()=>({date,connected:true,own:[],busy:[{start:date+'T00:00:00Z',end:date+'T23:59:00Z'}]});
  const env=await prepared(svc,{start:'09:00',deadline:'19:00',timeMode:'flexible'});await env.handlers.plan_itinerary({});
  assert.equal(env.output().journey.plans.length,0);
  const r=await runAgent({text:'结果呢',slots:env.output().slots,journeyId:'saved'},config,{...svc,previous:svc.saved[0]},{fetchImpl:async(url,opts)=>{if(JSON.parse(opts.body).tools[0].function.name==='commit_turn')return responseCall('commit_turn',resolvedTurn(JSON.parse(opts.body),{intent:'planning',patch:{},sources:[],assumptions:[],categories:[]}));throw Error('offline');}});
  assert.equal(r.stopReason,'service_error');assert.match(r.message,/calendar arrangements/);assert.match(r.message,/09:00–19:00/);assert.match(r.message,/Keep calendar occupancy, compare consecutive free slots/);assert.match(r.message,/Not written to calendar/);
  await env.handlers.update_trip({patch:{date:'2026-10-11'}});
  assert.doesNotMatch(env.fallback('limit'),/existing calendar arrangements block/);assert.match(env.fallback('limit'),/not yet completed route and calendar validation/);
});

test('round exhaustion still reports a freshly computed zero-plan result',async()=>{
  const svc=services(),env=await prepared(svc,{deadline:'10:20'});await env.handlers.plan_itinerary({});
  const r=await runAgent({text:'继续',slots:env.output().slots,journeyId:'saved'},config,{...svc,previous:svc.saved[0]},{maxRounds:1,fetchImpl:async(url,opts)=>JSON.parse(opts.body).tools[0].function.name==='commit_turn'?responseCall('commit_turn',resolvedTurn(JSON.parse(opts.body),{intent:'planning',patch:{},sources:[],assumptions:[],categories:[]})):{ok:true,json:async()=>({choices:[{message:{content:'',tool_calls:[]}}]})}});
  assert.equal(r.stopReason,'limit');assert.match(r.message,/10:00–10:20/);assert.match(r.message,/Activities and transport cannot/);
});


test('short observed handles resolve to real provider IDs for selection, details and routes',async()=>{
  const svc=services(),calls=[];
  const realSearch=svc.maps.search;svc.maps.search=async(...args)=>(await realSearch(...args)).map(p=>({...p,id:'opaque-provider-'+p.id}));
  svc.maps.details=async id=>{calls.push(['details',id]);return {...book,id};};
  svc.maps.route=async(from,to)=>{calls.push(['route',from,to]);return {minutes:10,walking:10,mode:'walk'};};
  const env=createAgentEnvironment({},svc);await env.handlers.update_trip({patch:trip});
  const station=await env.handlers.search_places({query:'Station'}),books=await env.handlers.search_places({query:'Nordic Books'});
  assert.equal(station.candidates[0].id,'place_1');assert.equal(books.candidates[0].id,'place_2');
  await env.handlers.select_candidates({activityId:'origin',placeIds:['place_1']});
  await env.handlers.select_candidates({activityId:'books',placeIds:['place_2']});
  await env.handlers.place_details({placeId:'place_2'});
  await env.handlers.route({from:'place_1',to:'place_2',date,time:'10:00',transport:'walk'});
  assert.deepEqual(calls,[['details','opaque-provider-books'],['route','opaque-provider-station','opaque-provider-books']]);
  assert.doesNotMatch(JSON.stringify(env.context().progress),/opaque-provider/);
  await assert.rejects(env.handlers.select_candidates({activityId:'books',placeIds:['place_999']}),/already queried/);
});


test('clarification saves all five known activities and date without completion-review veto',async()=>{
  const activities=['concert','lunch','waterfront','souvenirs','groceries'].map(id=>({id,label:id,query:id,requiredNames:[],duration:45,allowance:null}));
  let reviews=0;
  const base=model([['clarify',{question:'你从哪个车站出发？',field:'origin',patch:{date,activities}}]]);
  const r=await runAgent({text:'今天听音乐、吃午餐、海边散步、买纪念品和买菜',history:[{role:'user',content:'市区最近有什么新闻和活动？'}]},config,services(),{fetchImpl:async(url,opts)=>{
    const request=JSON.parse(opts.body);
    if(request.tools[0].function.name==='assess_completion'){reviews++;throw Error('clarification must not use completion reviewer');}
    // Intake review now checks repeated questions; it must allow this missing-origin question.
    return base(url,opts);
  }});
  assert.equal(r.stopReason,'needs_input');assert.equal(reviews,0);assert.equal(r.slots.date,date);assert.equal(r.slots.activities.length,5);
  assert.deepEqual(r.slots.task.requests,['今天听音乐、吃午餐、海边散步、买纪念品和买菜']);
  const next=createAgentEnvironment({slots:r.slots},services());await next.handlers.update_trip({patch:{origin:'Station'}});
  assert.equal(next.state.activities.length,5);assert.equal(next.state.date,date);
});

test('a question about an already supplied field is rejected without forgetting facts',async()=>{
  const r=await runAgent({text:'继续',slots:trip},config,services(),{fetchImpl:model([
    ['clarify',{question:'从哪里出发？',field:'origin',patch:{}}],
    ['clarify',{question:'更希望早点回来还是慢慢逛？',field:'preference',patch:{}}]
  ],()=>{},{intent:'discussion',patch:{},sources:[],assumptions:[],categories:[]})});
  assert.equal(r.stopReason,'needs_input');assert.equal(r.slots.origin,'Station');assert.match(r.trace[0].summary,/already recorded/);
});
test('with the essentials recorded, a plan request is planned before any question is asked',async()=>{
  const r=await runAgent({text:'Plan it',slots:trip},config,services(),{fetchImpl:model([
    ['clarify',{question:'Which bookshop do you prefer?',field:'preference',patch:{}}],
    ['search_places',{query:'Nordic Books'}],['select_candidates',{activityId:'books',placeIds:['books']}],['plan_itinerary',{}],finish('Planned.')
  ])});
  assert.equal(r.stopReason,'finished');assert.match(r.trace[0].summary,/plan_itinerary has not run/);assert.ok(r.journey.plans.length);
});
test('a long published occurrence is a drop-in window, not a session to sit through',async()=>{
  const market={ref:'event_abcdefabcdef',title:'Flea market',description:'Stalls.',venue:'Nordic Books',start:date,end:date,url:'https://fixture.invalid/market',occurrences:[{date,start:'09:00',end:'15:00'}],location:book.location};
  const svc={...services(),evidence:[market],eventDetails:async()=>market};
  const env=createAgentEnvironment({text:'plan',slots:{...trip,deadline:'18:00',activities:[{...trip.activities[0],query:'Nordic Books',eventRef:market.ref,duration:60}]}},svc);
  const r=await env.handlers.plan_itinerary({});
  assert.ok(r.planChoices.length>0);const stop=env.output().journey.plans[0].stops[0];
  assert.equal(stop.end-stop.start,60);assert.ok(stop.start>=540&&stop.end<=900);assert.ok(env.output().journey.notes.some(n=>/open 09:00–15:00/.test(n)));
});

test('discovered event evidence survives a new turn and anchors published times',async()=>{
  const event={ref:'event_0123456789ab',type:'event',title:'Fictional performance',venue:'Nordic Books',url:'https://www.visitstockholm.com/events/fixture/next/',occurrences:[{date,start:'21:00',end:'22:00'}],scheduleStatus:'confirmed',ticketStatus:'unknown'};
  const svc=services();let savedEvidence;
  svc.nearbyEvents=async()=>({events:[event],message:'source schedule',origin:'Station'});
  svc.saveEvidence=events=>{savedEvidence=events;return 'test-context';};
  const first=createAgentEnvironment({},svc);await first.handlers.nearby_events({date:'2026-10-10',origin:'Station',days:1});
  const slots=first.output().slots;assert.equal(slots.evidenceId,'test-context');
  const second=createAgentEnvironment({slots},{...svc,evidence:savedEvidence,eventDetails:async()=>event});
  assert.equal(second.context().eventEvidence[0].occurrences[0].start,'21:00');
  await second.handlers.update_trip({patch:{...trip,activities:[{...trip.activities[0],eventRef:event.ref}]}});
  await second.handlers.search_places({query:'Station'});await second.handlers.select_candidates({activityId:'origin',placeIds:['station']});
  await second.handlers.search_places({query:'Nordic Books'});await second.handlers.select_candidates({activityId:'books',placeIds:['books']});
  const result=await second.handlers.plan_itinerary({});
  assert.ok(result.alternatives);assert.equal(second.output().journey.plans[0].stops[0].start,21*60);
  assert.equal(second.output().journey.plans[0].stops[0].verification.reportedBy,'source');
  assert.equal(second.output().journey.plans[0].stops[0].tentative,true);
  await assert.rejects(second.handlers.update_trip({patch:{activities:[{...trip.activities[0],eventRef:'event_999999999999'}]}}),/Event evidence is expired/);
});


test('a departure point the user never named is kept, labelled as assumed; one they named is labelled as said',async()=>{
 const r=await runAgent({text:'今天去音乐会和吃饭'},config,services(),{fetchImpl:model([
 ['load_skill',{name:'plan-outing'}],['update_trip',{patch:{...trip,origin:'Sergels torg'}}],finish('I assumed you start at Sergels torg.')
 ],()=>{},{intent:'discussion',patch:{},sources:[],assumptions:[],categories:[]})});
 assert.equal(r.stopReason,'finished');assert.equal(r.slots.origin,'Sergels torg');assert.equal(r.slots.labels.origin,'assistant');assert.equal(r.slots.labels['activity:books'],'assistant');
 const env=createAgentEnvironment({text:'I will leave from Sergels torg'},services());await env.handlers.update_trip({patch:{...trip,origin:'Sergels torg'}});
 assert.equal(env.state.labels.origin,'user');assert.equal(env.state.labels.date,'assistant');
 // “tomorrow” in the user's words makes the date theirs, whoever recorded it.
 const tomorrow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'}).format(Date.now()+86400000);
 const dated=createAgentEnvironment({text:'Tomorrow, from Sergels torg'},services());await dated.handlers.update_trip({patch:{date:tomorrow}});
 assert.equal(dated.state.labels.date,'user');
});
test('event presentation preserves unknown schedules and continues to a final reply',async()=>{
 const event={ref:'event_0123456789ab',title:'Fixture',venue:'Hall',start:date,end:'2027-06-17',url:'https://www.visitstockholm.com/events/fixture/next/',occurrences:[],scheduleStatus:'date_only',distance:1,distanceOrigin:'Station'};
 const svc=services();svc.nearbyEvents=async()=>({events:[event],message:'date only'});
 let observed=false;
 const r=await runAgent({text:'今天有什么活动'},config,svc,{fetchImpl:model([
 ['load_skill',{name:'local-discovery'}],['nearby_events',{date:'2026-10-10',origin:'Station',days:1}],['present_events',{eventRefs:[event.ref]}],['finish',{mode:'discussion',message:'Fixture has specific occurrences unverified; check the event source first.'}]
 ],(req,i)=>{if(i===3){observed=true;assert.match(req.messages.at(-1).content,/specific occurrences unverified/);}})});
 assert.ok(observed);assert.equal(r.stopReason,'finished');assert.match(r.message,/specific occurrences unverified/);assert.doesNotMatch(r.message,/from  Station/);
});

test('a saved clarification cannot be completed by an invented timetable before the planner has run',async()=>{
 const svc=services();const slots={...trip,origin:null,task:{kind:'planning',status:'active'}};
 const r=await runAgent({text:'from Station 出发，继续规划',slots},config,svc,{fetchImpl:model([
 finish('已规划完成，换一个演出，20:00出发。'),
 ['search_places',{query:'Nordic Books'}],['select_candidates',{activityId:'books',placeIds:['books']}],
 ['plan_itinerary',{}],finish('Nordic Books 符合你指定的书店要求，当前候选已经排好。')
 ],()=>{},{intent:'planning',patch:{origin:'Station',originQuote:'Station'},sources:[{field:'origin',messageIndices:[0]}],assumptions:[],categories:[]})});
 assert.ok(r.journey.plans.length);assert.equal(r.slots.activities.length,1);assert.match(r.trace[0].summary,/plan_itinerary has not run/);assert.doesNotMatch(r.message,/换一个演出|Mountain Goats/);assert.match(r.message,/Nordic Books/);
});

test('an activity window is labelled by whether the user’s own timing words support it',async()=>{
 const env=createAgentEnvironment({text:'Visit the bookstore at noon，其他时间随意'},services());
 await env.handlers.update_trip({patch:{activities:[{...trip.activities[0],windowStart:'16:00',windowEnd:'17:00'}]}});
 assert.equal(env.state.labels['window:books'],'assistant');
 await env.handlers.update_trip({patch:{activities:[{...trip.activities[0],windowStart:'12:00',windowEnd:'14:00',windowQuote:'Visit the bookstore at noon'}]},assumptions:['Noon provisionally means 12:00–14:00']});
 assert.equal(env.state.activityDefinitions.books.windowStart,'12:00');assert.equal(env.output().slots.activityDefinitions.books.windowQuote,'Visit the bookstore at noon');assert.equal(env.state.labels['window:books'],'user');
});

test('batch candidate preparation binds missing groups within the same search budget and preserves existing choices',async()=>{
 const svc=services(),env=createAgentEnvironment({},svc);
 await env.handlers.update_trip({patch:{...trip,budgetMode:'unknown',activities:[{...trip.activities[0],query:'Nordic Books'}]}});
 await env.handlers.set_budget({mode:'unlimited',amount:null});
 const result=await env.handlers.discover_candidates({});
 assert.equal(result.progress.ready,true);assert.equal(result.groups.books[0].name,'Nordic Books');assert.equal(env.output().searches,2);
 await env.handlers.discover_candidates({});assert.equal(env.output().searches,2);
 await env.handlers.plan_itinerary({});assert.ok(env.output().journey.plans.length);assert.equal(env.state.budgetMode,'unlimited');
});

test('committed broad time window reaches planning before routes without review loops',async()=>{
 const svc=services(),a={...trip.activities[0],query:'Nordic Books',availability:'venue',eventRef:null,windowStart:'12:00',windowEnd:'14:00',windowQuote:'Visit the bookstore at noon'};
 const r=await runAgent({text:'Visit the bookstore at noon',slots:trip},config,svc,{fetchImpl:model([
 ['load_skill',{name:'plan-outing'}],['discover_candidates',{}],['plan_itinerary',{}],finish('Complete')
 ],()=>{},{intent:'planning',patch:{activities:[a]},sources:[{field:'activities',messageIndices:[0]}],assumptions:['Noon provisionally means 12:00–14:00'],categories:[]})});
 assert.ok(r.journey.plans.length);assert.ok(r.journey.plans.every(p=>p.stops[0].start>=720&&p.stops[0].end<=840));assert.equal(r.message,'Complete');assert.ok(r.assumptions.some(a=>/Noon provisionally/.test(a)));assert.ok(r.journey.notes.some(n=>/Noon provisionally/.test(n)));
});

test('quoting an activity with no timing makes its window an assumption, which the planner may drop',async()=>{
 for(const quote of ['Lunch at noon','at 14:30','in the afternoon','at 2 pm'])assert.equal(hasTimeAnchor(quote),true);
 for(const quote of ['购买一些纪念品','去Gamla Stan的海边走走','visit a shop'])assert.equal(hasTimeAnchor(quote),false);
 const env=createAgentEnvironment({text:'购买一些纪念品'},services());
 await env.handlers.update_trip({patch:{...trip,start:'10:00',deadline:'12:00',activities:[{...trip.activities[0],query:'Nordic Books',label:'纪念品',windowStart:'16:00',windowEnd:'17:00',windowQuote:'购买一些纪念品'}]}});
 assert.equal(env.state.labels['window:books'],'assistant');
 // 16:00–17:00 cannot fit a 10:00–12:00 day; the assumed window is let go and reported.
 const r=await env.handlers.plan_itinerary({});
 assert.ok(r.planChoices.length>0);assert.match(r.relaxedAssumptions[0],/16:00–17:00/);assert.equal(env.state.activityDefinitions.books.windowStart,null);assert.equal(env.state.labels['window:books'],undefined);
 assert.ok(env.output().journey.notes.some(n=>/dropped that assumption/.test(n)));assert.equal(env.output().stale,false);
});
test('a clock time the user said is theirs however the quote is worded, and stays theirs on a rewrite',async()=>{
 const texts=['we will meet in the morning at 10:00','see you at 10','dinner 7 pm','by 18.30 please'];
 const env=createAgentEnvironment({text:texts.join('. ')},services());
 const act=(id,windowStart,windowEnd)=>({...trip.activities[0],id,windowStart,windowEnd,windowQuote:'a paraphrase the user never typed'});
 await env.handlers.update_trip({patch:{activities:[act('a','10:00','11:00'),act('b','19:00','21:00'),act('c','17:00','18:30'),act('d','15:00','16:00')]}});
 const l=env.state.labels;assert.equal(l['window:a'],'user');assert.equal(l['window:b'],'user');assert.equal(l['window:c'],'user');assert.equal(l['window:d'],'assistant');
 await env.handlers.update_trip({patch:{activities:[act('a','10:00','12:00'),act('b','19:00','21:00'),act('c','17:00','18:30'),act('d','15:00','16:00')]}});
 assert.equal(env.state.labels['window:a'],'user');
});
test('a time the user stated is a requirement the planner never drops',async()=>{
 const env=createAgentEnvironment({text:'souvenirs at 16:00'},services());
 await env.handlers.update_trip({patch:{...trip,start:'10:00',deadline:'12:00',activities:[{...trip.activities[0],query:'Nordic Books',windowStart:'16:00',windowEnd:'17:00',windowQuote:'souvenirs at 16:00'}]}});
 assert.equal(env.state.labels['window:books'],'user');
 const r=await env.handlers.plan_itinerary({});assert.equal(r.planChoices.length,0);assert.equal(r.relaxedAssumptions,undefined);assert.equal(env.state.activityDefinitions.books.windowStart,'16:00');
});

test('host discloses interpreted activity windows even when the narrator omits assumptions',async()=>{
 const env=await prepared(services(),{activities:[{...trip.activities[0],windowStart:'12:00',windowEnd:'14:00',windowQuote:'noon'}]});
 await env.handlers.plan_itinerary({});
 assert.deepEqual(env.assumptions,[]);assert.match(env.checkedReply(),/Activity time explanation:.*noon.*12:00–14:00/);
 assert.ok(env.output().journey.notes.some(n=>n.includes('Activity time explanation')));
});

test('an unfinished revision retains the last checked attempt with an explicit stale-result boundary',async()=>{
 const env=await prepared(services(),{deadline:'10:20'});await env.handlers.plan_itinerary({});
 await env.handlers.update_trip({patch:{deadline:'12:00'}});
 const out=env.output();assert.equal(out.journey,undefined);assert.equal(out.lastAttempt.plansCount,0);assert.equal(out.lastAttempt.constraints.deadline,'10:20');assert.equal(out.slots.deadline,'12:00');
 assert.match(env.fallback('limit'),/most recent verified attempt/);assert.match(env.fallback('limit'),/not been re.?verified/);assert.match(env.fallback('limit'),/10:00–10:20/);
 await env.handlers.update_trip({patch:{date:'2026-10-11'}});assert.equal(env.output().lastAttempt,null);
});

test('intake checker cannot promote assistant suggestions or populated fields into missing user requirements',async()=>{
 const r=await reviewTripIntent({users:['from Station 出发，Visit the bookstore at noon，购买纪念品'],trip:{...trip},assumptions:[]},config,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'check_trip_intent',arguments:JSON.stringify({missing:[
 {quote:'晚上去另一场演唱会',field:'activity',activityId:null},
 {quote:'from Station Depart',field:'origin',activityId:null},
 {quote:'Visit the bookstore at noon',field:'activity_time',activityId:'books'},
 {quote:'购买纪念品',field:'activity_time',activityId:'books'}
 ]})}}]}}]})})});
 assert.equal(r.issues.length,1);assert.match(r.issues[0],/Visit the bookstore at noon/);assert.doesNotMatch(r.issues[0],/另一场/);
});
test('explicit ordering review requires a user quote and valid activity IDs and accepts a recorded edge',async()=>{
 const current={...trip,activities:[...trip.activities,{id:'meal',label:'吃饭'}]},quote='先逛书店再吃饭';
 const check=async(missing,state=current)=>reviewTripIntent({users:[quote],trip:state,assumptions:[]},config,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'check_trip_intent',arguments:JSON.stringify({missing})}}]}}]})})});
 const issue={quote,field:'activity_order',activityId:null,beforeId:'books',afterId:'meal'};
 assert.equal((await check([issue])).ready,false);
 assert.equal((await check([issue],{...current,precedence:[{before:'books',after:'meal'}]})).ready,true);
 assert.equal((await check([{...issue,quote:'not user words'},{...issue,afterId:'invented'}])).ready,true);
});
test('leave time, return time and budget are optional: a plan needs none, and none is saved as a condition',async()=>{
 const svc=services(),env=createAgentEnvironment({text:'plan',slots:{...trip,start:null,deadline:null,timeMode:'unknown',budgetMode:'unknown',budget:null,activities:[{...trip.activities[0],query:'Nordic Books'}]}},svc);
 assert.equal(env.readiness().missingFields.length,0);
 const r=await env.handlers.plan_itinerary({});
 assert.ok(r.planChoices.length>0);assert.equal(svc.saved.length,1);
 assert.equal(env.state.start,null);assert.equal(env.state.deadline,null);assert.equal(env.state.budgetMode,'unknown');assert.deepEqual(env.state.labels,{});assert.deepEqual(env.assumptions,[]);
 assert.deepEqual(env.output().journey.open,{start:true,deadline:true,budget:true});
 assert.equal(r.constraints.start,null);assert.equal(r.constraints.deadline,null);assert.equal(r.userLimits.time.source,'none');assert.equal(r.userLimits.budget.mode,'none');
 assert.doesNotMatch(JSON.stringify([r.requiredCaveats,env.output().journey.notes]),/tentatively set|10:00–24:00/);
 // A stated return time still binds.
 const strict=createAgentEnvironment({text:'back by 10:20',slots:{...trip,start:null,deadline:'10:20',timeMode:'fixed',activities:[{...trip.activities[0],query:'Nordic Books'}]}},services());
 const none=await strict.handlers.plan_itinerary({});assert.equal(none.planChoices.length,0);assert.equal(none.constraints.deadline,'10:20');assert.equal(none.constraints.start,null);
});
test('diagnostics retain clarification arguments and exact state transition, including a held reply, without credentials',async()=>{
 const audit=[];const r=await runAgent({text:'No budget limit',slots:{...trip,budgetMode:'unknown',task:{kind:'planning',status:'active'}}},config,services(),{onDiagnostic:e=>audit.push(e),fetchImpl:model([
 finish('已安排好了'),['clarify',{question:'想逛多久？',field:'preference',patch:{budgetMode:'unlimited'}}]
 ])});
 const actions=audit.filter(e=>e.kind==='tool_result');assert.match(audit.find(e=>e.kind==='reply_held').reason,/plan_itinerary has not run/);
 assert.equal(actions[0].arguments.patch.budgetMode,'unlimited');assert.equal(actions[0].before.budgetMode,'unknown');assert.equal(actions[0].after.budgetMode,'unlimited');assert.ok(actions[0].changedFields.includes('budgetMode'));
 assert.equal(r.trace.at(-1).input.patch.budgetMode,'unlimited');assert.ok(audit.some(e=>e.kind==='model_request'&&e.body.messages.some(m=>m.content==='No budget limit')));assert.doesNotMatch(JSON.stringify(audit),/Bearer|Authorization|reasoning_content/);
});
test('discussion can answer a recommendation while the unscheduled task stays active',async()=>{
 const r=await runAgent({text:'哪个更适合轻松逛逛？',slots:{...trip,task:{kind:'planning',status:'active'}}},config,services(),{fetchImpl:model([
 ['finish',{message:'我建议先保留书店，逛多久容易调整；路线和营业时间还需要核实。'}]
 ],()=>{},{intent:'discussion',patch:{},sources:[],assumptions:[],categories:[]})});
 assert.equal(r.outcome,'discussion');assert.equal(r.slots.task.status,'active');assert.equal(r.journey,undefined);assert.match(r.message,/我建议/);assert.ok(!r.trace.some(t=>t.status==='error'));
});
test('discussion is delivered directly without demanding numeric timing or review verdicts',async()=>{
 const stages=[];
 const r=await runAgent({text:'先讨论，不排程',slots:{...trip,start:null,deadline:null,timeMode:'unknown',task:{kind:'planning',status:'active'}}},config,services(),{onDiagnostic:e=>{if(e.kind==='model_request')stages.push(e.body.tools[0].function.name);},fetchImpl:model([
 ['finish',{message:'我建议先逛书店，把午餐放在后面；具体营业时间还没有核实。'}]
 ],()=>{},{intent:'discussion',patch:{},sources:[],assumptions:[],categories:[]})});
 assert.equal(r.stopReason,'finished');assert.equal(r.outcome,'discussion');assert.equal(r.slots.start,null);assert.equal(r.slots.task.status,'active');
 assert.deepEqual(stages,['commit_turn','load_skill']);
});
test('a committed unlimited budget prevents a repeated budget clarification',async()=>{
 const r=await runAgent({text:'你推荐就好',history:[{role:'user',content:'no budget limit'}],slots:{...trip,budgetMode:'unknown',task:{kind:'planning',status:'active'}}},config,services(),{fetchImpl:model([
 ['clarify',{question:'预算多少？',field:'budget',patch:{}}],['finish',{mode:'discussion',message:'费用不设上限，具体价格仍需核实。'}]
 ],()=>{},{intent:'discussion',patch:{budgetMode:'unlimited',budget:null},sources:[{field:'budgetMode',messageIndices:[0]},{field:'budget',messageIndices:[0]}],assumptions:[],categories:[]})});
 assert.equal(r.slots.budgetMode,'unlimited');assert.equal(r.outcome,'discussion');assert.match(r.trace[0].summary,/never asked for/);assert.doesNotMatch(r.message,/预算多少/);
});
test('incidental discovery does not force an event list instead of answering a discussion',async()=>{
 const svc=services();svc.nearbyEvents=async()=>({events:[{ref:'event_0123456789ab',title:'Unrelated event',venue:'Hall',url:'https://www.visitstockholm.com/events/fixture/',occurrences:[]}],message:'one event'});
 const r=await runAgent({text:'先讨论博物馆还是书店，不要排程'},config,svc,{fetchImpl:model([
 ['load_skill',{name:'local-discovery'}],['nearby_events',{date:'2026-10-10',origin:'Station',days:1}],['finish',{mode:'discussion',message:'我建议书店，停留时间更容易自己掌握；具体店铺还未核实。'}]
 ])});
 assert.equal(r.outcome,'discussion');assert.match(r.message,/我建议书店/);assert.doesNotMatch(r.message,/Unrelated event/);
});
test('one grounded interpretation commits budget and records its actual state transition',async()=>{
 const audit=[];
 const r=await runAgent({text:'钱这方面不用卡额度',slots:{...trip,budgetMode:'unknown',task:{kind:'planning',status:'active'}}},config,services(),{onDiagnostic:e=>audit.push(e),fetchImpl:model([
 ['clarify',{question:'想多留时间在店里，还是路上？',field:'preference',patch:{}}]
 ],()=>{},{intent:'clarification',patch:{budgetMode:'unlimited',budget:null},sources:[{field:'budgetMode',messageIndices:[0]},{field:'budget',messageIndices:[0]}],assumptions:[],categories:[]})});
 assert.equal(r.slots.budgetMode,'unlimited');assert.equal(r.stopReason,'needs_input');
 const commit=audit.find(e=>e.kind==='turn_committed');assert.equal(commit.before.budgetMode,'unknown');assert.equal(commit.after.budgetMode,'unlimited');assert.match(r.trace.at(-1).summary,/unlimited/);
});
test('exclusive choices preserve unselected alternatives but schedule only the selected member, including after resume',async()=>{
 const svc=services(),quote='from Station 出发，两家书店只去一个，你决定';
 const alternatives=[{...trip.activities[0],id:'a',label:'书店甲',query:'Nordic Books'},{...trip.activities[0],id:'b',label:'书店乙',query:'Unavailable shop',requiredNames:[]}];
 const group={id:'books',options:['a','b'],selected:'a',selectionBy:'assistant',userQuote:'两家书店只去一个',delegationQuote:'你决定',reason:'优先查看匹配的地点'};
 const env=createAgentEnvironment({text:quote},svc);await env.handlers.update_trip({patch:{...trip,activities:alternatives,choiceGroups:[group]}});await env.handlers.discover_candidates({});
 assert.ok(!svc.queries.includes('Unavailable shop'));await env.handlers.plan_itinerary({});
 assert.ok(env.output().journey.plans.every(p=>p.stops.length===1&&p.stops[0].kind==='a'));assert.deepEqual(env.state.activities,['a','b']);
 const restored=createAgentEnvironment({text:quote},{...svc,resumeState:env.checkpoint()});assert.deepEqual(restored.state.choiceGroups,[group]);
 await restored.handlers.update_trip({patch:{start:'11:00'}});assert.equal(restored.state.budgetMode,'unlimited');assert.deepEqual(restored.state.choiceGroups,[group]);
 await assert.rejects(restored.handlers.update_trip({patch:{budgetMode:'unknown'}}),/must not become unknown/);assert.equal(restored.state.budgetMode,'unlimited');
 await restored.handlers.select_option({groupId:'books',activityId:'b',reason:'比较另一家',delegationQuote:'你决定'});assert.equal(restored.state.choiceGroups[0].selected,'b');assert.deepEqual(restored.state.activities,['a','b']);
 await assert.rejects(restored.handlers.update_trip({patch:{choiceGroups:[{...group,selected:'outside'}]}}),/belong/);
});
test('an unresolved choice blocks planning until one alternative is selected',async()=>{
 const svc=services(),env=createAgentEnvironment({text:'from Station 出发，两家只去一个'},svc),activities=[{...trip.activities[0],id:'a'},{...trip.activities[0],id:'b'}];
 const group={id:'books',options:['a','b'],selected:null,selectionBy:'pending',userQuote:'两家只去一个',delegationQuote:'',reason:''};
 await env.handlers.update_trip({patch:{...trip,activities,choiceGroups:[group]}});await env.handlers.discover_candidates({});await assert.rejects(env.handlers.plan_itinerary({}),/Option group /);assert.equal(svc.saved.length,0);
 await env.handlers.select_option({groupId:'books',activityId:'a',reason:'Closer to the station.',delegationQuote:''});
 assert.equal(env.state.choiceGroups[0].selectionBy,'assistant');
});
test('checked plan gets a direct model explanation while write tools remain unavailable',async()=>{
 const svc=services(),stages=[];
 const r=await runAgent({text:'from Station 安排去指定书店'},config,svc,{onDiagnostic:e=>{if(e.kind==='model_request')stages.push(e.body.tools[0].function.name);},fetchImpl:model([
 ['load_skill',{name:'plan-outing'}],['update_trip',{patch:{...trip,activities:[{...trip.activities[0],query:'Nordic Books'}]}}],['discover_candidates',{}],['plan_itinerary',{}],
 finish('我推荐这家书店，因为它符合你指定的地点；路线已检查，实际服务仍待核实。')
 ],req=>assert.ok(req.tools.every(t=>!/book_merchant|confirm_calendar|create_event/.test(t.function.name))))});
 assert.match(r.message,/我推荐这家书店/);assert.ok(r.journey.plans.length);assert.ok(!stages.some(s=>['assess_completion','check_trip_intent'].includes(s)));
});

test('planning clarification refuses a date-only patch that loses all requested activities',async()=>{
 const r=await runAgent({text:'今天想逛书店，帮我规划'},config,services(),{fetchImpl:model([
 ['clarify',{question:'从哪里出发？',field:'origin',patch:{date}}],
 ['clarify',{question:'从哪里出发？',field:'origin',patch:{activities:trip.activities}}]
 ])});
 assert.match(r.trace[0].summary,/all user.?stated activities/);assert.equal(r.slots.activities.length,1);assert.equal(r.slots.date,date);assert.equal(r.slots.task.status,'active');assert.equal(r.stopReason,'needs_input');
});

test('user may pause a pending plan to discuss something else without losing requirements',async()=>{
 const slots={...trip,task:{kind:'planning',status:'active'}};
 const r=await runAgent({text:'先不规划了，聊聊其他事情',slots},config,services(),{fetchImpl:model([
 ['pause_planning',{userQuote:'先不规划了'}],finish('好，行程需求保留着。')
 ])});
 assert.equal(r.slots.task.status,'paused');assert.equal(r.slots.activities.length,1);assert.equal(r.journey,undefined);
});
