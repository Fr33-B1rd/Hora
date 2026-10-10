import {requestModel,outputPolicy,actorSampling} from './model-call.mjs';
import {agentSkills} from './agent-skills.mjs';
import {createAgentEnvironment,agentToolDefinitions,validateArguments,tripFields} from './agent-tools.mjs';
import {interpretTurn} from './turn-intent.mjs';
import {isDeepStrictEqual} from 'node:util';
const fn=(name,description,properties,required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const clarification=fn('clarify','Pause itinerary planning to ask a question that requires a user decision. First save the known date, every stated activity and other conditions in patch; at least one activity is required. Do not ask for known information. Never ask for a leave time, return time or budget: they are optional and apply only when the user states them. For general conversation, inspiration or event discovery, reply in plain text without requiring an itinerary. Do not claim unfinished searches, scheduling or calendar writes succeeded.',{question:{type:'string',maxLength:300},field:{type:'string',enum:['origin','date','time','budget','preference']},patch:{type:'object',properties:tripFields,additionalProperties:false},assumptions:{type:'array',items:{type:'string'}}},['question','field','patch']);
const pausePlanning=fn('pause_planning','Only when the USER changes the topic, cancels, or asks to discuss instead of execute: preserve the trip but pause its pending planning obligation. Never use this to bypass a failed or unattempted plan.',{userQuote:{type:'string',maxLength:300,description:'Exact current user words that change or cancel the planning goal.'}},['userQuote']);
const controls=[
  fn('load_skill','Load local skill instructions and enable its supported tools.',{name:{type:'string'}},['name']),
clarification
];
// A reply cut at the length cap ends at its last complete sentence.
const wholeSentences=text=>{const t=text.trim();if(/[.!?…。！？]["”’)\]]?$/.test(t))return t;const end=Math.max(...['. ','! ','? ','.\n','!\n','?\n'].map(m=>t.lastIndexOf(m)));if(end>t.length/2)return t.slice(0,end+1);const line=t.lastIndexOf('\n');return line>t.length/2?t.slice(0,line).trimEnd():t.slice(0,Math.max(t.lastIndexOf(' '),1)).trimEnd()+'…';};
const clamp=(text,max)=>text.length>max?wholeSentences(text.slice(0,max)):text;
// The chat shows plain text. Remove markdown the model adds anyway: tables,
// headings, list markers and emphasis; keep the sentences.
export const plainText=text=>text.split('\n').filter(line=>!/^\s*\|/.test(line)&&!/^\s*[-=*_]{3,}\s*$/.test(line)).map(line=>line.replace(/^\s*#{1,6}\s+/,'').replace(/^\s*(?:[-•*–]|\d+[.)])\s+/,'').replace(/\*\*|__|`/g,'').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g,'$1$2').trimEnd()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
const labels={select_option:'Record tentative choice',read_place_website:'Read merchant website',assess_place_offer:'Verify experience details',set_activity_window:'Retain activity time preference',discover_candidates:'Prepare full itinerary locations',set_budget:'Record budget preference',pause_planning:'Stash planning task',present_events:'Present source activities',clarify:'Waiting for your input',event_details:'Check published sessions',load_skill:'Load relevant skill',update_trip:'Update current round requirements',search_places:'Find location',select_candidates:'Compare candidate locations',place_details:'Verify location information',route:'Check transportation',plan_itinerary:'Validate and compare itinerary',select_plan:'Switch plan',calendar_availability:'View busy periods',calendar_changes:'Check calendar changes',inspect_activity:'Inspect activity evidence',read_news:'Read local news',nearby_events:'Search nearby activities'};

export async function runAgent(raw,config,services,{fetchImpl=fetch,maxRounds=24,maxTools=28,timeLimit=180000,skillCatalog,onProgress=()=>{},saveCheckpoint=()=>{},onDiagnostic=()=>{},signal,modelPolicy=outputPolicy}={}){
  if(typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>2000)throw Error('Please enter 1–2000 characters.');
  if(!config.key)throw Error('Please configure the model first.');
  const history=raw.history||[];
  if(!Array.isArray(history)||history.length>12||history.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>1000))throw Error('Chat history invalid or too long.');
  const started=Date.now(),seen=new Map();let toolCount=0,rounds=0,turn=null,committedFields=[];
  const timings=[],retryBudget={remaining:1};let planNudged=false;
  const audit=(kind,data)=>onDiagnostic({kind,elapsedMs:Date.now()-started,...structuredClone(data)});
  const emit=(phase,label,extra={})=>onProgress({phase,label,elapsedMs:Date.now()-started,...extra});
  const measuredFetch=async(url,opts)=>{const began=Date.now(),body=JSON.parse(opts.body),stage=body.tools?.[0]?.function?.name==='commit_turn'?'intake':'model';
    audit('model_request',{stage,round:rounds,body});
    const row={stage,round:rounds,maxTokens:body.max_tokens,requestBytes:Buffer.byteLength(opts.body),startedMs:began-started};timings.push(row);
    try{const r=await fetchImpl(url,{...opts,signal:signal?AbortSignal.any([opts.signal,signal]):opts.signal});row.headersMs=Date.now()-began;row.status=r.status;return r;}catch(e){row.error=e.name;row.totalMs=Date.now()-began;throw e;}
  };
  const recordAttempt=row=>{Object.assign(timings.at(-1),row);audit('model_metrics',{stage:timings.at(-1).stage,round:rounds,...row});};
  const notifyRetry=info=>{audit('model_retry',{round:rounds,...info});emit('model_retry','This reply reached length limit, regenerating; completed operations retained.',{round:rounds});};
  const reserveMs=Math.min(20000,Math.floor(timeLimit/3));
  const catalog=skillCatalog||await agentSkills(),loaded=new Set(),enabled=new Set(),env=createAgentEnvironment(raw,{...services,signal},{deadline:started+timeLimit-reserveMs});
  const messages=[{role:'system',content:catalog.policy+'\nAvailable skills (load body only when relevant):\n'+JSON.stringify(catalog.entries.map(({name,description})=>({name,description})))+'\nLimits: at most '+maxTools+' tool calls and '+maxRounds+' model rounds. Search/route limits are enforced. When useful work is complete or a user decision is needed, reply in plain text: text without a tool call is delivered to the user as written and ends the turn. Never write text that only announces what you are about to do; call the tool instead.'},...history,{role:'user',content:raw.text}];
  audit('turn_start',{text:raw.text,history,state:env.context().trip,task:env.context().task});
  const output=(message,stopReason='finished')=>{if(committedFields.length&&['output_limit','service_error','limit'].includes(stopReason))message='This round’s conditions have been remembered, but subsequent processing is incomplete. '+message;audit('turn_result',{message,stopReason,state:env.context().trip,task:env.context().task});saveCheckpoint(env.checkpoint());emit('done',stopReason==='finished'?'Round processing completed.':'Round stopped, query progress retained.');return {action:'agent',message:message.slice(0,3000),...env.output(),turnReceipt:{committedFields},skills:[...loaded],stopReason,rounds,toolCount,timings,elapsedMs:Date.now()-started,checkedAt:new Date().toISOString()};};
  const activate=name=>{
    const skill=catalog.entries.find(s=>s.name===name);if(!skill||loaded.has(name))return;
    loaded.add(name);for(const tool of skill.tools)if(agentToolDefinitions.some(t=>t.function.name===tool))enabled.add(tool);
    // Trusted local skill body has instruction authority, provider data does not.
    // Keep one stable system message: some compatible model endpoints only honor
    // the final system message. Loaded skills must not replace root policy.
    messages[0].content+=`\n\nLoaded local skill: ${skill.name}\n${skill.body}`;
  };
  // One invalid field must not cost the user their whole message: commit the
  // interpreted patch together, or failing that field by field, and tell the
  // actor exactly what was left out so it can repair or ask.
  const commitTurn=async()=>{
    const notes=[...new Set([...env.assumptions,...turn.assumptions])];let saved;
    try{saved=await env.handlers.update_trip({patch:turn.patch,assumptions:notes,by:'user'});}
    catch{
      turn.rejected=[];
      for(const keys of [['date'],['origin','originQuote'],['budgetMode','budget'],['start'],['deadline'],['timeMode'],['activities'],['precedence'],['choiceGroups'],['transport'],['lowWalking'],['maxWalking']]){
        const part=Object.fromEntries(keys.filter(k=>Object.hasOwn(turn.patch,k)).map(k=>[k,turn.patch[k]]));if(!Object.keys(part).length)continue;
        try{const r=await env.handlers.update_trip({patch:part,by:'user'});if(!saved?.requiresUserInput)saved={...r,droppedWindows:[...(saved?.droppedWindows||[]),...(r.droppedWindows||[])]};}
        catch(error){turn.rejected.push({fields:Object.keys(part),reason:error.message});for(const k of Object.keys(part))delete turn.patch[k];env.trace.push({label:'Saving round conditions.',status:'error',summary:Object.keys(part).join(', ')+': '+error.message});}
      }
      await env.handlers.update_trip({patch:{},assumptions:notes});
    }
    if(saved?.droppedWindows?.length)turn.droppedWindows=saved.droppedWindows;
    return saved;
  };
  // Text without a tool call is the reply. It is streamed while it is written,
  // then checked only for the few things the host can know better than the
  // model: unreadable protocol output, a plan request that never ran the
  // planner, and requested information that was never looked up.
  let lastDraft=0,coverageNudged=false,styleNudged=false;
  const draft=text=>{if(Date.now()-lastDraft<180)return;lastDraft=Date.now();emit('reply_delta','Writing reply.',{text:clamp(plainText(text),900)});};
  const replyBlocker=(text,closing)=>{
    if(/^\s*[<{\[]|<\/?tool_call|"arguments"\s*:/.test(text))return 'That output was not a readable reply. Call a tool, or answer the user in plain sentences.';
    if(closing)return null;
    if((turn.intent==='planning'||(turn.intent==='update'&&services.previous&&committedFields.length))&&!planNudged&&!env.context().currentPlan&&!env.trace.some(t=>t.action==='plan_itinerary')){
      const p=env.readiness();
      if(enabled.has('plan_itinerary')&&!p.missingFields.some(f=>['date','origin','activities'].includes(f))&&p.remainingPlanAttempts>0){planNudged=true;return turn.intent==='update'?'The trip changed, so the plan on screen is out of date. Run plan_itinerary and report its actual result; do not describe the old timetable.':'The user asked for a plan and the date, departure point and activities are recorded, but plan_itinerary has not run this turn. Run it now and report its actual result; do not describe an itinerary or declare it impossible without it.';}
    }
    if(!styleNudged&&(text.length>800||(text.match(/\b\d{1,2}[:.]\d{2}\b/g)||[]).length>=8)){styleNudged=true;return 'That reply is too long or recites the timetable, which the interface already shows. Say the same thing in at most four plain sentences: the recommendation, the main trade-off, anything you assumed or could not verify, and the next step.';}
    const unread=turn.categories.filter(c=>!env.trace.some(t=>t.action===(c==='news'?'read_news':'nearby_events')));
    if(unread.length&&!coverageNudged){coverageNudged=true;return 'The user asked for '+unread.join(' and ')+', which has not been looked up this turn. Read it with its tool first; if the lookup fails, say so in the reply.';}
    return null;
  };
  const deliver=text=>{
    const checked=!!env.context().currentPlan,unverified=!checked&&turn.intent==='planning'&&/\b\d{1,2}[:.]\d{2}\b/.test(text);
    return {...output(clamp(plainText(text),900)+(unverified?'\n\nNote: this is not a checked itinerary yet. The times above have not been verified against travel, opening hours or your calendar.':'')),outcome:checked?'answer':'discussion'};
  };
  const cancelled=()=>output('Query stopped, completed results saved. Can click continue; calendar unchanged.','cancelled');
  saveCheckpoint(env.checkpoint());
  try{
    if(signal?.aborted)return cancelled();
    emit('model_start','Understanding and saving this round’s conditions.');
    turn=await interpretTurn({text:raw.text,history,context:env.context()},config,{fetchImpl:measuredFetch,timeout:Math.min(modelPolicy.initialTimeoutMs+modelPolicy.retryTimeoutMs,timeLimit-reserveMs),signal,retryBudget,policy:modelPolicy,onInterpretation:value=>audit('turn_interpretation',value),onAttempt:recordAttempt,onRetry:notifyRetry});
    const before=structuredClone(env.context().trip),priorAssumptions=[...env.assumptions];
    const saved=Object.keys(turn.patch).length||turn.assumptions.length?await commitTurn():null;
    const after=env.context().trip;
    committedFields=[...Object.keys(after).filter(k=>k!=='labels'&&!isDeepStrictEqual(before[k],after[k])),...(!isDeepStrictEqual(priorAssumptions,env.assumptions)?['assumptions']:[])];
    audit('turn_committed',{intent:turn.intent,patch:turn.patch,dropped:turn.dropped,rejected:turn.rejected,droppedWindows:turn.droppedWindows,sources:turn.sources,categories:turn.categories,before,after:env.context().trip});
    saveCheckpoint(env.checkpoint());
    messages[0].content+='\nThis turn has been interpreted and its patch actually saved: '+JSON.stringify(turn)+'\nAnything listed under dropped or rejected was NOT saved; if the user’s own words support it, record it with the update tools, otherwise carry on without it. trip.labels marks each saved fact as user (they said it) or assistant (assumed): you may revise assistant facts yourself, change user facts only when the user asks, and mention in a clause any assumption that shaped the answer.\nUse current authoritative state. For requested news/events, read each requested category with its tool (or report its actual failure) and cover every requested category in the reply. present_events only prepares selected cards; it does NOT end the turn. Only your plain-text reply or clarify ends the turn. Write the reply as 2–5 conversational sentences without markdown; the interface shows the timetable, costs and source cards. Concrete facts must come from observations. Ordinary category recommendations may use common knowledge with uncertainty about actual venues.';
    if(saved?.requiresUserInput)return {...output(saved.question,'needs_input'),outcome:'clarification'};
    // The interpretation already says which workflow this turn needs, so load
    // its skill here instead of spending a model round on load_skill.
    if(turn.categories.length)activate('local-discovery');
    if(['planning','update','clarification'].includes(turn.intent)||env.planningPending()||env.state.activities.length)activate('plan-outing');
  }catch(error){if(signal?.aborted)return cancelled();env.trace.push({label:'Saving round conditions.',status:'error',summary:error.message});const reason=error.code==='MODEL_OUTPUT_LIMIT'?'output_limit':'intake_error';return output((reason==='output_limit'?'Failed to fully save this round’s new conditions.':'')+env.fallback(reason),reason);}
  // Reserve time for a final explanation instead of spending every call on searches.
  const reserveTools=Math.min(2,Math.max(1,maxTools-1));
  for(;rounds<maxRounds;){
    if(signal?.aborted)return cancelled();
    rounds++;
    const remaining=timeLimit-(Date.now()-started);
    if(remaining<=0)break;
    const closing=rounds>=maxRounds-1||toolCount>=maxTools-reserveTools||remaining<=reserveMs;
    const available=closing?[clarification,...agentToolDefinitions.filter(t=>t.function.name==='present_events'&&enabled.has(t.function.name))]:[...controls,...(env.planningPending()?[pausePlanning]:[]),...agentToolDefinitions.filter(t=>enabled.has(t.function.name))];
    const budgetContext={role:'system',content:'Host execution budget: '+JSON.stringify({remainingRounds:maxRounds-rounds,remainingTools:maxTools-toolCount,remainingSeconds:Math.floor(remaining/1000)})+(closing?' Reply now in plain text using checked facts. Explain the actual blockers and one useful next decision. No more searches; do not claim unfinished work succeeded. A clarification is a valid turn outcome.':' Use progress in tool observations to handle prerequisites together; keep time for explaining results.')+'\nCurrent authoritative state: '+JSON.stringify(env.context())+'\nReply style, when you answer: at most four plain conversational sentences (about 80 words). No lists, headings, bold, tables or quoted source text, and do not recite the timetable: the interface shows times, costs and source cards. For events or news, at most three items, one sentence each. Mention an assumption that shaped the answer in a clause. Never ask for a leave time, return time or budget, and do not mention them unless the user gave them.'};
    let response;
    try{
      const requestMessages=[{...messages[0],content:messages[0].content+'\n'+budgetContext.content},...messages.slice(1)];
      emit('model_start','Understanding needs and deciding next step.',{round:rounds});
      response=await requestModel(config,{model:config.model,messages:requestMessages,tools:available,tool_choice:'auto',...actorSampling},{onContent:draft,fetchImpl:measuredFetch,deadline:started+timeLimit-(closing?1000:reserveMs),signal,retryBudget,policy:modelPolicy,onFirst:()=>emit('model_response','Model started responding, preparing operation.',{round:rounds}),onAttempt:recordAttempt,onRetry:notifyRetry});
      audit('model_response',{round:rounds,calls:response.tool_calls,contentChars:response.content?.length||0});
    }catch(error){if(signal?.aborted)return cancelled();env.trace.push({label:'Generating reply.',status:'error',summary:error.name==='TimeoutError'?'Model response timed out.':error.message});const reason=error.code==='MODEL_OUTPUT_LIMIT'?'output_limit':'service_error';return output(env.fallback(reason),reason);}
    // The model sometimes emits the same call twice in one response: run each
    // distinct call once. Text beside tool calls is protocol noise, not a reply.
    const calls=(response.tool_calls||[]).filter((c,i,all)=>all.findIndex(o=>o.function?.name===c.function?.name&&o.function?.arguments===c.function?.arguments)===i);
    if(!calls.length){
      const text=(response.content||'').trim(),blocker=text?replyBlocker(text,closing):'Answer the user in plain text, or call a tool. Do not claim external results without tool evidence.';
      if(!blocker)return deliver(text);
      emit('reply_retracted','Checking before replying.');audit('reply_held',{round:rounds,reason:blocker});
      if(text)env.trace.push({action:'reply',label:'Check before replying',status:'error',summary:blocker});
      if(text&&!/^\s*[<{\[]/.test(text))messages.push({role:'assistant',content:text});
      messages.push({role:'user',content:'[Host notice, not from the user] '+blocker});continue;
    }
    emit('reply_retracted','Working on it.');
    // Only retain observable tool calls/content; never log model reasoning fields.
    messages.push({role:'assistant',content:null,tool_calls:calls});
    const pendingSkills=[];
    for(const call of calls){
      if(toolCount>=maxTools||Date.now()-started>=timeLimit)return output(env.fallback('limit'),'limit');
      if(signal?.aborted)return cancelled();
      toolCount++;const name=call.function?.name;let result,args,actionError;const before=structuredClone(env.context().trip),toolStarted=Date.now();emit('tool_start',labels[name]||'Processing.',{action:name});
      try{
        const definition=available.find(t=>t.function.name===name);
        if(!definition)throw Error('This tool is not authorized; load the relevant skill。');
        args=JSON.parse(call.function.arguments);validateArguments(args,definition.function.parameters);
        const signature=env.revision+':'+name+JSON.stringify(args),count=(seen.get(signature)||0)+1;seen.set(signature,count);
        if(count>2)throw Error('Same call repeated twice; please change strategy based on result or end round.');
        if(name==='clarify'){
          if(['time','budget'].includes(args.field))throw Error('Leave time, return time and budget are optional and are never asked for. Plan without them: they limit the plan only when the user states them.');
          if(calls.length!==1)throw Error('Please handle other tool results before separate follow‑up.');
          // The same rule as for a reply: with the essentials recorded, plan first and ask afterwards.
          const held=replyBlocker(args.question,closing);if(held)throw Error(held);
          if(!args.question.trim())throw Error('Follow‑up cannot be empty.');
          const saved=await env.handlers.update_trip({patch:args.patch,assumptions:args.assumptions});
          env.requirePlan();
          if(!env.state.activities.length)throw Error('Before a planning clarification, use patch.activities to save all user-stated activities (open description, not limited to fixed categories), known dates and conditions; cannot store only a date then lose activities. For general chat or event discovery, reply in plain text instead.');
          if(saved.requiresUserInput)return {...output(saved.question,'needs_input'),outcome:'clarification'};
          if((args.field==='origin'&&env.state.origin)||(args.field==='date'&&env.state.date)||(args.field==='budget'&&env.state.budgetMode!=='unknown')||(args.field==='time'&&env.state.start&&env.state.deadline))throw Error('This condition is already recorded. Use it, or ask about a genuine trade-off with preference.');
          env.trace.push({action:name,input:args,label:labels[name],status:'ok',summary:'Applied this round’s condition update; budget status:'+env.state.budgetMode+'Awaiting supplementation.'});
          return {...output(args.question,'needs_input'),outcome:'clarification'};
        }
        if(name==='load_skill'){
          const skill=catalog.entries.find(s=>s.name===args.name);if(!skill)throw Error('Skill does not exist.');
          const fresh=!loaded.has(skill.name)&&!pendingSkills.includes(skill.name);
          if(fresh)pendingSkills.push(skill.name);
          result=fresh?{name:skill.name,instructions:skill.body,tools:skill.tools}:{name:skill.name,alreadyLoaded:true,tools:skill.tools,notice:'These instructions are already in context; continue with its tools.'};
        }else if(name==='pause_planning'){env.pausePlanning();result={paused:true,notice:'Requirement retained, planning not yet completed.'};}
        else result=await env.handlers[name](args);
        env.trace.push({action:name,input:args,label:labels[name]||name,status:'ok',summary:name==='load_skill'?args.name:name==='search_places'?`${args.query}：${result.candidates.length}results`:name==='plan_itinerary'?`${result.alternatives}sets of candidates`:name==='update_trip'?'Current round conditions updated':name==='calendar_changes'?'Only checking, not written in':'Results obtained'});
        if(result?.requiresUserInput)return {...output(result.question,'needs_input'),outcome:'clarification'};
      }catch(error){actionError=error.message;result={error:error.message,details:error.details,progress:env.readiness(),recoverable:true};env.trace.push({action:name,input:args,label:labels[name]||'Tool validation',status:'error',summary:error.message});}
      finally{const after=env.context().trip;audit('tool_result',{round:rounds,action:name,arguments:args??call.function?.arguments,before,after,changedFields:Object.keys(after).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])),error:actionError||null});}
      timings.push({stage:'tool',action:name,totalMs:Date.now()-toolStarted,status:result?.error?'error':'ok'});
      saveCheckpoint(env.checkpoint());emit(result?.error?'tool_error':'tool_done',labels[name]||'Processing step',{action:name,summary:result?.error?result.error:env.trace.at(-1)?.summary||'Completed'});
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
    }
    pendingSkills.forEach(activate);
  }
  return output(env.fallback('limit'),'limit');
}
