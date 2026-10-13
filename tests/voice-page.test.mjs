import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer,createSilenceWatch} from '../public/voice.mjs';

test('a recording ends after a pause that follows speech, or when nothing is said, or at the limit',()=>{
  const loud=0.05,quiet=0.002;
  let watch=createSilenceWatch({quietMs:1300,graceMs:5000,maxMs:14000});
  assert.equal(watch(quiet,500),false);assert.equal(watch(loud,1000),false);assert.equal(watch(quiet,1500),false);
  assert.equal(watch(quiet,2700),false);assert.equal(watch(quiet,2800),true);                 // 1.3 s of quiet after speech
  watch=createSilenceWatch();assert.equal(watch(loud,1000),false);assert.equal(watch(quiet,1500),false);assert.equal(watch(loud,2500),false);
  assert.equal(watch(quiet,3000),false);assert.equal(watch(quiet,3900),false);assert.equal(watch(quiet,4300),true);  // a pause mid-sentence restarts the count
  watch=createSilenceWatch();assert.equal(watch(quiet,4900),false);assert.equal(watch(quiet,5000),true);            // nothing said at all
  watch=createSilenceWatch();assert.equal(watch(loud,13900),false);assert.equal(watch(loud,14000),true);            // the limit
});

test('clips play one after another, and a new recording silences what is queued',async()=>{
  const played=[];let finish=null;
  const makeAudio=src=>{const audio={src,paused:false,play(){played.push(src.slice(-4));return new Promise(resolve=>{finish=()=>{audio.onended();resolve();};});},pause(){audio.paused=true;}};return audio;};
  const spoken=[],synth={speak(u){spoken.push(u.text);setImmediate(()=>u.onend());},cancel(){spoken.push('(cancel)');}};
  const player=createPlayer({makeAudio,synth,Utterance:function(text){this.text=text;}});
  player.say({audio:'AAAA'});const second=player.say({audio:'BBBB'});
  await new Promise(r=>setImmediate(r));assert.deepEqual(played,['AAAA']);              // the second waits for the first
  finish();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.deepEqual(played,['AAAA','BBBB']);
  finish();await second;
  await player.say({text:'No server voice, so the browser speaks.'});assert.deepEqual(spoken,['No server voice, so the browser speaks.']);
  player.say({audio:'CCCC'});const queued=player.say({audio:'DDDD'});
  await new Promise(r=>setImmediate(r));player.stop();finish();await queued;
  assert.deepEqual(played,['AAAA','BBBB','CCCC']);assert.ok(spoken.includes('(cancel)'));  // the queued clip never played
  await player.say({});                                                                   // nothing to say is not an error
});
