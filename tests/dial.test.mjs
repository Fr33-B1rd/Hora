import test from 'node:test';
import assert from 'node:assert/strict';
import {stockholm,sunTimes,sky,greeting,runTimes,point,clockOf} from '../public/dial.mjs';

test('Stockholm’s clock is read from any instant, summer or winter time',()=>{
  const summer=stockholm(new Date('2026-06-21T10:00:00Z')),winter=stockholm(new Date('2026-12-21T10:00:00Z'));
  assert.equal(summer.minutes,12*60);assert.equal(summer.offset,120);assert.equal(summer.dayOfYear,172);assert.equal(summer.label,'Sunday 21 June');
  assert.equal(winter.minutes,11*60);assert.equal(winter.offset,60);assert.equal(winter.dayOfYear,355);
  assert.equal(stockholm(new Date('2026-10-13T22:30:00Z')).minutes,30);                 // already tomorrow in Stockholm
  assert.equal(stockholm(new Date('2026-10-13T22:30:00Z')).label,'Wednesday 14 October');
});

test('sunrise and sunset over Stockholm come out within a few minutes of the almanac',()=>{
  const near=(got,hh,mm,slack=8)=>assert.ok(Math.abs(got-(hh*60+mm))<=slack,`${clockOf(got)} is not within ${slack} min of ${hh}:${mm}`);
  const june=sunTimes(172,120),december=sunTimes(355,60),october=sunTimes(286,120),march=sunTimes(79,60);
  near(june.rise,3,31);near(june.set,22,8);          // midsummer: about eighteen and a half hours of day
  near(december.rise,8,43);near(december.set,14,48); // midwinter: about six
  assert.ok(october.set-october.rise>10*60+5&&october.set-october.rise<10*60+45,'mid-October has about ten and a half hours of day');
  assert.ok(Math.abs(october.noon-(12*60+34))<=6,'the sun is highest a little after half past twelve');
  near(march.rise,5,52);near(march.set,18,2);        // the equinox: twelve
  assert.ok(june.set-june.rise>18*60&&december.set-december.rise<6.3*60);
});

test('the page’s light follows the sun: dark before dawn and after dusk, with a warm edge at each end',()=>{
  const sun={rise:440,set:1070};
  assert.deepEqual(sky(120,sun),{phase:'night',theme:'dark',x:50});
  assert.equal(sky(430,sun).theme,'light');assert.equal(sky(430,sun).phase,'dawn');      // first light, ten minutes before sunrise
  assert.equal(sky(410,sun).theme,'dark');
  assert.deepEqual(sky(755,sun),{phase:'day',theme:'light',x:50});                      // the glow is overhead at midday
  assert.equal(sky(1040,sun).phase,'dusk');assert.ok(sky(1040,sun).x>90);
  assert.equal(sky(1085,sun).theme,'light');assert.equal(sky(1095,sun).theme,'dark');
  assert.equal(sky(700,{rise:null,set:null,polar:'night'}).theme,'dark');assert.equal(sky(60,{rise:null,set:null,polar:'day'}).theme,'light');
  assert.deepEqual([greeting(120),greeting(480),greeting(800),greeting(1200)],['Still up?','Good morning.','Good afternoon.','Good evening.']);
});

test('a job’s schedule gives every time of day it runs',()=>{
  assert.deepEqual(runTimes('30 7 * * *'),[450]);assert.deepEqual(runTimes('0 8 * * *'),[480]);
  assert.deepEqual(runTimes('15 */3 * * *'),[15,195,375,555,735,915,1095,1275]);
  assert.deepEqual(runTimes('15 */5 * * *'),[15,315,615,915,1215]);
  assert.deepEqual(runTimes('0 9 * * 1'),[]);assert.deepEqual(runTimes(''),[]);assert.deepEqual(runTimes('5 */0 * * *'),[]);
});

test('the face puts midnight at the bottom and runs clockwise, noon at the top',()=>{
  const at=(m)=>point(m,100).map(n=>Math.round(n));
  assert.deepEqual(at(0),[200,300]);assert.deepEqual(at(360),[100,200]);assert.deepEqual(at(720),[200,100]);assert.deepEqual(at(1080),[300,200]);
  assert.equal(clockOf(450),'07:30');assert.equal(clockOf(1445),'00:05');assert.equal(clockOf(0),'00:00');
});
