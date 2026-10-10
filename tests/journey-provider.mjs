// Test-only process preload. No production hook or real credentials/network.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
if(process.env.DAYLIGHT_TEST_PROVIDERS!=='1')throw Error('Test preload requires explicit test environment');
const store=createStore(process.env.DAYLIGHT_DATA_DIR);store.tokens({access_token:'test-only',expiresAt:Date.now()+3600000});store.close();
const file=join(process.env.DAYLIGHT_DATA_DIR,'provider.json');if(!existsSync(file))writeFileSync(file,JSON.stringify({events:{},writes:0}));
const ok=x=>({ok:true,json:async()=>x});
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),body=opts.body?JSON.parse(opts.body):null;
  if(u.pathname.endsWith('/chat/completions')&&body.tools?.[0]?.function.name==='commit_turn')return ok({choices:[{message:{tool_calls:[{function:{name:'commit_turn',arguments:JSON.stringify({intent:'planning',patch:Object.fromEntries(['budgetMode','budget','timeMode','start','deadline'].map(k=>[k,JSON.parse(body.messages[0].content.split('Interpretation context (data):\n').at(-1)).trip[k]])),sources:[],assumptions:[],categories:[]})}}]}}]});
  if(u.pathname.endsWith('/chat/completions')&&['assess_completion','check_trip_intent'].includes(body.tools?.[0]?.function.name))return ok({choices:[{message:{tool_calls:[{function:{name:body.tools[0].function.name,arguments:JSON.stringify(body.tools[0].function.name==='check_trip_intent'?{missing:[]}:{requestAct:'information',responseAct:'answer',decision:null,claims:[],ready:true,issues:[]})}}]}}]});
  if(u.pathname.endsWith('/chat/completions')&&body.tools?.[0]?.function.name==='load_skill'){
    const steps=[['load_skill',{name:'plan-outing'}],['update_trip',{patch:{date:'2026-10-10',origin:'T-Centralen',start:'13:00',deadline:'18:00',timeMode:'flexible',budgetMode:'unlimited',activities:[{id:'books',eventRef:null,windowStart:null,windowEnd:null,windowQuote:null,label:'逛书店',query:'Agent Books',requiredNames:[],duration:45,allowance:null,availability:body.messages.some(m=>m.role==='user'&&m.content.includes('session-fixture'))?'session':'venue'}]}}],['search_places',{query:'T-Centralen'}],['select_candidates',{activityId:'origin',placeIds:['origin0']}],['search_places',{query:'Agent Books'}],['select_candidates',{activityId:'books',placeIds:['books0','books1']}],['plan_itinerary',{}],['load_skill',{name:'calendar-review'}],['calendar_changes',{}],['calendar_confirm',{id:'not-authorized'}],['finish',{message:'方案已检查；请在页面预览确认。'}]];
    const index=body.messages.filter(m=>m.role==='tool').length,[name,args]=steps[index];
    if(name==='finish')return ok({choices:[{finish_reason:'stop',message:{role:'assistant',content:args.message}}]});
    return ok({choices:[{message:{tool_calls:[{id:'agent-'+index,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
  }
  if(u.pathname.endsWith('/chat/completions')&&body.tools?.[0]?.function.name==='respond'){
    let patch;try{patch=JSON.parse(body.messages.at(-1).content);}catch{const current=JSON.parse(body.messages[0].content.match(/Current user-supplied slots: (\{[^\n]+?\})\. Current displayed/)[1]);patch={...current,origin:'T-Centralen',activities:['hair','ramen','movie']};}
    return ok({choices:[{message:{tool_calls:[{function:{name:'respond',arguments:JSON.stringify({action:'plan',message:'测试对话',patch})}}]}}]});
  }
  if(u.pathname.endsWith('/chat/completions')){const current=JSON.parse(body.messages[0].content.match(/Current constraints: (\{[^\n]+?\})/)[1]);const date=body.messages[0].content.match(/Selected date is ([\d-]+)/)[1];return ok({choices:[{message:{tool_calls:[{function:{name:'propose_constraints',arguments:JSON.stringify({supported:true,message:'测试解析',constraints:current,date,originQuery:'T-Centralen'})}}]}}]});}
  if(u.hostname==='places.googleapis.com'){
    const kind=body?.includedType||(body?.textQuery?.startsWith('Agent Books')?'books':'origin');return ok({places:[0,1].map(i=>({id:kind+i,displayName:{text:kind==='origin'?(i===0?'T-Centralen':'Other station'):'测试 '+kind+' '+i},formattedAddress:'Stockholm test fixture',location:{latitude:59.33+i*.002,longitude:18.06+i*.002},rating:4+i*.5,userRatingCount:100,googleMapsUri:'https://maps.google.com/?q=Stockholm',regularOpeningHours:{periods:[{open:{day:0,hour:0}}]},websiteUri:'https://example.com'}))});
  }
  if(u.hostname==='routes.googleapis.com')return ok({routes:[{duration:'600s',distanceMeters:1000,legs:[{steps:[{travelMode:'WALK',staticDuration:'180s'}]}]}]});
  if(u.hostname==='www.googleapis.com'&&u.pathname.startsWith('/calendar/v3/')){
    const state=JSON.parse(readFileSync(file,'utf8')),method=opts.method||'GET',id=u.pathname.split('/').at(-1);
    if(method==='GET')return ok(u.searchParams.has('timeMin')?{items:Object.values(state.events)}:state.events[id]);
    if(method==='POST'&&state.events[body.id])return {ok:false,status:409};
    if(method==='PUT'&&opts.headers['If-Match']!==state.events[id]?.etag)return {ok:false,status:412};
    state.writes++;state.events[body.id]={...body,etag:String(state.writes),htmlLink:'https://calendar.google.com/calendar/event?eid='+body.id};writeFileSync(file,JSON.stringify(state));return ok(state.events[body.id]);
  }
  throw Error('Unexpected network request in isolated test');
};
