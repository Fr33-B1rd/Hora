import test from 'node:test';
import assert from 'node:assert/strict';
import {converse,conversationSlots,planningRequest} from '../lib/conversation.mjs';
import {parseEvents,selectEvents} from '../lib/nearby-events.mjs';
import {parseNews,translateTitles} from '../lib/local-news.mjs';
const config={key:'test',base:'https://model.invalid/v1',model:'test'};
const model=a=>({fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'respond',arguments:JSON.stringify(a)}}]}}]})})});
const answer=(action,patch={},extra={})=>({action,patch,message:'收到',...extra});
test('multi-turn planning asks for missing facts instead of using form defaults',async()=>{
  const first=await converse({text:'今天电影、拉面、理发'},config,model(answer('plan',{activities:['movie','ramen','hair'],date:'2026-10-07'})));
  assert.equal(first.action,'reply');assert.match(first.message,/depart/i);assert.equal(first.slots.budget,null);assert.equal(first.request,undefined);
  const second=await converse({text:'1000kr，不想多走路',slots:first.slots,history:[{role:'assistant',content:first.message}]},config,model(answer('plan',{budget:1000,lowWalking:true})));
  assert.deepEqual(second.slots.activities,first.slots.activities);assert.match(second.message,/Where are you departing/);
  const third=await converse({text:'T-Central，13点到20o’clock',slots:second.slots},config,model(answer('plan',{origin:'T-Central Stockholm',start:'13:00',deadline:'20:00'})));
  assert.equal(third.action,'plan');assert.equal(third.request.settings.lowWalking,true);assert.equal(third.request.settings.maxWalking,null);
  const ready=await converse({text:'20 minutes',slots:third.slots},config,model(answer('plan',{maxWalking:20})));
  assert.equal(ready.action,'plan');assert.equal(ready.request.settings.maxWalking,20);assert.equal(ready.request.settings.budget,1000);
});
test('unlimited and flexible budgets resolve the question without invented numeric caps',async()=>{
  const slots={activities:['movie'],date:'2026-10-07'};
  const free=await converse({text:'no budget limit',slots},config,model(answer('reply',{budgetMode:'unlimited',budget:null})));
  assert.equal(free.slots.budgetMode,'unlimited');assert.equal(free.slots.budget,null);assert.match(free.message,/no budget limit/);assert.match(free.message,/Where are you departing/);
  const suggestion=await converse({text:'先看建议吧',slots},config,model(answer('plan',{budgetMode:'flexible'})));
  assert.equal(suggestion.slots.budgetMode,'flexible');assert.match(suggestion.message,/estimated costs/);
  const capped=await converse({text:'还是500kr以内',slots:free.slots},config,model(answer('plan',{budget:500})));
  assert.equal(capped.slots.budgetMode,'limited');assert.equal(capped.slots.budget,500);
});
test('generic activities, cuisine and ordering survive unrelated follow-up patches',async()=>{
  const activities=[{id:'museum',label:'visit museum',query:'museum',duration:120,allowance:250},{id:'chinese_food',label:'eat Chinese food',query:'Chinese restaurant',duration:60,allowance:300}];
  const first=await converse({text:'今天想去博物馆然后吃中餐'},config,model(answer('plan',{activities,precedence:[{before:'museum',after:'chinese_food'}],date:'2026-10-07'})));
  assert.match(first.message,/depart/i);
  const ready=await converse({text:'不限预算，从T-CentralDepart10 to 20o’clock',slots:first.slots},config,model(answer('plan',{budgetMode:'unlimited',origin:'T-Central Stockholm',start:'10:00',deadline:'20:00'})));
  assert.equal(ready.action,'plan');assert.equal(ready.request.settings.budget,null);assert.equal(ready.request.settings.activityDefinitions.chinese_food.query,'Chinese restaurant');assert.deepEqual(ready.slots.precedence,[{before:'museum',after:'chinese_food'}]);
  const changed=await converse({text:'中餐换咖啡馆',slots:ready.slots},config,model(answer('plan',{activities:[activities[0],{id:'coffee',label:'喝咖啡',query:'coffee shop',duration:45,allowance:100}]})));
  assert.equal(changed.slots.budgetMode,'unlimited');assert.deepEqual(changed.slots.precedence,[]);
});
test('conversation has no calendar commit tool, and chat/news need no trip defaults',async()=>{
  assert.equal((await converse({text:'你好'},config,model(answer('reply')))).action,'reply');
  assert.equal((await converse({text:'本地新闻'},config,model(answer('news')))).action,'news');
  assert.match((await converse({text:'附近新鲜事'},config,model(answer('discover')))).message,/Which station/);
  await assert.rejects(converse({text:'Confirm'},config,model(answer('confirm'))),/format is invalid/);
  assert.throws(()=>planningRequest({activities:['movie']}),/depart/i);
  assert.throws(()=>conversationSlots({maxWalking:-1}),/Invalid/i);
  await assert.rejects(converse({text:'你好',history:Array(13).fill({role:'user',content:'x'})},config,model(answer('reply'))),/context/);
});
test('nearby events retain trusted links and exclude past, distant and wrong-category results',()=>{
  const event={id:'1',title:'Music',startDate:'2026-10-07',endDate:'2026-10-08',href:'https://www.visitstockholm.com/events/test/',categories:['Music'],venueName:'Park',location:{latitude:59.33,longitude:18.06}};
  const items=[event,{...event,id:'2',startDate:'2026-09-01',endDate:'2026-09-02'},{...event,id:'3',location:{latitude:60,longitude:18}},{...event,id:'4',href:'https://evil.invalid/events/test'}];
  const html='<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{componentProps:{contentBlocks:[{value:{items}}]}}}})+'</script>';
  const parsed=parseEvents(html);assert.equal(parsed.length,3);
  assert.equal(selectEvents(parsed,event.location,{today:'2026-10-07',category:'music'}).length,1);
  assert.equal(selectEvents(parsed,event.location,{today:'2026-10-07',category:'exhibitions'}).length,0);
  assert.throws(()=>parseEvents('changed'),/changed/);
});
test('news validates source, timestamp, freshness and deduplicates headlines',()=>{
  const item=(url,date,title='A &amp; B')=>`<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
  const url='https://www.svt.se/nyheter/lokalt/stockholm/example',date='2026-10-07T10:00:00Z';
  const xml='<rss>'+item(url,date)+item(url,date)+item('https://evil.invalid/',date)+item(url+'old','2026-09-01')+item(url+'future','2026-10-08')+'</rss>';
  const cards=parseNews(xml,{now:Date.parse('2026-10-07T12:00:00Z')});assert.equal(cards.length,1);assert.equal(cards[0].title,'A & B');
});
test('translated titles cannot replace provider links or dates',async()=>{
  const cards=[{title:'Hej',url:'https://www.svt.se/example',publishedAt:'2026-10-07'}];
  const translated=await translateTitles(cards,config,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'translate_titles',arguments:'{"titles":["你好"]}'}}]}}]})})});
  assert.equal(translated[0].url,cards[0].url);assert.equal(translated[0].publishedAt,cards[0].publishedAt);assert.equal(translated[0].translatedTitle,'你好');
});
