import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePolyline,legGeometry,routeGeometry} from '../public/route-geometry.mjs';
const encoded='_p~iF~ps|U_ulLnnqC_mqNvxq`@';
test('provider polyline decoding preserves actual shape and rejects incomplete geometry',()=>{
  assert.deepEqual(decodePolyline(encoded),[{lat:38.5,lng:-120.2},{lat:40.7,lng:-120.95},{lat:43.252,lng:-126.453}]);
  for(const bad of [null,'','_','~~~~~~~','hello','??'])assert.deepEqual(decodePolyline(bad),[]);
});
test('steps retain walk/transit modes; incomplete steps use whole route without invented gaps',()=>{
  assert.deepEqual(legGeometry({mode:'transit',polyline:encoded,segments:[{mode:'walk',polyline:encoded},{mode:'transit',polyline:encoded}]}).map(x=>x.mode),['walk','transit']);
  assert.equal(legGeometry({mode:'transit',polyline:encoded,segments:[{mode:'walk',polyline:null}]}).at(0).mode,'mixed');
  assert.deepEqual(legGeometry({mode:'walk',segments:[{polyline:encoded},{polyline:null}]}),[]);
});
test('selected and replanned geometry follows supplied leg order including return; no fake path for same venue',()=>{
  const a={from:'origin',to:'cinema',polyline:encoded},b={from:'cinema',to:'origin'},c={from:'origin',to:'origin'};
  const first=routeGeometry({legs:[a,b,c]});assert.equal(first[0].segments.length,1);assert.equal(first[1].segments.length,0);assert.equal(first[2].stationary,true);
  const repair=routeGeometry({legs:[b,a]});assert.equal(repair[0].segments.length,0);assert.equal(repair[1].segments.length,1);
});
