import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../lib/agent.mjs';
import {modelResponse} from '../lib/model-response.mjs';
import {createAgentEnvironment} from '../lib/agent-tools.mjs';

const resolvedTurn=(req,turn)=>{const trip=JSON.parse(req.messages[0].content.split('Interpretation context (data):\n').at(-1)).trip;return {...turn,patch:{...Object.fromEntries(['budgetMode','budget','timeMode','start','deadline'].map(k=>[k,trip[k]])),...turn.patch}};};
const config={key:'fixture',base:'https://model.invalid',model:'fixture'};
// A scripted finish step stands for the model answering in plain text.
const replyText=a=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:[a.message,...(a.sections||[]).map(s=>s.text)].filter(Boolean).join('\n\n')}}]})});
const response=(name,args,reason='tool_calls')=>name==='finish'&&reason==='tool_calls'?replyText(args):({ok:true,json:async()=>({choices:[{finish_reason:reason,message:{tool_calls:[{id:'fixture',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})});
const turn=(patch={},sources=[],categories=[])=>({intent:'update',patch,sources,categories,assumptions:[]});
function model(commit,steps,inspect=()=>{}) {let i=0;return async(url,opts)=>{const req=JSON.parse(opts.body);if(req.tools[0].function.name==='commit_turn')return response('commit_turn',resolvedTurn(req,commit));inspect(req);assert.ok(steps[i],'Unexpected model request');return response(...steps[i++]);};}
const trip={date:'2026-10-09',origin:'KTH',start:'10:00',deadline:'18:00',timeMode:'fixed',budgetMode:'limited',budget:1000,transport:'transit',activities:[{id:'museum',label:'博物馆',query:'museum',requiredNames:[],duration:60,allowance:null,availability:'venue',eventRef:null,windowStart:null,windowEnd:null,windowQuote:null}]};

test('sparse correction is saved before actor reply, checkpointed and retained next turn',async()=>{
 const patch={budgetMode:'limited',budget:500,maxWalking:10},quote='Budget500，步行最多10 minutes';
 const audit=[],checkpoints=[];
 const r=await runAgent({text:quote,slots:trip},config,{}, {onDiagnostic:e=>audit.push(e),saveCheckpoint:c=>checkpoints.push(c),fetchImpl:model(turn(patch,Object.keys(patch).map(field=>({field,messageIndices:[0]}))),[['finish',{message:'Budget500，步行最多10minutes.'}]],req=>{
  const state=JSON.parse(req.messages[0].content.split('Current authoritative state: ').at(-1));
  assert.equal(state.trip.budget,500);assert.equal(state.trip.maxWalking,10);assert.equal(state.trip.transport,'transit');
 })});
 assert.equal(r.slots.budget,500);assert.equal(r.slots.maxWalking,10);assert.equal(r.slots.transport,'transit');assert.deepEqual(r.slots.activities,['museum']);
 assert.ok(audit.find(e=>e.kind==='turn_committed'&&e.after.budget===500));assert.ok(checkpoints.length>1);
 const next=await runAgent({text:'先聊聊',slots:r.slots,checkpoint:checkpoints.at(-1)},config,{}, {fetchImpl:model(turn(),[['finish',{message:'可以继续讨论。'}]])});
 assert.equal(next.slots.budget,500);assert.equal(next.slots.maxWalking,10);
});

test('unlimited budget and absent return deadline are distinct from unanswered conditions',async()=>{
 const patch={budgetMode:'unlimited',budget:null,deadline:null,timeMode:'flexible'},quote='No return time and no budget limit';
 const r=await runAgent({text:quote,slots:trip},config,{}, {fetchImpl:model(turn(patch,Object.keys(patch).map(field=>({field,messageIndices:[0]}))),[['finish',{message:'费用和返回时间不设上限。'}]])});
 assert.equal(r.slots.budgetMode,'unlimited');assert.equal(r.slots.budget,null);assert.equal(r.slots.deadline,null);assert.equal(r.slots.start,'10:00');
});

test('a number the user never said is kept but labelled as assumed; one they said is labelled as theirs',async()=>{
 const r=await runAgent({text:'先聊聊，步行最多10 minutes',slots:trip,history:[{role:'assistant',content:'500kronor'}]},config,{}, {fetchImpl:model(turn({budget:500,maxWalking:10}),[['finish',{message:'可以继续讨论。'}]])});
 assert.equal(r.stopReason,'finished');assert.equal(r.slots.budget,500);assert.equal(r.slots.labels.budget,'assistant');assert.equal(r.slots.maxWalking,10);
 const said=await runAgent({text:'budget 300 SEK',slots:trip},config,{}, {fetchImpl:model(turn({budget:300}),[['finish',{message:'OK.'}]])});
 assert.equal(said.slots.budget,300);assert.equal(said.slots.labels.budget,'user');assert.deepEqual(said.turnReceipt.committedFields,['budget']);
});

test('a change the model forgot to cite is attributed to the current message, not discarded',async()=>{
 const activities=[...trip.activities,{...trip.activities[0],id:'walk',label:'Walk around Gamla Stan',query:'Gamla Stan'}];
 const r=await runAgent({text:'also take a walk around Gamla Stan',slots:trip},config,{}, {fetchImpl:model(turn({activities},[]),[['finish',{mode:'discussion',message:'Added the walk.'}]])});
 assert.equal(r.stopReason,'finished');assert.deepEqual(r.slots.activities,['museum','walk']);assert.equal(r.slots.budget,1000);
});

test('the same tool call repeated in one response runs once',async()=>{
 let reads=0,main=0;const twice={ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[1,2].map(n=>({id:'n'+n,type:'function',function:{name:'read_news',arguments:'{}'}}))}}]})};
 const r=await runAgent({text:'news?'},config,{readNews:async()=>{reads++;return {cards:[]};}},{fetchImpl:async(url,opts)=>{const req=JSON.parse(opts.body);if(req.tools[0].function.name==='commit_turn')return response('commit_turn',resolvedTurn(req,{...turn({},[],['news']),intent:'information'}));return ++main===1?twice:response('finish',{message:'Nothing new today.'});}});
 assert.equal(r.stopReason,'finished');assert.equal(reads,1);assert.equal(r.toolCount,1);assert.equal(r.message,'Nothing new today.');
});

