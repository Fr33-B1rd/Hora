export const voiceErrors={
  'not-allowed':'Microphone permission not enabled. Please allow microphone in the browser’s site settings, then try again.',
  'service-not-allowed':'This browser’s speech recognition service is unavailable. Open this page in a browser that supports speech recognition, or enter text.',
  'audio-capture':'No usable microphone available; please check device connection and system permissions.',
  'network':'Browser voice service connection failed; use on‑device recognition.',
  'local-network':'Unable to connect to on‑device transcription service; please check that Daylight is still running.',
  'local-recording':'Recording failed to start, please check if the microphone is occupied or switch to a browser that supports recording.',
  'audio-too-large':'The recording is too large, please shorten and retry.',
  'no-speech':'Didn’t catch the content, please say again or type it.',
  'language-not-supported':'The current voice service does not support the selected language, please change the language.'
};
export function voiceCommand(text,plans=[]){
  const s=text.trim().replace(/[!?.,]/g,'').replace(/\b(one|two|three|first|second|third)\b/gi,w=>({one:'1',two:'2',three:'3',first:'1',second:'2',third:'3'}[w.toLowerCase()]));
  if(/^(?:please )?(?:read|explain) (?:(?:the |my )?current |the |my )?(?:plan|itinerary)$/i.test(s))return {type:'read'};
  if(/^(?:please )?(?:replan|refresh (?:the )?calendar and replan)$/i.test(s))return {type:'replan'};
  const n=s.match(/^(?:please )?(?:choose|select) (?:the )?(?:plan )?([123])(?: plan)?$/i);
  if(n)return plans[Number(n[1])-1]?{type:'select',id:plans[Number(n[1])-1].id}:{type:'unavailable'};
  const named=plans.find(p=>[p.name,'choose '+p.name,'select '+p.name].some(v=>s.toLowerCase()===v.toLowerCase()));if(named)return {type:'select',id:named.id};
  if(/\b(?:confirm|book|purchase|invite)\b|save.*calendar|buy.*tickets/i.test(s))return {type:'approval'};
  return {type:'intent'};
}
const time=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export function spokenPlan(result,plan){
  if(!plan)return 'There is no plan yet. Tell me where you want to start, what you want to do, and any budget or time preferences.';
  const labels={hair:'get a haircut',ramen:'eat ramen',movie:'watch a film'};
  const budget=result.constraints?.budgetMode==='unlimited'?'There is no budget ceiling. ':result.constraints?.budgetMode==='flexible'?'Spending is flexible; estimates are shown for comparison. ':'';
  const stops=plan.stops.map((s,i)=>'Stop '+(i+1)+', '+time(s.start)+' to '+time(s.end)+': '+(s.label||labels[s.kind]||'activity')+' at '+(result.places[s.placeId]?.name||'the selected venue')+(s.locked?'. This time is locked':'')+'. ').join('');
  return budget+'Selected: '+plan.name+'. '+stops+'Return to the starting point at '+time(plan.homeAt)+'. '+(plan.budgetVerified?'Verified total: ':'Estimated reserve: ')+plan.reservedTotal+' SEK. '+(plan.budgetVerified?'Prices may change. ':'This is not a merchant quote. ')+'Calendar changes require a preview and manual confirmation.';
}
// No action execution in the speech controller: microphone output stays a draft
// until the user explicitly submits it. All timers and late events are scoped.
export function createVoiceController({Recognition,synthesis,Utterance,onChange=()=>{},stopTimeout=3000,setTimer=setTimeout,clearTimer=clearTimeout}){
  let state={phase:'idle',text:'',interim:'',error:'',speaking:false},recognition=null,generation=0,recordTimer,stopTimer,speechGeneration=0,speechTimer;
  const emit=patch=>{state={...state,...patch};onChange({...state});};
  const clear=()=>{clearTimer(recordTimer);clearTimer(stopTimer);};
  const active=()=>['starting','listening','stopping'].includes(state.phase);
  const stopSpeaking=()=>{speechGeneration++;clearTimer(speechTimer);synthesis?.cancel();emit({speaking:false});};
  const cancel=()=>{generation++;clear();const old=recognition;recognition=null;try{old?.abort();}catch{}emit({phase:'idle',interim:'',error:''});};
  const stop=()=>{
    if(!active()||state.phase==='stopping')return;
    emit({phase:'stopping'});clearTimer(recordTimer);
    try{recognition?.stop();}catch{}
    const version=generation;
    stopTimer=setTimer(()=>{if(version!==generation)return;generation++;try{recognition?.abort();}catch{}recognition=null;emit({phase:state.text?'review':'idle',interim:'',error:state.text?'':'Failed to obtain full transcription; please try again.'});},stopTimeout);
  };
  return {
    get state(){return {...state};},get supported(){return !!Recognition;},get canSpeak(){return !!synthesis&&!!Utterance;},
    start(lang='en-GB'){
      if(active())return;
      stopSpeaking();cancel();
      if(!Recognition){emit({error:'Your browser does not support speech recognition. Please open this page in a browser that supports it, or enter input below.'});return;}
      const version=++generation;let r;
      try{r=new Recognition();recognition=r;r.lang=lang;r.continuous=true;r.interimResults=true;r.maxAlternatives=1;}
      catch{emit({phase:'idle',error:'Unable to start speech recognition; please switch to a supported browser.'});return;}
      emit({phase:'starting',text:'',interim:'',error:''});
      r.onstart=()=>{if(version===generation&&state.phase==='starting')emit({phase:'listening'});};
      r.onresult=e=>{
        if(version!==generation||!active())return;let text='',interim='';
        for(const result of Array.from(e.results)){if(result.isFinal)text+=result[0].transcript+' ';else interim+=result[0].transcript+' ';}
        emit({text:text.trim().slice(0,2000),interim:interim.trim().slice(0,2000)});
        if(text.length>=2000)stop();
      };
      r.onerror=e=>{if(version!==generation)return;generation++;clear();try{r.abort();}catch{}recognition=null;emit({phase:state.text?'review':'idle',interim:'',error:voiceErrors[e.error]||(e.error==='local-transcription'?e.message:'')||'Recognition interrupted. Please check the transcription and try again.'});};
      r.onend=()=>{if(version!==generation)return;generation++;clear();recognition=null;emit({phase:state.text?'review':'idle',interim:'',error:state.text?'':voiceErrors['no-speech']});};
      recordTimer=setTimer(stop,60000);
      try{r.start();}catch{generation++;clear();recognition=null;emit({phase:'idle',error:'Microphone failed to start; check browser permissions and retry.'});}
    },stop,cancel,stopSpeaking,
    edit(text){if(!active())emit({text:text.slice(0,2000),phase:text.trim()?'review':'idle',error:''});},
    clear(){cancel();emit({text:'',interim:''});},
    speak(text,lang='en-GB'){
      if(active())cancel();stopSpeaking();if(!synthesis||!Utterance){emit({error:'Your browser cannot read aloud; the reply is displayed as text.'});return;}
      const chunks=text.slice(0,1200).match(/[^。！？.!?]{1,90}[。！？.!?]?/g)||[];const version=++speechGeneration;
      const next=()=>{
        if(version!==speechGeneration)return;clearTimer(speechTimer);
        const part=chunks.shift();if(!part){emit({speaking:false});return;}
        const u=new Utterance(part);u.lang=lang;u.rate=1;
        const voices=synthesis.getVoices();u.voice=voices.find(v=>v.lang.toLowerCase()===lang.toLowerCase()&&v.localService)||voices.find(v=>v.lang.toLowerCase().startsWith(lang.slice(0,2)))||null;
        u.onend=next;u.onerror=e=>{if(version!==speechGeneration)return;stopSpeaking();emit({error:e.error==='not-allowed'?'Browser hasn’t allowed auto‑reading; please click ”Read reply”.':'Read‑aloud failed; text reply retained.'});};
        speechTimer=setTimer(()=>{if(version!==speechGeneration)return;stopSpeaking();emit({error:'Read‑aloud timed out; text reply retained.'});},25000);
        emit({speaking:true});try{synthesis.speak(u);}catch{stopSpeaking();emit({error:'The read-aloud service is unavailable; the text reply has been kept.'});}
      };next();
    },
    dispose(){cancel();stopSpeaking();}
  };
}
