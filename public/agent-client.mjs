// A disconnect does not replay an action. Reattach to the same server task.
export function createAgentClient({fetcher=fetch,storage=globalThis.sessionStorage,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}}={}){
 const key='daylight-active-run-en-v1';let active=null;
 const store=id=>{active=id;try{if(id)storage?.setItem(key,id);else storage?.removeItem(key);}catch{}};
 const request=async(path,data)=>{const r=await fetcher(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await r.json();if(!r.ok){const e=Error(value.error||'Query service temporarily unavailable.');e.status=r.status;throw e;}return value;};
 async function watch(id){let after=0,failures=0;store(id);
  for(;;){let r;try{r=await request('/api/agent/run?id='+encodeURIComponent(id)+'&after='+after);failures=0;}catch(e){if(e.status===400||e.status===404){store(null);throw e;}if(++failures<=3){onProgress({phase:'connection',label:'Connection temporarily interrupted, restoring same query'});await sleep(1000);continue;}throw Error(e.message+' Query number retained, refresh to reconnect.');}
   for(const e of r.events){after=Math.max(after,e.seq);onProgress(e);}
   if(r.status==='done'){store(null);return r.result;}await sleep(250);
  }
 }
 return {get pending(){try{return active||storage?.getItem(key);}catch{return active;}},async run(raw){if(this.pending)return watch(this.pending);const {id}=await request('/api/agent/run',raw);return watch(id);},async cancel(){if(this.pending){onProgress({phase:'stopping',label:'Stopping; progress retained after current query ends.'});await request('/api/agent/cancel',{id:this.pending});}},reattach(){return this.pending?watch(this.pending):null;},forget(){store(null);}};
}