test('an unsupported activity window or invented order is kept as an assumption; stated ones are the user’s',async()=>{
 const party={ref:'event_0123456789ab',title:'Book release party',description:'Twelve authors.',venue:'Estniska Huset',start:'2026-10-09',end:'2026-10-09',url:'https://fixture.invalid/event',occurrences:[{date:'2026-10-09',start:'18:00',end:'20:00'}]};
 const text='I am interested in the book release party, we will meet in the morning at 10:00, and I also need to buy some groceries. Make a plan';
 const base=trip.activities[0],activities=[{...base,id:'meet',label:'Meet friend',query:'KTH',windowStart:'10:00',windowEnd:'11:00',windowQuote:'we will meet in the morning at 10:00'},{...base,id:'party',label:'Book release party',query:'Estniska Huset',windowStart:'18:00',windowEnd:'20:00',windowQuote:'I am interested in the book release party'},{...base,id:'food',label:'Groceries',query:'grocery store'}];
 const audit=[];let context;
 const r=await runAgent({text,slots:{...trip,activities:[]}},config,{evidence:[party]}, {onDiagnostic:e=>audit.push(e),fetchImpl:async(url,opts)=>{const req=JSON.parse(opts.body);if(req.tools[0].function.name!=='commit_turn')return response('finish',{mode:'discussion',message:'Saved.'});context=JSON.parse(req.messages[0].content.split('Interpretation context (data):\n').at(-1));return response('commit_turn',resolvedTurn(req,{...turn({activities,precedence:[{before:'meet',after:'party'},{before:'party',after:'food'}]},[{field:'activities',messageIndices:[0]},{field:'precedence',messageIndices:[0]}]),intent:'discussion'}));}});
 assert.equal(r.stopReason,'finished');assert.deepEqual(r.slots.activities,['meet','party','food']);assert.equal(r.slots.precedence.length,2);
 assert.equal(r.slots.activityDefinitions.meet.windowStart,'10:00');assert.equal(r.slots.activityDefinitions.party.windowStart,'18:00');
 const l=r.slots.labels;assert.equal(l.precedence,'assistant');assert.equal(l['window:meet'],'user');assert.equal(l['window:party'],'assistant');assert.equal(l['activity:food'],'user');assert.equal(l['window:food'],undefined);
 // The interpreter can see discovered events, so it can link one instead of guessing a window.
 assert.deepEqual(context.events,[{ref:party.ref,title:party.title,venue:party.venue,occurrences:party.occurrences}]);
});

