// Bridge from the web app to the Hermes agent's local API: the same assistant,
// memory and skills as the chat apps. The API key stays on the server; the
// browser only ever talks to this origin.
const sessionPattern=/^[A-Za-z0-9_-]{8,64}$/;
export const hermesConfig=(env=process.env)=>({url:(env.HERMES_API_URL||'http://127.0.0.1:8642').replace(/\/$/,''),key:env.HERMES_API_KEY||''});

export async function hermesStatus(config,{fetchImpl=fetch}={}){
  if(!config.key)return {configured:false,reachable:false};
  try{const r=await fetchImpl(config.url+'/health',{signal:AbortSignal.timeout(4000)});const body=r.ok?await r.json():{};return {configured:true,reachable:r.ok,version:body.version||null};}
  catch{return {configured:true,reachable:false};}
}

// Streams the assistant's reply to `res` as server-sent events, unchanged:
// text chunks, plus `hermes.tool.progress` events for what it is doing.
export async function streamAssistant(input,res,config,{fetchImpl=fetch,signal}={}){
  const text=typeof input?.text==='string'?input.text.trim():'';
  if(!text||text.length>4000)throw Object.assign(Error('Please enter 1–4000 characters.'),{status:400});
  if(!sessionPattern.test(input.session||''))throw Object.assign(Error('Invalid conversation id.'),{status:400});
  if(!config.key)throw Object.assign(Error('The assistant is not configured on this server.'),{status:503});
  let upstream;
  try{
    upstream=await fetchImpl(config.url+'/v1/chat/completions',{method:'POST',signal,
      headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json','X-Hermes-Session-Id':'web-'+input.session},
      body:JSON.stringify({model:'hermes-agent',stream:true,messages:[{role:'user',content:text}]})});
  }catch{throw Object.assign(Error('The assistant is not running. Start the Hermes gateway and try again.'),{status:502});}
  if(!upstream.ok)throw Object.assign(Error(upstream.status===401?'The assistant rejected this server’s key.':'The assistant could not take the request ('+upstream.status+').'),{status:502});
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
  for await(const chunk of upstream.body)res.write(chunk);
  res.end();
}
