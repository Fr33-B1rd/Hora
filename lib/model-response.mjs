// Keep counts and provider usage, never retain or emit reasoning text.
export async function modelResponse(response,{onFirst=()=>{},onMetrics=()=>{},onContent=()=>{},maxContentChars=4000,maxArgumentChars=9000}={}){
 const metrics={finishReason:null,usage:null,contentChars:0,toolArgumentChars:0,reasoningChars:0,reasoningObserved:false,streamComplete:false};
 const usage=value=>{
  if(!value||typeof value!=='object')return;
  const number=n=>Number.isFinite(n)&&n>=0?n:null;
  metrics.usage={promptTokens:number(value.prompt_tokens),completionTokens:number(value.completion_tokens),totalTokens:number(value.total_tokens),reasoningTokens:number(value.completion_tokens_details?.reasoning_tokens),cachedPromptTokens:number(value.prompt_tokens_details?.cached_tokens)};
 };
 const count=value=>{
  if(typeof value.content==='string')metrics.contentChars+=value.content.length;
  for(const c of value.tool_calls||[])if(typeof c.function?.arguments==='string')metrics.toolArgumentChars+=c.function.arguments.length;
  for(const key of ['reasoning','reasoning_content'])if(typeof value[key]==='string'){metrics.reasoningObserved=true;metrics.reasoningChars+=value[key].length;}
 };
 const lengthError=()=>Object.assign(Error('model output reached length limit, no incomplete action performed.'),{code:'MODEL_OUTPUT_LIMIT'});
 try{
  if(!response.headers?.get('content-type')?.includes('text/event-stream')){
   const value=await response.json(),choice=value.choices?.[0],message=choice?.message;
   usage(value.usage);metrics.finishReason=choice?.finish_reason||null;metrics.streamComplete=true;
   if(message)count(message);onFirst();
   if(metrics.finishReason==='length')throw lengthError();
   if(!message)return undefined;
   return {role:'assistant',content:message.content??null,tool_calls:message.tool_calls};
  }
  const decoder=new TextDecoder(),calls=new Map();let pending='',content='',first=false,done=false,size=0;
  for await(const bytes of response.body){
   size+=bytes.length;if(size>2000000)throw Error('model response too large.');pending+=decoder.decode(bytes,{stream:true});
   let split;while((split=pending.indexOf('\n'))>=0){
    const line=pending.slice(0,split).trim();pending=pending.slice(split+1);if(!line.startsWith('data:'))continue;
    const text=line.slice(5).trim();if(text==='[DONE]'){done=true;continue;}if(!text)continue;
    const item=JSON.parse(text);usage(item.usage);const choice=item.choices?.[0];if(!choice)continue;
    if(!first){first=true;onFirst();}if(choice.finish_reason)metrics.finishReason=choice.finish_reason;
    const d=choice.delta||{};count(d);content+=d.content||'';if(d.content)onContent(content);
    // Every request here expects a compact tool call. Long prose or runaway
    // arguments never recover, so stop instead of streaming to the token cap.
    if(metrics.contentChars>maxContentChars||metrics.toolArgumentChars>maxArgumentChars){metrics.finishReason='length';metrics.stoppedEarly=true;throw lengthError();}
    for(const c of d.tool_calls||[]){const index=c.index??0,old=calls.get(index)||{id:'',type:'function',function:{name:'',arguments:''}};if(c.id)old.id=c.id;old.function.name+=c.function?.name||'';old.function.arguments+=c.function?.arguments||'';calls.set(index,old);}
   }
  }
  metrics.streamComplete=done&&!!metrics.finishReason;
  // Usage can follow the finish_reason chunk. Drain before reporting a limit,
  // without returning a partially generated tool invocation.
  if(metrics.finishReason==='length')throw lengthError();
  if(!metrics.streamComplete)throw Error('model response disconnected midway; no incomplete action performed.');
  return {role:'assistant',content:content||null,tool_calls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,c])=>c)};
 }finally{onMetrics(structuredClone(metrics));}
}