test('one invalid field is rejected alone; an explicit order is kept',async()=>{
 const text='First the museum, then groceries, with a budget of 300';
 const activities=[trip.activities[0],{...trip.activities[0],id:'food',label:'Groceries',query:'grocery store'}];
 const r=await runAgent({text,slots:trip},config,{}, {fetchImpl:model({...turn({activities,precedence:[{before:'museum',after:'food'}],budget:300,deadline:'25:99'},['activities','precedence','budget','deadline'].map(field=>({field,messageIndices:[0]}))),intent:'discussion'},[['finish',{mode:'discussion',message:'Saved.'}]])});
 assert.equal(r.stopReason,'finished');assert.deepEqual(r.slots.activities,['museum','food']);assert.deepEqual(r.slots.precedence,[{before:'museum',after:'food'}]);assert.equal(r.slots.budget,300);assert.equal(r.slots.deadline,'18:00');
 assert.ok(r.trace.some(t=>t.status==='error'&&/^deadline:/.test(t.summary)));
});

test('event search covers the day asked about, not always today',async()=>{
 const {nearbyEvents}=await import('../lib/nearby-events.mjs');
 const item=(id,date)=>({id,title:'Event '+id,href:'https://www.visitstockholm.com/events/e'+id+'/',startDate:date,endDate:date,venueName:'Hall',categories:[],location:{latitude:59.33,longitude:18.06}});
 const page=data=>'<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{componentProps:data}}})+'</script>';
 const list=[item(1,'2026-10-09'),item(2,'2026-10-10')];
 const fetchImpl=async url=>{const one=list.find(e=>e.href===String(url));return {ok:true,text:async()=>one?page({event:{...one,description:'d',occurrences:[{date:one.startDate,startTime:'18:00',endTime:'20:00'}]}}):page({contentBlocks:[],events:list})};};
 const r=await nearbyEvents('Station',{search:async()=>[{name:'Station',location:{latitude:59.33,longitude:18.06}}]},{days:1,from:'2026-10-10',fetchImpl});
 assert.deepEqual(r.events.map(e=>e.title),['Event 2']);assert.equal(r.from,'2026-10-10');assert.match(r.message,/for 2026-10-10\./);
});

