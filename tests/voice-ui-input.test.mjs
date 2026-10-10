import test from 'node:test';
import assert from 'node:assert/strict';

test('composer commits IME text without replacing the editor, then sends exact text and unlocks after failure',async()=>{
 const listeners=new Map();let field,button,html='',renders=0;
 const root={dataset:{},querySelector:()=>null,set innerHTML(value){
  html=value;renders++;
  field={id:'voice-draft',value:value.match(/<textarea[^>]*>(.*?)<\/textarea>/s)?.[1]||'',focus(){},setSelectionRange(){},hasAttribute(){return false;}};
  button={disabled:/data-voice="send"[^>]*disabled/.test(value)};
 }};
 const doc={hidden:false,activeElement:null,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},getElementById:id=>id==='voice-panel'?root:id==='voice-draft'?field:null,querySelector:()=>button};
 const old={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,sessionStorage:globalThis.sessionStorage};
 Object.assign(globalThis,{document:doc,window:{addEventListener(){}},sessionStorage:{getItem(){return null;},setItem(){}},fetch:async()=>Response.json({ready:false})});
 const dispatch=async(name,extra={})=>{for(const fn of listeners.get(name)||[])await fn({target:field,...extra});};
 let sent=[],fail=true;
 try{
  const ui=await import('../public/voice-ui.mjs');
  ui.initVoice(async text=>{sent.push(text);if(fail)throw Error('test connection failure');return {message:'test reply'};});
  await new Promise(r=>setImmediate(r));
  assert.equal(button.disabled,true);
  const editor=field,before=renders;
  await dispatch('compositionstart');field.value='你更推荐哪一个？';
  await dispatch('input',{isComposing:true});
  ui.updateAgentProgress({label:'unrelated asynchronous repaint'});
  assert.equal(field,editor);assert.equal(button.disabled,true);
  await dispatch('compositionend'); // Some IMEs do not emit a final non-composing input.
  assert.equal(field,editor);assert.equal(renders,before);assert.equal(button.disabled,false);
  await dispatch('input',{isComposing:false});assert.equal(field,editor);
  await dispatch('click',{target:{closest:()=>({dataset:{voice:'send'}})}});
  assert.deepEqual(sent,['你更推荐哪一个？']);assert.match(html,/test connection failure/);
  field.value='你好';await dispatch('input',{isComposing:false});assert.equal(button.disabled,false);
  field.value='  ';await dispatch('input',{isComposing:false});assert.equal(button.disabled,true);
  field.value='再试一次';await dispatch('change');assert.equal(button.disabled,false);
  fail=false;await dispatch('click',{target:{closest:()=>({dataset:{voice:'send'}})}});
  assert.deepEqual(sent,['你更推荐哪一个？','再试一次']);assert.match(html,/test reply/);
  field.value='下一轮';await dispatch('input',{isComposing:false});assert.equal(button.disabled,false);
 }finally{Object.assign(globalThis,old);}
});
