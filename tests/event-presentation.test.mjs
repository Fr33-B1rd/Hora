import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentEnvironment} from '../lib/agent-tools.mjs';
const e={ref:'event_0123456789ab',title:'City history',description:'A guided walk through wartime Stockholm, told through women’s stories. The tour is in Swedish.',venue:'Test hall',distance:1,distanceOrigin:'Sergels torg',start:'2026-10-07',end:'2026-10-07',occurrences:[{date:'2026-10-07',start:'17:30',end:'18:30'}]};
const services={nearbyEvents:async()=>({origin:'Sergels torg',events:[e,{...e,ref:'event_1123456789ab',title:'Other event'}]})};
const recommendation={eventRef:e.ref,introduction:'通过女性的故事认识战时斯德哥尔摩，是一场瑞典语城市导览。',interest:'如果你喜欢边散步边听城市历史，这项可能合适。',sourceQuote:e.description};
test('recommendations explain content and conditional appeal; default reference distance stays hidden',async()=>{
 const env=createAgentEnvironment({text:'今天有什么活动？'},services);
 await env.handlers.nearby_events({date:'2026-10-10',origin:'Sergels torg',showDistance:true,originQuote:'Sergels torg'});
 await assert.rejects(env.handlers.present_events({eventRefs:[e.ref]}),/Do not list titles alone/);
 const result=await env.handlers.present_events({eventRefs:[e.ref],recommendations:[recommendation]});
 assert.match(result.message,/战时斯德哥尔摩/);assert.match(result.message,/如果你喜欢/);assert.match(result.message,/17:30–18:30/);assert.doesNotMatch(result.message,/直线|Sergels torg|1\. /);
 assert.equal(env.output().cards.length,1);assert.equal(env.output().cards[0].displayDistance,false);
 // A quote that differs only in case/punctuation still grounds the introduction;
 // an invented one costs that introduction, never the selection.
 const loose=await env.handlers.present_events({eventRefs:[e.ref],recommendations:[{...recommendation,sourceQuote:'a guided walk through wartime Stockholm told through WOMEN’S stories'}]});
 assert.match(loose.message,/战时斯德哥尔摩/);assert.equal(loose.unquoted,undefined);
 const invented=await env.handlers.present_events({eventRefs:[e.ref],recommendations:[{...recommendation,introduction:'A private party.',sourceQuote:'Invented private party'}]});
 assert.deepEqual(invented.unquoted,[e.ref]);assert.doesNotMatch(invented.message,/private party/);assert.match(invented.message,/Source introduction:A guided walk/);assert.equal(env.output().cards.length,1);
});
test('explicit user reference may display qualified straight-line distance',async()=>{
 const env=createAgentEnvironment({text:'Sergels torg 附近有什么？'},services);
 await env.handlers.nearby_events({date:'2026-10-10',origin:'Sergels torg',originQuote:'Sergels torg',showDistance:true});
 const r=await env.handlers.present_events({eventRefs:[e.ref],recommendations:[recommendation]});
 assert.match(r.message,/from  Sergels torg , approximately  1 km/);assert.equal(env.output().cards[0].displayDistance,true);
});