const closedCampus=()=>{const kth={id:'kth',name:'KTH',location:{latitude:59.35,longitude:18.07},periods:null},hall={...kth,id:'m',name:'Campus Hall',periods:[]};let saved=0;
 return {maps:{search:async q=>q==='KTH'?[kth]:[hall],details:async id=>id==='m'?hall:kth,route:async()=>({minutes:10,walking:10,mode:'walk',fare:{currencyCode:'SEK',units:'0'}})},calendarDay:async d=>({date:d,connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'journey-'+(++saved)};};

test('a meeting point is not limited by the venue’s posted opening hours',async()=>{
 const plan=async hours=>{const env=createAgentEnvironment({text:'plan it',slots:{...trip,activities:[{...trip.activities[0],label:'Meet a friend',...(hours?{hours}:{})}]}},closedCampus());await env.handlers.discover_candidates({});return (await env.handlers.plan_itinerary({})).planChoices.length;};
 assert.equal(await plan(),0);assert.ok(await plan('not_needed')>0);
});

test('a plan request with prerequisites in place must run the planner before replying',async()=>{
 const steps=[['discover_candidates',{}],['finish',{mode:'discussion',message:'I have put together a draft itinerary.'}],['plan_itinerary',{}],['finish',{message:'No option fits the opening hours.'}]];
 const r=await runAgent({text:'Make a plan',slots:trip},config,closedCampus(),{fetchImpl:model({...turn(),intent:'planning'},steps)});
 assert.equal(r.stopReason,'finished');assert.equal(r.message.split('\n')[0],'No option fits the opening hours.');
 assert.deepEqual(r.trace.map(t=>t.action+':'+t.status),['discover_candidates:ok','reply:error','plan_itinerary:ok']);
});

test('an over-long reply gets one request to shorten; a still-long one is trimmed at a sentence',async()=>{
 const long='This sentence is part of a reply that goes on for far too long. '.repeat(40);
 const r=await runAgent({text:'先聊聊',slots:trip},config,{}, {fetchImpl:model({...turn(),intent:'discussion'},[['finish',{message:long}],['finish',{message:long}]])});
 assert.equal(r.stopReason,'finished');assert.equal(r.rounds,2);assert.ok(r.trace.some(t=>t.action==='reply'&&/at most four plain sentences/.test(t.summary)));assert.ok(r.message.length<=900&&r.message.length>700&&r.message.endsWith('too long.'));
});

test('the reply is the model’s plain text, streamed while written; protocol noise is never delivered',async()=>{
 const sse=parts=>({ok:true,headers:{get:()=>'text/event-stream'},body:(async function*(){for(const p of parts)yield new TextEncoder().encode('data: '+JSON.stringify(p)+'\n');yield new TextEncoder().encode('data: [DONE]\n');})()});
 const words=['Tomorrow ','there is ','a watercolour ','class.'],drafts=[];let main=0;
 const r=await runAgent({text:'先聊聊',slots:trip},config,{}, {onProgress:e=>{if(e.phase==='reply_delta')drafts.push(e.text);},fetchImpl:async(url,opts)=>{const req=JSON.parse(opts.body);if(req.tools[0].function.name==='commit_turn')return response('commit_turn',resolvedTurn(req,{...turn(),intent:'discussion'}));assert.equal(req.tool_choice,'auto');assert.ok(!req.tools.some(t=>t.function.name==='finish'));
  return ++main===1?response('finish',{message:'<tool_call>{"name":"plan"}</tool_call>'}):sse([...words.map(content=>({choices:[{delta:{content}}]})),{choices:[{delta:{},finish_reason:'stop'}]}]);}});
 assert.equal(r.stopReason,'finished');assert.equal(r.outcome,'discussion');assert.equal(r.message,'Tomorrow there is a watercolour class.');assert.equal(r.rounds,2);
 assert.ok(drafts.length>=1&&drafts.every(d=>r.message.startsWith(d)));
});

test('a stop’s clock time is not the departure time; the planner leaves early enough without saving a leave time',async()=>{
 const meet={...trip.activities[0],label:'Meet a friend',hours:'not_needed',windowStart:'10:00',windowEnd:'11:00',windowQuote:'meet at 10:00'};
 const r=await runAgent({text:'we will meet at 10:00, home by 21:00',slots:{...trip,start:null,deadline:null,timeMode:'unknown',activities:[]}},config,closedCampus(),{fetchImpl:model({...turn({activities:[meet],start:'10:00',deadline:'21:00',timeMode:'fixed'},['activities','start','deadline','timeMode'].map(field=>({field,messageIndices:[0]}))),intent:'planning'},[['discover_candidates',{}],['plan_itinerary',{}],['finish',{message:'Done.'}]])});
 assert.equal(r.stopReason,'finished');assert.equal(r.slots.start,null);assert.equal(r.slots.labels.start,undefined);assert.equal(r.journey.open.start,true);assert.equal(r.slots.deadline,'21:00');assert.ok(r.journey.plans.length>0);assert.equal(r.journey.plans[0].stops[0].start,600);
});

test('changing the subject keeps the saved trip; an unchecked timetable is labelled as unverified',async()=>{
 const r=await runAgent({text:'never mind that for now',slots:trip},config,{}, {fetchImpl:model({...turn({activities:[]},[{field:'activities',messageIndices:[0]}]),intent:'discussion'},[['finish',{message:'Sure.'}]])});
 assert.deepEqual(r.slots.activities,['museum']);assert.equal(r.message,'Sure.');
 const p=await runAgent({text:'Make a plan',slots:{...trip,origin:null}},config,{}, {fetchImpl:model({...turn(),intent:'planning'},[['finish',{message:'Museum 10:00 to 11:00, then lunch at 12:30.'}]])});
 assert.match(p.message,/not a checked itinerary yet/);assert.equal(p.outcome,'discussion');
});

test('the delivered reply is plain text: markdown the model adds is removed, sentences kept',async()=>{
 const {plainText}=await import('../lib/agent.mjs');
 const md='## Plan\n\n- **Ramen** at *Ki-Mama* around noon.\n- Then the film.\n\n| Stop | Time |\n|---|---|\n| Ramen | 13:00 |\n\n1. Confirm on the page.';
 assert.equal(plainText(md),'Plan\n\nRamen at Ki-Mama around noon.\nThen the film.\n\nConfirm on the page.');
 assert.equal(plainText('5 * 3 is fine, and so is 2*4.'),'5 * 3 is fine, and so is 2*4.');
 const r=await runAgent({text:'先聊聊',slots:trip},config,{}, {fetchImpl:model({...turn(),intent:'discussion'},[['finish',{message:'**Sure** — the museum works.'}]])});
 assert.equal(r.message,'Sure — the museum works.');
});

test('interpreting a later message keeps a time the user gave earlier',async()=>{
 const meet={...trip.activities[0],windowStart:'10:00',windowEnd:'11:00',windowQuote:'meet at 10:00'};
 const env=createAgentEnvironment({text:'meet at 10:00'},{});await env.handlers.update_trip({patch:{...trip,activities:[meet]},by:'user'});
 const later=createAgentEnvironment({text:'home by 21:00',slots:env.output().slots},{});
 await later.handlers.update_trip({patch:{deadline:'21:00',activities:[{...meet,windowStart:null,windowEnd:null,windowQuote:null}]},by:'user'});
 assert.equal(later.state.activityDefinitions.museum.windowStart,'10:00');assert.equal(later.state.labels['window:museum'],'user');assert.equal(later.state.deadline,'21:00');
 await later.handlers.set_activity_window({activityId:'museum',start:null,end:null,userQuote:null,assumption:null});
 assert.equal(later.state.activityDefinitions.museum.windowStart,null);
});

test('a change to a trip with a checked plan is re-planned before it is answered',async()=>{
 const svc=closedCampus(),slots={...trip,activities:[{...trip.activities[0],hours:'not_needed'}]};
 const first=await runAgent({text:'Make a plan',slots},config,svc,{fetchImpl:model({...turn(),intent:'planning'},[['plan_itinerary',{}],['finish',{message:'Planned.'}]])});
 assert.ok(first.journey.plans.length);
 const previous={result:first.journey,discovery:{origin:Object.values(first.journey.places)[0],origins:[],pools:{}}};
 const r=await runAgent({text:'budget 300 SEK',slots:first.slots,journeyId:first.journey.id,choice:first.choice},config,{...svc,previous},{fetchImpl:model({...turn({budget:300}),intent:'update'},[['finish',{message:'Still the museum at 10:15.'}],['plan_itinerary',{}],['finish',{message:'Re-checked with the new budget.'}]])});
 assert.equal(r.message,'Re-checked with the new budget.');assert.ok(r.trace.some(t=>t.action==='reply'&&/out of date/.test(t.summary)));assert.equal(r.slots.budget,300);
});

test('a message about something else does not clear hours the user gave earlier; saying so does',async()=>{
 const run=text=>runAgent({text,slots:trip},config,{}, {fetchImpl:model({...turn({budget:300,start:null,deadline:null,timeMode:'flexible'}),intent:'discussion'},[['finish',{message:'OK.'}]])});
 const kept=await run('make the budget 300 SEK');
 assert.equal(kept.slots.start,'10:00');assert.equal(kept.slots.deadline,'18:00');assert.equal(kept.slots.timeMode,'fixed');assert.equal(kept.slots.budget,300);
 const cleared=await run('budget 300 SEK and I can be back whenever');
 assert.equal(cleared.slots.deadline,null);assert.equal(cleared.slots.budget,300);
});

test('runaway prose or tool arguments stop the stream early as an output limit',async()=>{
 const stream=chunks=>({headers:{get:()=>'text/event-stream'},body:(async function*(){for(const c of chunks)yield new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:c}]})+'\n');})()});
 let seen=0;const prose=Array.from({length:70},()=>({content:'x'.repeat(100)}));
 await assert.rejects(modelResponse({headers:{get:()=>'text/event-stream'},body:(async function*(){for(const c of prose){seen++;yield new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:c}]})+'\n');}})()}),{code:'MODEL_OUTPUT_LIMIT'});
 assert.ok(seen<50);
 await assert.rejects(modelResponse(stream(Array.from({length:100},()=>({tool_calls:[{index:0,function:{arguments:'y'.repeat(100)}}]})))),{code:'MODEL_OUTPUT_LIMIT'});
});

