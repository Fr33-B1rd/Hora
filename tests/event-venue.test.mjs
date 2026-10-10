import test from 'node:test';
import assert from 'node:assert/strict';
import {eventVenueMatch} from '../lib/event-venue.mjs';
import {createAgentEnvironment} from '../lib/agent-tools.mjs';
const event={ref:'event_0123456789ab',title:'City walk fixture',venue:'Starts by Östermalm Saluhall',location:{latitude:59.3359354,longitude:18.077741},url:'https://www.visitstockholm.com/events/fixture/next/',occurrences:[{date:'2026-10-10',start:'17:30',end:'18:30'}]};
const place={id:'market',name:'Östermalms Food Hall',location:{latitude:59.3360006,longitude:18.0780049},periods:null,aliases:['Östermalms saluhall']};
test('source meeting instructions match localized venue only with coordinate corroboration',()=>{
 const match=eventVenueMatch(place,event);assert.equal(match.method,'localized_name_and_coordinates');assert.ok(match.distanceMeters<30);
 assert.equal(eventVenueMatch({...place,location:{latitude:60,longitude:18}},event),null);
 assert.equal(eventVenueMatch({...place,name:'Unrelated Cafe',aliases:[]},event),null);
 assert.equal(eventVenueMatch(place,{...event,location:null}),null);
 assert.equal(eventVenueMatch({...place,name:'Starts by Östermalm Saluhall',location:{latitude:60,longitude:18}},event),null);
});
test('venue receipt survives batch selection, sparse origin clarification, source refresh and scheduler',async()=>{
 const origin={id:'station',name:'Fridhemsplan',location:{latitude:59.26,longitude:18.01},periods:null};let localReads=0;
 const svc={evidence:[event],eventDetails:async()=>event,maps:{search:async q=>q.includes('Fridhemsplan')?[origin]:[{...place,aliases:[]}],details:async(id,lang)=>{assert.equal(id,'market');assert.equal(lang,'sv');localReads++;return {...place,name:'Östermalms saluhall'};},route:async()=>({minutes:20,walking:5,mode:'transit'})},calendarDay:async()=>({connected:true,busy:[],own:[]}),getChecks:()=>({revision:0,items:{}}),saveJourney:()=> 'fixture'};
 const env=createAgentEnvironment({},svc);
 await env.handlers.update_trip({patch:{date:'2026-10-10',origin:'Fridhemsplan',start:'12:00',deadline:'22:00',timeMode:'flexible',budgetMode:'flexible',activities:[{id:'walk',label:'City Walk: Hidden Lives and Dangerous Connections — Women in the Stockholm of Spies (in Swedish)',query:'tour',requiredNames:[],duration:60,allowance:null,eventRef:event.ref}]}});
 await env.handlers.discover_candidates({});assert.equal(env.readiness().missingCandidates.length,0);assert.equal(localReads,1);
 await env.handlers.update_trip({patch:{origin:'Fridhemsplan metro'}});await env.handlers.discover_candidates({});
 // A new search object must retain aliases already resolved for this Place ID.
 await env.handlers.plan_itinerary({});const result=env.output().journey;
 assert.ok(result.plans.length);assert.equal(result.origin.id,'station');assert.equal(result.sourceChecks.walk.venueMatch.placeId,'market');assert.equal(result.plans[0].stops[0].start,1050);
 assert.equal(result.constraints.activityDefinitions.walk.requiredNames[0],event.venue);
 svc.getChecks=()=>({revision:1,items:{walk:{...result.sourceChecks.walk,reportedBy:'user',venueMatch:undefined}}});
 await env.handlers.plan_itinerary({});assert.ok(env.output().journey.plans.length,'Manual verification must not erase the independently resolved venue identity');
 svc.eventDetails=async()=>({...event,location:{latitude:60,longitude:18}});
 await assert.rejects(env.handlers.plan_itinerary({}),/venue does not match source/,'Refreshed source coordinates must invalidate an old venue binding');
});
test('non-event named venue guard remains strict',async()=>{
 const env=createAgentEnvironment({}, {maps:{search:async()=>[place]}});
 await env.handlers.update_trip({patch:{activities:[{id:'visit',label:'Specific shop',query:'shop',requiredNames:['Other Shop'],duration:30,allowance:null}]}});
 await env.handlers.search_places({query:'shop'});
 await assert.rejects(env.handlers.select_candidates({activityId:'visit',placeIds:['market']}),/does not meet/);
});
test('mixed-language origin search skips an unrelated first-ranked station',async()=>{
 const wrong={...place,id:'central',name:'T-Centralen'},right={...place,id:'hagsatra',name:'Fridhemsplan'};
 const env=createAgentEnvironment({}, {maps:{search:async q=>q.includes('Fridhemsplan')?[wrong,right]:[place]}});
 await env.handlers.update_trip({patch:{origin:'Fridhemsplan地铁站',activities:[{id:'shop',label:'逛市场',query:'market',requiredNames:[],duration:30,allowance:null}]}});
 const prepared=await env.handlers.discover_candidates({});assert.equal(prepared.origin.name,'Fridhemsplan');
 await assert.rejects(env.handlers.select_candidates({activityId:'origin',placeIds:['central']}),/Search rank is not identity evidence/);
});
