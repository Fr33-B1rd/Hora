import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaps } from '../lib/maps.mjs';

test('routes request and retain actual geometry at route and step levels',async()=>{
  let fields;const maps=createMaps('fake',async(url,opts)=>{fields=opts.headers['X-Goog-FieldMask'];return {ok:true,json:async()=>({routes:[{duration:'600s',polyline:{encodedPolyline:'whole'},legs:[{steps:[{travelMode:'WALK',polyline:{encodedPolyline:'walk'},staticDuration:'60s'},{travelMode:'TRANSIT',polyline:{encodedPolyline:'train'},staticDuration:'540s'}]}]}]})};});
  const r=await maps.route('a','b','2026-10-10T11:00:00Z','transit');assert.match(fields,/routes.polyline.encodedPolyline/);assert.match(fields,/routes.legs.steps.polyline.encodedPolyline/);
  assert.equal(r.polyline,'whole');assert.deepEqual(r.segments,[{mode:'walk',polyline:'walk'},{mode:'transit',polyline:'train'}]);assert.equal(r.minutes,10);
});

test('missing transit queries real walking; all-walking transit is free and minutes stay consistent',async()=>{
  const calls=[];
  const maps=createMaps('test',async(url,opts)=>{const body=JSON.parse(opts.body);calls.push(body);return {ok:true,json:async()=>body.travelMode==='TRANSIT'?{}:{routes:[{duration:'121s',legs:[{steps:[{travelMode:'WALK',staticDuration:'61s'},{travelMode:'WALK',staticDuration:'60s'}]}]}]}};});
  const r=await maps.route('a','b','2026-10-10T11:00:00Z','transit');
  assert.equal(calls.length,2);assert.equal(calls[1].travelMode,'WALK');assert.equal(calls[1].departureTime,undefined);
  assert.equal(r.walkingFallback,true);assert.equal(r.mode,'walk');assert.equal(r.walking,3);assert.equal(r.minutes,3);assert.equal(r.fare.units,'0');
  const bad=createMaps('test',async()=>({ok:false,status:403}));await assert.rejects(bad.route('a','b','2026-10-10T11:00:00Z','transit'),/403/);
});

test('pinned place recovery uses Places Details without posting stored source notes',async()=>{
  let seen;const maps=createMaps('fake',async(url,options)=>{seen={url,options};return {ok:true,json:async()=>({id:'locked-cinema',displayName:{text:'Cinema'},location:{latitude:59.33,longitude:18.06},websiteUri:'https://example.com',regularOpeningHours:{periods:[{open:{day:0,hour:0}}]}})};});
  const p=await maps.details('locked-cinema');assert.equal(p.id,'locked-cinema');assert.equal(p.website,'https://example.com');assert.equal(seen.options.method,'GET');assert.equal(seen.options.body,undefined);assert.match(seen.url,/places\/locked-cinema/);
});