test('a respaced or translated map name satisfies a named venue; a different venue does not',async()=>{
 const {matchesRequiredName}=await import('../lib/journey.mjs');
 const a={requiredNames:['Nationalmuseum']};
 assert.ok(matchesRequiredName({name:'National Museum'},a));assert.ok(matchesRequiredName({name:'Sweden’s Art Museum',aliases:['Nationalmuseum']},a));
 assert.ok(!matchesRequiredName({name:'National Museum of Science and Technology'},a));assert.ok(!matchesRequiredName({name:'Moderna Museet'},a));
 // Generic words need not appear in the map name; distinguishing ones must.
 const kth={requiredNames:['KTH Campus']};assert.ok(matchesRequiredName({name:'KTH Royal Institute of Technology'},kth));assert.ok(!matchesRequiredName({name:'Stockholm University Campus'},kth));
 assert.ok(!matchesRequiredName({name:'Different Bookshop'},{requiredNames:['Nordic Books']}));assert.ok(!matchesRequiredName({name:'Gallerian'},{requiredNames:['City Mall']}));
});

test('planning without a stated budget applies no budget limit and records none',async()=>{
 const place={id:'kth',name:'KTH',location:{latitude:59.35,longitude:18.07},periods:null},museum={...place,id:'m',name:'City Museum'};let saved=0;
 const env=createAgentEnvironment({text:'plan it',slots:{...trip,budgetMode:'unknown',budget:null}},{maps:{search:async q=>q==='KTH'?[place]:[museum],details:async id=>id==='m'?museum:place,route:async()=>({minutes:10,walking:10,mode:'walk',fare:{currencyCode:'SEK',units:'0'}})},calendarDay:async d=>({date:d,connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=>'journey-'+(++saved)});
 assert.deepEqual(env.readiness().missingDecisions,[]);
 await env.handlers.discover_candidates({});const r=await env.handlers.plan_itinerary({});
 assert.equal(saved,1);assert.equal(r.requested.budgetMode,'unknown');assert.equal(r.userLimits.budget.mode,'none');assert.deepEqual(env.assumptions,[]);assert.equal(env.state.labels.budget,undefined);
});

test('mixed discovery does not terminate at present_events and cannot omit requested news',async()=>{
 const event={ref:'event_0123456789ab',title:'Watercolour',description:'练习水彩调色，画一张城市明信片。',venue:'Hall',start:'2026-10-09',end:'2026-10-09',url:'https://fixture.invalid/event',occurrences:[],scheduleStatus:'date_only'};
 const services={readNews:async()=>({cards:[{type:'news',title:'图书馆新增座位',url:'https://fixture.invalid/news'}]}),nearbyEvents:async()=>({events:[event]})};
 const commit={...turn({},[],['news','events']),intent:'information'};
 const r=await runAgent({text:'新闻和活动各介绍一条'},config,services,{fetchImpl:model(commit,[
 ['load_skill',{name:'local-discovery'}],['nearby_events',{date:'2026-10-10',origin:'KTH',days:1}],['present_events',{eventRefs:[event.ref]}],
 ['finish',{message:'水彩体验，场次待核实。'}],['read_news',{}],
 ['finish',{message:'The library has added reading seats. Practise mixing colours and paint a city postcard; a chance to try painting. Specific sessions are pending verification.'}]
 ])});
 assert.equal(r.stopReason,'finished');assert.match(r.message,/library/);assert.match(r.message,/postcard/);assert.match(r.message,/pending verification/);
 assert.ok(r.trace.some(t=>t.action==='reply'&&/news, which has not been looked up/.test(t.summary)));
 assert.ok(r.cards.some(c=>c.type==='news'));assert.ok(r.cards.some(c=>c.type==='event'));
});

test('failed news source still permits a transparent partial answer',async()=>{
 const r=await runAgent({text:'查新闻和活动'},config,{readNews:async()=>{throw Error('news unavailable');},nearbyEvents:async()=>({events:[]})},{fetchImpl:model({...turn({},[],['news','events']),intent:'information'},[
 ['load_skill',{name:'local-discovery'}],['read_news',{}],['nearby_events',{date:'2026-10-10',origin:'KTH',days:1}],['finish',{message:'',sections:[{category:'news',text:'新闻源暂时不可用。'},{category:'events',text:'本次活动来源没有匹配结果。'}]}]
 ])});
 assert.equal(r.stopReason,'finished');assert.match(r.message,/不可用/);assert.match(r.message,/没有匹配/);
});

test('truncated intake returns a distinct failure without committing any incomplete tool',async()=>{
 const r=await runAgent({text:'Budget500',slots:trip},config,{}, {fetchImpl:async()=>response('commit_turn',turn({budget:500},[{field:'budget',messageIndices:[0]}]),'length')});
 assert.equal(r.stopReason,'output_limit');assert.equal(r.slots.budget,1000);assert.equal(r.toolCount,0);
});

test('both JSON and streaming length limits are classified and reasoning stays discarded',async()=>{
 await assert.rejects(()=>modelResponse(response('finish',{message:'partial'},'length')),e=>e.code==='MODEL_OUTPUT_LIMIT');
 const data='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'not retained'},finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n';
 await assert.rejects(()=>modelResponse(new Response(data,{headers:{'content-type':'text/event-stream'}})),e=>e.code==='MODEL_OUTPUT_LIMIT');
});

test('reordered object keys are not treated as a new unsupported activity change',async()=>{
 const previous=createAgentEnvironment({slots:trip},{}).context().trip;
 const reordered=previous.activities.map(a=>Object.fromEntries(Object.entries(a).reverse()));
 const audit=[];
 const r=await runAgent({text:'先讨论',slots:trip},config,{}, {onDiagnostic:e=>audit.push(e),fetchImpl:model(turn({activities:reordered}),[['finish',{message:'可以继续讨论。'}]])});
 assert.equal(r.stopReason,'finished');assert.deepEqual(audit.find(e=>e.kind==='turn_committed').patch,{});
});

test('calendar weekday is computed by host rather than left to model arithmetic',()=>{
 const env=createAgentEnvironment({slots:trip},{});
 assert.deepEqual(env.context().dateFacts,{date:'2026-10-09',weekday:'Friday'});
});

test('a new provisional interpretation survives even without a numeric slot change',async()=>{
 const r=await runAgent({text:'大概早上出发，具体几点之后再定',slots:{...trip,start:null,timeMode:'flexible'}},config,{}, {fetchImpl:model({...turn(),assumptions:['出发时段为早上，具体时刻待定']},[['finish',{message:'已保留大致时段。'}]])});
 assert.ok(r.slots.assumptions.includes('出发时段为早上，具体时刻待定'));assert.equal(r.slots.start,null);
});

test('actor truncation reports that a completed condition update is still saved',async()=>{
 const r=await runAgent({text:'Budget500',slots:trip},config,{}, {fetchImpl:async(url,opts)=>{
  const req=JSON.parse(opts.body);
  return req.tools[0].function.name==='commit_turn'?response('commit_turn',resolvedTurn(req,turn({budget:500},[{field:'budget',messageIndices:[0]}]))):response('finish',{message:'partial'},'length');
 }});
 assert.equal(r.stopReason,'output_limit');assert.equal(r.slots.budget,500);assert.deepEqual(r.turnReceipt.committedFields,['budget']);assert.match(r.message,/conditions have been remembered/);assert.doesNotMatch(r.message,/could not be fully saved|fully organized|continue adding/);
});
