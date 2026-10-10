import {createVoiceController} from './voice-core.mjs';
import {createLocalRecognition} from './local-recognition.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Replies are plain text; show the model's occasional **emphasis** as bold
// instead of literal asterisks. Escaping happens first, so no markup gets through.
const rich=s=>esc(s).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
let send,read,busy=false,sending=false,autoRead=true,language='en-GB',turns=[],slots={},lastReply='',visible=false;
let execution={},progress=null,steps=[],resumeToken=null,draftReply='';
let composing=false,syncingDraft=false;
export function updateAgentProgress(e){
  // The reply streams in as it is written; a retraction means the model went back to work.
  if(e.phase==='reply_delta'){draftReply=e.text||'';paint();return;}
  if(e.phase==='reply_retracted'||e.phase==='tool_start')draftReply='';
  progress=e;if(e.phase==='tool_done'||e.phase==='tool_error')steps=[...steps,e].slice(-8);paint();
}
// Keep the previous-language conversation intact; new English turns start with
// a clean context instead of inheriting instructions or labels from old replies.
const chatKey='daylight-chat-en-v1';
function saveChat(){try{sessionStorage.setItem(chatKey,JSON.stringify({turns,slots,resumeToken}));}catch{}}
function sourceCards(cards=[]){return cards.map(c=>{let u;try{u=new URL(c.url);}catch{return '';}
  if(u.protocol!=='https:'||!['www.svt.se','www.visitstockholm.com'].includes(u.hostname))return '';
  return `<a class="chat-source" href="${esc(u.href)}" target="_blank" rel="noreferrer"><small>${esc(c.source)} · ${c.type==='news'?'Local news':'Event source'}${c.translatedTitle?' · Machine-translated title':''} ↗</small><strong>${esc(c.translatedTitle||c.title)}</strong>${c.translatedTitle?`<span>${esc(c.title)}</span>`:''}<span>${c.type==='news'?esc(new Date(c.publishedAt).toLocaleString('en-GB',{timeZone:'Europe/Stockholm'}))+' · Stockholm time':esc(c.start+' to '+c.end+' · '+c.venue+' · '+(c.occurrences?.length?c.occurrences.map(o=>o.date+' '+o.start+'–'+o.end).join('；'):'Specific sessions pending verification')+(c.displayDistance&&Number.isFinite(c.distance)?' · From '+c.distanceOrigin+', approximately '+c.distance+' km':''))}</span></a>`;}).join('');}
