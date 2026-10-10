import {mkdirSync,readdirSync,statSync,unlinkSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Local, bounded diagnostics. No headers, credentials or hidden model reasoning.
export function createAgentDiagnostic(directory,{maxFiles=20,maxBytes=4*1024*1024,maxAge=86400000}={}){
 mkdirSync(directory,{recursive:true});
 const files=readdirSync(directory).filter(n=>/^agent-[0-9a-f-]+\.jsonl$/.test(n)).map(name=>({name,time:statSync(join(directory,name)).mtimeMs})).sort((a,b)=>b.time-a.time);
 for(const [i,file] of files.entries())if(i>=maxFiles-1||Date.now()-file.time>maxAge)unlinkSync(join(directory,file.name));
 const id=randomUUID(),path=join(directory,`agent-${id}.jsonl`);let size=0,capped=false;
 const write=event=>{if(capped)return;let line=JSON.stringify(event)+'\n';if(size+Buffer.byteLength(line)>maxBytes-128){line=JSON.stringify({kind:'diagnostic_limit',message:'Log size limit reached; later evidence was not recorded.'})+'\n';capped=true;}appendFileSync(path,line,{encoding:'utf8',mode:0o600});size+=Buffer.byteLength(line);};
 write({kind:'diagnostic_start',id,createdAt:new Date().toISOString()});
 return {id,write};
}
