import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentDiagnostic} from '../lib/agent-diagnostics.mjs';
test('local diagnostic receipts bound file count and size and leave unrelated files alone',()=>{
 const dir=mkdtempSync(join(tmpdir(),'daylight-diagnostics-'));
 try{
  writeFileSync(join(dir,'keep.txt'),'untouched');
  const a=createAgentDiagnostic(dir,{maxFiles:2,maxBytes:300});a.write({kind:'test',value:'x'.repeat(500)});a.write({kind:'later'});
  const content=readFileSync(join(dir,`agent-${a.id}.jsonl`),'utf8');assert.match(content,/diagnostic_limit/);assert.doesNotMatch(content,/"kind":"later"/);
  createAgentDiagnostic(dir,{maxFiles:2});createAgentDiagnostic(dir,{maxFiles:2});
  assert.equal(readdirSync(dir).filter(n=>n.endsWith('.jsonl')).length,2);assert.equal(readFileSync(join(dir,'keep.txt'),'utf8'),'untouched');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