function chatHistory(){return `<div class="voice-conversation" aria-label="Conversation log">${turns.length?turns.map(t=>`<div class="voice-turn ${t.role}"><b>${t.role==='user'?'you':'Daylight'}</b><p>${rich(t.text)}</p>${sourceCards(t.cards)}${t.trace?.length?`<details class="voice-privacy"><summary>This session’s processing record · ${t.trace.length} steps</summary>${t.trace.map(step=>`<p>${esc(step.label)} · ${step.status==='ok'?'Complete':'Not completed'}：${esc(step.summary)}</p>`).join('')}</details>`:''}${t.checkedAt?`<small>Queried at ${esc(new Date(t.checkedAt).toLocaleString('en-GB',{timeZone:'Europe/Stockholm'}))} · Stockholm time</small>`:''}</div>`).join(''):'<div class="voice-turn assistant"><b>Daylight</b><p>What would you like to do today? Start with a rough idea; you do not need to have every detail decided. We can plan an outing or explore local news and events.</p></div>'}${sending&&draftReply?'<div class="voice-turn assistant"><b>Daylight</b><p>'+rich(draftReply)+'</p></div>':sending?'<div class="voice-turn assistant" role="status"><b>'+esc(progress?.label||'Starting query')+'</b>'+(progress?.elapsedMs?'<small> Used '+Math.floor(progress.elapsedMs/1000)+' seconds</small>':'')+steps.map(e=>'<p>'+esc(e.label)+' · '+esc(e.phase==='tool_error'?'Not completed':e.summary||'Completed')+'</p>').join('')+'</div>':''}</div>`;}
// Label, don't gate: show what was saved and whose it is, so the user can correct it.
function understood(){
  const s=slots||{},l=s.labels||{},defs=s.activityDefinitions||{},ids=s.activities||[];
  if(!ids.length&&!s.origin&&!s.date)return '';
  const fact=(key,text,correction)=>`<button type="button" class="fact ${l[key]==='assistant'?'assumed':'said'}" data-voice-fact="${esc(correction)}"><small>${l[key]==='assistant'?'I assumed':'You said'}</small>${esc(text)}</button>`;
  const facts=[];
  if(s.date)facts.push(fact('date',s.date,'Change the date to '));
  if(s.origin)facts.push(fact('origin','Leaving from '+s.origin,'I will start from '));
  if(s.start)facts.push(fact('start','Leave at '+s.start,'I will leave at '));
  if(s.deadline)facts.push(fact('deadline','Back by '+s.deadline,'I want to be back by '));
  if(s.budgetMode&&s.budgetMode!=='unknown')facts.push(fact('budget',s.budgetMode==='limited'?'Budget '+s.budget+' SEK':s.budgetMode==='unlimited'?'No budget limit':'Budget open','Make the budget '));
  for(const id of ids){const a=defs[id];if(!a)continue;facts.push(fact('activity:'+id,a.label,'Remove “'+a.label+'”'));if(!a.eventRef&&(a.windowStart||a.windowEnd))facts.push(fact('window:'+id,a.label+' at '+(a.windowStart||'any time')+'–'+(a.windowEnd||'any time'),'Change the time for “'+a.label+'” to '));}
  if(s.precedence?.length)facts.push(fact('precedence','Order: '+s.precedence.map(e=>(defs[e.before]?.label||e.before)+' before '+(defs[e.after]?.label||e.after)).join(', '),'The order does not matter'));
  return `<div class="voice-facts" aria-label="What I understood"><b>What I understood</b><div>${facts.join('')}</div><small>Dashed items are my assumptions. Click any item to correct it.</small></div>`;
}
const mic='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
let service=null;
const Recognition=createLocalRecognition({getUserMedia:navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices),Recorder:window.MediaRecorder});
const controller=createVoiceController({Recognition,stopTimeout:190000,synthesis:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,onChange:paint});
export const voicePanel=()=>'<section id="voice-panel" class="card live-section voice-panel" aria-label="Text and voice conversation"></section>';
export function initVoice(onSend,onRead,controls={}){send=onSend;read=onRead;execution=controls;try{const saved=JSON.parse(sessionStorage.getItem(chatKey));if(Array.isArray(saved?.turns)){turns=saved.turns.slice(-20);slots=saved.slots||{};resumeToken=saved.resumeToken||null;lastReply=turns.filter(t=>t.role==='assistant').at(-1)?.text||'';}}catch{}paint();void checkService();}
async function checkService(){service=null;paint();try{const r=await fetch('/api/voice/status');if(!r.ok)throw Error();service=await r.json();}catch{service={ready:false,error:'Unable to connect to local voice service, please check that Daylight is running.'};}paint();}
export function resumePendingQuery(){if(execution.pending?.()&&!sending)void submit('',{reattach:true});}
export function pauseVoice(){composing=false;controller.dispose();}
export function mountVoice(isBusy){busy=!!isBusy;const next=!!document.getElementById('voice-panel');if(visible&&!next)controller.dispose();visible=next;paint();}
function paint(){
  // Keep the actual textarea alive while an IME owns its composition session,
  // and while typing synchronizes the controller. Replacing it loses input.
  if(composing||syncingDraft)return;
  const root=document.getElementById('voice-panel');if(!root)return;
  const oldHistory=root.querySelector('.voice-conversation'),oldScroll=oldHistory?.scrollTop||0;
  const latest=turns.at(-1),turnKey=(latest?latest.role+latest.text:'')+(draftReply?'·draft':'');
  const followHistory=root.dataset.lastTurn!==turnKey||!oldHistory||oldHistory.scrollHeight-oldHistory.clientHeight-oldScroll<24;
  const s=controller.state,recording=['starting','listening','stopping'].includes(s.phase),disabled=busy||sending;
  // Partial transcripts update only this panel, never reconstructing the map.
  const focused=document.activeElement?.id==='voice-draft',selection=focused?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
  root.innerHTML=`<div class="voice-heading"><div><span class="eyebrow">LET’S TALK IT THROUGH</span><h3>Talk with Daylight</h3></div><span class="voice-badge ${recording?'is-recording':''}">${s.phase==='listening'?'● Microphone on':s.phase==='starting'?'Waiting for microphone':s.phase==='stopping'?'On-device transcription in progress':s.speaking?'Reading aloud':'On-device recognition · Click to record'}</span></div><p>Say something and you can continue chatting via text or voice.</p>${chatHistory()}${understood()}<div class="voice-toolbar"><button class="button voice-mic" type="button" data-voice="${recording?'stop':'start'}" ${disabled||!controller.supported||!service?.ready||s.phase==='stopping'?'disabled':''}>${mic}${recording?'End speaking':'Start speaking'}</button>${recording?'<button class="button outline" type="button" data-voice="cancel">Cancel</button>':''}<label>Speech language<select data-voice-language ${recording||disabled?'disabled':''}><option value="en-GB" selected>English</option></select></label><label class="live-check"><input type="checkbox" data-voice-auto ${autoRead?'checked':''} ${!controller.canSpeak?'disabled':''}>Auto-read replies</label></div><p class="voice-status" role="status">${esc(s.error||(!controller.supported?'Current browser does not support recording; please switch to a browser that does or enter text.':s.phase==='starting'?'Starting microphone, please handle the browser permission prompt.':s.phase==='listening'?'Listening…Maximum per session 60 seconds, then click ”End speaking”.':s.phase==='stopping'?'Microphone closed, performing on-device transcription, please wait.…':!service?'Loading on-device voice model…':!service.ready?(service.error||'On-device voice not installed; please complete installation first.'):disabled?'Processing your request…':'Voice is ready. Stop recording, review the transcript, then send.'))}</p>${service&&!service.ready?'<button type="button" class="text-button" data-voice="retry-service">Retry local voice connection</button>':''}${s.interim?`<p class="voice-interim">${esc(s.interim)} <small>Recognizing</small></p>`:''}<label class="voice-draft-label" for="voice-draft">Your message</label><textarea id="voice-draft" maxlength="2000" rows="2" placeholder="Example: Visit a museum first, then have Chinese food, budget unlimited." ${recording||disabled?'disabled':''}>${esc(s.text)}</textarea><div class="live-actions">${sending?'<button class="button outline" type="button" data-voice="stop-query">Stop query</button>':resumeToken?'<button class="button" type="button" data-voice="resume">Continue last query</button>':''}${!sending&&execution.pending?.()?'<button class="button outline" type="button" data-voice="reconnect">Restore query connection</button>':''}<button class="button" type="button" data-voice="send" ${recording||disabled||!s.text.trim()?'disabled':''}>Send</button><button class="button outline" type="button" data-voice="read" ${recording||disabled||!controller.canSpeak?'disabled':''}>${lastReply?'Read reply':'Read current plan'}</button>${s.speaking?'<button class="button outline" type="button" data-voice="quiet">Stop reading</button>':''}<button class="text-button" type="button" data-voice="clear" ${recording||disabled?'disabled':''}>New conversation</button></div><details class="voice-privacy"><summary>Voice & data</summary><p>Click Start speaking to record in English. Audio is transcribed on this computer and is not sent to cloud recognition. Review your transcript before sending; check the spelling of Swedish place names. Sending shares your message, recent conversation and relevant tool results with Nebius. Calendar writes still need a preview and manual confirmation. This English chat uses a fresh context; previous-language browser records are retained separately. <a href="/privacy.html" target="_blank">Data and services</a></p></details>`;
  const history=root.querySelector('.voice-conversation');if(history)history.scrollTop=followHistory?history.scrollHeight:oldScroll;root.dataset.lastTurn=turnKey;
  if(focused&&!recording&&!disabled){const field=document.getElementById('voice-draft');field.focus();field.setSelectionRange(...selection);}
}
function syncDraft(field){
  syncingDraft=true;
  try{controller.edit(field.value);}finally{syncingDraft=false;}
  const button=document.querySelector('[data-voice="send"]');
  if(button)button.disabled=composing||busy||sending||['starting','listening','stopping'].includes(controller.state.phase)||!controller.state.text.trim();
}
document.addEventListener('compositionstart',e=>{if(e.target.id==='voice-draft'){composing=true;const button=document.querySelector('[data-voice="send"]');if(button)button.disabled=true;}});
document.addEventListener('compositionend',e=>{if(e.target.id==='voice-draft'){composing=false;syncDraft(e.target);}});
document.addEventListener('input',e=>{if(e.target.id==='voice-draft'&&!composing&&!e.isComposing)syncDraft(e.target);});
document.addEventListener('change',e=>{if(e.target.id==='voice-draft'&&!composing)syncDraft(e.target);});
document.addEventListener('change',e=>{if(e.target.hasAttribute('data-voice-language'))language=e.target.value;if(e.target.hasAttribute('data-voice-auto')){autoRead=e.target.checked;if(!autoRead)controller.stopSpeaking();}});
document.addEventListener('click',async e=>{
  const fact=e.target.closest('[data-voice-fact]');
  if(typeof fact?.dataset?.voiceFact==='string'&&!busy&&!sending){controller.edit(fact.dataset.voiceFact);paint();const field=document.getElementById('voice-draft');field?.focus();field?.setSelectionRange(field.value.length,field.value.length);return;}
  const action=e.target.closest('[data-voice]')?.dataset.voice;if(!action)return;
  if(action==='quiet'){controller.stopSpeaking();return;}
  if(action==='cancel'){controller.cancel();controller.clear();return;}
  if(action==='stop-query'){try{await execution.cancel?.();}catch(e){updateAgentProgress({label:e.message});}return;}
  if(busy||sending)return;
  if(action==='resume'){await submit('',{resume:true});return;}
  if(action==='reconnect'){await submit('',{reattach:true});return;}
  if(action==='retry-service'){void checkService();return;}
  if(action==='start'){if(service?.ready)controller.start(language);return;}
  if(action==='stop'){controller.stop();return;}
  if(action==='read'){controller.speak(lastReply||read?.()||'This request was not completed; please restore the connection.','en-GB');return;}
  if(action==='clear'){controller.clear();controller.stopSpeaking();turns=[];slots={};lastReply='';resumeToken=null;execution.forget?.();saveChat();paint();return;}
  if(action!=='send'||composing||['starting','listening','stopping'].includes(controller.state.phase))return;
  const draft=document.getElementById('voice-draft');if(draft)syncDraft(draft);
  if(!controller.state.text.trim())return;
  await submit(controller.state.text.trim());
});
async function submit(text,{resume=false,reattach=false}={}){
  if(sending)return;
  if(execution.pending?.()&&!reattach){await submit('',{reattach:true});return;}
  const history=turns.slice(-12).map(t=>({role:t.role,content:t.text.slice(0,1000)}));
  controller.dispose();sending=true;progress=null;steps=[];draftReply='';
  if(!reattach)turns.push({role:'user',text:resume?'Continue last query':text});saveChat();paint();
  let reply;
  try{reply=await send(text,history,slots,{resumeToken:resume?resumeToken:undefined,reattach});lastReply=reply.message;if(reply.slots)slots=reply.slots;resumeToken=reply.resumeToken||null;}
  catch(e){if(e.status===400||e.status===404)resumeToken=null;lastReply=e.message||'This request did not finish. Reconnect to continue.';}
  turns.push({role:'assistant',text:lastReply,cards:reply?.cards,trace:reply?.trace,checkedAt:reply?.checkedAt});turns=turns.slice(-20);saveChat();sending=false;controller.clear();paint();
  if(autoRead&&visible&&!document.hidden)controller.speak(lastReply,'en-GB');
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.dispose();});
window.addEventListener('pagehide',()=>controller.dispose());
