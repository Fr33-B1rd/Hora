import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {latestDigest,deliveredText,digestTools,digestHandlers} from '../mcp/digest-tools.mjs';

const digest='Research feed · 2026-10-14\n\nRetrieval-augmented generation — new benchmarks.\n1. RAG-Stress — Shunyuan Zhou et al. (2026-10-08)\n   https://arxiv.org/abs/2610.11183';
const run=response=>`# Cron Job: daylight-research-feed\n\n**Job ID:** r1\n\n## Prompt\n\nlong prompt with ## headings inside\n\n## Script Output\n\n{"wakeAgent": true}\n\n## Response\n\n${response}\n`;
async function home(runs={},jobs=[{id:'r1',name:'daylight-research-feed'},{id:'g1',name:'daylight-grocery-deals'}]){
  const dir=await mkdtemp(join(tmpdir(),'daylight-digest-'));
  await mkdir(join(dir,'cron','output','r1'),{recursive:true});
  await writeFile(join(dir,'cron','jobs.json'),JSON.stringify({jobs}));
  for(const [name,text] of Object.entries(runs))await writeFile(join(dir,'cron','output','r1',name),text);
  return dir;
}

test('the tool is declared with a handler and a closed input',()=>{
  assert.deepEqual(digestTools.map(t=>t.name),Object.keys(digestHandlers));assert.equal(digestTools[0].inputSchema.additionalProperties,false);
});

test('only the delivered message is taken from a saved run, not the prompt that produced it',()=>{
  assert.equal(deliveredText(run(digest)),digest);
  assert.equal(deliveredText('# Cron Job\n\n## Prompt\n\nno answer yet'),null);
  assert.equal(deliveredText(run('')),null);
});

test('today’s digest is handed back word for word, with instructions not to change it',async()=>{
  const dir=await home({'2026-10-13_08-00-41.md':run('older digest'),'2026-10-14_08-00-37.md':run(digest)});
  try{
    const r=await latestDigest({digest:'research'},{home:dir,today:'2026-10-14'});
    assert.equal(r.status,'found');assert.equal(r.text,digest);assert.equal(r.today,true);assert.equal(r.at,'08:00');
    assert.match(r.howToAnswer.join(' '),/exactly as it is/);assert.match(r.howToAnswer.join(' '),/keep every link/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('when the latest runs found nothing, the last real digest is given with its date and the quiet days are said',async()=>{
  const dir=await home({'2026-10-12_08-00-10.md':run(digest),'2026-10-13_08-00-12.md':run('[SILENT]'),'2026-10-14_08-00-09.md':run('[SILENT]')});
  try{
    const r=await latestDigest({digest:'research'},{home:dir,today:'2026-10-14'});
    assert.equal(r.deliveredOn,'2026-10-12');assert.equal(r.today,false);assert.equal(r.nothingNewSince,'2026-10-14');
    assert.match(r.howToAnswer.join(' '),/from 2026-10-12, and that the runs since then found nothing new/);
  }finally{await rm(dir,{recursive:true,force:true});}
  const quiet=await home({'2026-10-14_08-00-09.md':run('[SILENT]')});
  try{const r=await latestDigest({digest:'research'},{home:quiet,today:'2026-10-14'});assert.equal(r.status,'none_yet');assert.match(r.howToAnswer.join(' '),/found nothing new/);}
  finally{await rm(quiet,{recursive:true,force:true});}
});

test('a digest that has never run, or is not set up, is said plainly',async()=>{
  const dir=await home();
  try{
    assert.equal((await latestDigest({digest:'groceries'},{home:dir,today:'2026-10-14'})).status,'none_yet');
    assert.equal((await latestDigest({digest:'jobs'},{home:dir,today:'2026-10-14'})).status,'no_such_job');
    await assert.rejects(latestDigest({digest:'news'},{home:dir}),/research, groceries or jobs/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
