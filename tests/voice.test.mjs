import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceController,voiceCommand,spokenPlan} from '../public/voice-core.mjs';
function fixture(){
  const instances=[],spoken=[],timers=new Map();let serial=0;
  class Recognition{constructor(){instances.push(this);}start(){this.started=true;}stop(){this.stopped=true;}abort(){this.aborted=true;}}
  class Utterance{constructor(text){this.text=text;}}
  const synthesis={cancel(){this.cancelled=true;},getVoices(){return [{lang:'en-GB',localService:true}];},speak(u){spoken.push(u);}};
  const c=createVoiceController({Recognition,Utterance,synthesis,setTimer:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimer:id=>timers.delete(id)});
  const result=(text,final)=>Object.assign([{transcript:text}],{isFinal:final});
  return {c,instances,spoken,timers,result};
}
test('microphone requires explicit start; interim results cannot be submitted and cumulative final results do not duplicate',()=>{
  const {c,instances,result}=fixture();assert.equal(instances.length,0);c.start();const r=instances[0];assert.equal(r.lang,'en-GB');r.onstart();
  r.onresult({results:[result('Budget',false)]});assert.equal(c.state.text,'');assert.equal(c.state.interim,'Budget');
  r.onresult({results:[result('预算一千',true),result('afternoon',false)]});
  r.onresult({results:[result('预算一千',true),result('下午一点出发',true)]});assert.equal(c.state.text,'预算一千 下午一点出发');
  c.stop();assert.equal(r.stopped,true);assert.equal(c.state.phase,'stopping');r.onend();assert.equal(c.state.phase,'review');assert.equal(c.state.interim,'');
});
test('cancel, visibility disposal and permission failure ignore late recognition events',()=>{
  const {c,instances,result,timers}=fixture();c.start();const first=instances[0];c.cancel();assert.equal(first.aborted,true);
  first.onresult({results:[result('Confirm write',true)]});first.onstart();assert.equal(c.state.text,'');assert.equal(c.state.phase,'idle');
  c.start();const second=instances[1];second.onerror({error:'not-allowed'});assert.match(c.state.error,/permission/);second.onend();assert.match(c.state.error,/permission/);
  c.start();c.dispose();assert.equal(instances[2].aborted,true);assert.equal(timers.size,0);
});
test('recording deadline and stop timeout preserve final words, never promote partial words',()=>{
  const {c,instances,result,timers}=fixture();c.start();const r=instances[0];r.onresult({results:[result('完整句子',true),result('未确定',false)]});
  [...timers.values()].find(t=>t.ms===60000).fn();assert.equal(r.stopped,true);
  [...timers.values()].find(t=>t.ms===3000).fn();assert.equal(r.aborted,true);assert.equal(c.state.text,'完整句子');assert.equal(c.state.interim,'');assert.equal(c.state.phase,'review');
});
test('speaking stops before listening, interruption cancels queued chunks, and synthesis failures are explicit',()=>{
  const {c,instances,spoken}=fixture();c.speak('第一句。第二句。');assert.equal(c.state.speaking,true);assert.equal(spoken.length,1);assert.equal(spoken[0].voice.localService,true);
  c.start();assert.equal(c.state.speaking,false);spoken[0].onend();assert.equal(spoken.length,1);assert.equal(instances.length,1);
  c.cancel();c.speak('你好。');spoken[1].onerror({error:'not-allowed'});assert.match(c.state.error,/auto.reading/);assert.equal(c.state.speaking,false);
  const missing=createVoiceController({});missing.start();assert.match(missing.state.error,/does not support/);missing.speak('你好');assert.match(missing.state.error,/cannot read aloud/);
});
test('voice routes only exact inspection/selection/replan commands and never dispatches a calendar write',()=>{
  const plans=[{id:'a',name:'compact route'},{id:'b',name:'reputation priority'}];
  assert.deepEqual(voiceCommand('Select the second plan.',plans),{type:'select',id:'b'});
  assert.equal(voiceCommand('Select the third plan',plans).type,'unavailable');assert.equal(voiceCommand('Explain the current plan',plans).type,'read');
  assert.equal(voiceCommand('Refresh calendar and replan',plans).type,'replan');
  for(const s of ['Confirm','Confirm calendar write','Book a haircut','choose 2 and buy tickets','不要Select the second plan'])assert.notEqual(voiceCommand(s,plans).type,'select');
  assert.equal(voiceCommand('Confirm calendar write',plans).type,'approval');assert.equal(voiceCommand('Change the budget to 800 kronor',plans).type,'intent');
});
test('spoken summary uses selected plan facts and keeps tentative prices and approvals explicit',()=>{
  const summary=spokenPlan({places:{movie:{name:'影院'}}},{name:'compact route',stops:[{kind:'movie',placeId:'movie',start:841,end:961,locked:true}],homeAt:1100,reservedTotal:730,budgetVerified:false});
  assert.match(summary,/14:01/);assert.match(summary,/This time is locked/);assert.match(summary,/Estimated reserve: 730/);assert.match(summary,/not a merchant quote/);assert.match(summary,/manual confirmation/);
});
