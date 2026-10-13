import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {todo,findItem,todoTools,todoHandlers} from '../mcp/todo-tools.mjs';

const fresh=async()=>{const dir=await mkdtemp(join(tmpdir(),'daylight-todo-'));return {file:join(dir,'daylight','todos.json'),today:'2026-10-13',dir};};

test('the to-do tool has a handler and closed inputs',()=>{
  assert.deepEqual(todoTools.map(t=>t.name),Object.keys(todoHandlers));assert.equal(todoTools[0].inputSchema.additionalProperties,false);
});

test('a group shares one list: items are numbered, attributed, ticked off by name and kept between calls',async()=>{
  const at=await fresh();
  try{
    const a=await todo({action:'add',list:'Flat 4B',text:'  Book the  movers ',by:'Anna',due:'2026-10-20'},at);
    assert.equal(a.status,'added');assert.deepEqual(a.item,{number:1,task:'Book the movers',addedBy:'Anna',due:'2026-10-20'});
    await todo({action:'add',list:'flat 4b',text:'Cancel the internet',by:'Ben'},at);
    assert.equal((await todo({action:'add',list:'FLAT 4B',text:'book the movers',by:'Ben'},at)).status,'already_on_the_list');
    const shown=await todo({action:'show',list:'Flat 4B'},at);
    assert.deepEqual(shown.open.map(i=>[i.number,i.task,i.addedBy]),[[1,'Book the movers','Anna'],[2,'Cancel the internet','Ben']]);
    const done=await todo({action:'done',list:'Flat 4B',item:'movers',by:'Ben'},at);
    assert.equal(done.status,'marked_done');assert.deepEqual(done.item,{number:1,task:'Book the movers',addedBy:'Anna',due:'2026-10-20',doneBy:'Ben',doneOn:'2026-10-13'});assert.equal(done.openCount,1);
    const after=await todo({action:'show',list:'Flat 4B'},at);assert.deepEqual(after.open.map(i=>i.number),[2]);assert.equal(after.recentlyDone[0].doneBy,'Ben');
    assert.equal((await todo({action:'done',list:'Flat 4B',item:'1'},at)).status,'no_such_item');          // already done
    assert.equal((await todo({action:'reopen',list:'Flat 4B',item:'#1'},at)).status,'reopened');
    assert.equal((await todo({action:'remove',list:'Flat 4B',item:'2'},at)).status,'removed');
    assert.deepEqual((await todo({action:'show',list:'Flat 4B'},at)).open.map(i=>i.number),[1]);
    // Another list is separate, and its numbers continue rather than restart, so a number never means two things.
    assert.equal((await todo({action:'add',list:'me',text:'Renew passport'},at)).item.number,3);
    assert.deepEqual((await todo({action:'show',list:'me'},at)).open.map(i=>i.task),['Renew passport']);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(at.file,'utf8')).lists).sort(),['flat 4b','me']);
  }finally{await rm(at.dir,{recursive:true,force:true});}
});

test('an unclear reference is never guessed, an overdue item is pointed out, and bad input is refused',async()=>{
  const at=await fresh();
  try{
    await todo({action:'add',list:'me',text:'Call the bank',due:'2026-10-10'},at);await todo({action:'add',list:'me',text:'Call the dentist'},at);
    const unclear=await todo({action:'done',list:'me',item:'call'},at);
    assert.equal(unclear.status,'several_match');assert.deepEqual(unclear.matching.map(i=>i.number),[1,2]);assert.match(unclear.howToAnswer.join(' '),/which of the matching/);
    assert.equal((await todo({action:'done',list:'me',item:'groceries'},at)).status,'no_such_item');
    assert.match((await todo({action:'show',list:'me'},at)).howToAnswer.join(' '),/1 item is past due/);
    assert.match((await todo({action:'show',list:'empty one'},at)).howToAnswer.join(' '),/nothing is open/i);
    await assert.rejects(todo({action:'add',list:'me',text:' '},at),/what the task is/);
    await assert.rejects(todo({action:'add',list:'me',text:'x',due:'Friday'},at),/Invalid date/);
    await assert.rejects(todo({action:'add',list:' ',text:'x'},at),/which list/);
    await assert.rejects(todo({action:'archive',list:'me'},at),/action must be/);
    assert.deepEqual(findItem([{id:12,text:'Buy 2 lamps'}],'2').map(i=>i.id),[12]);   // not a number on the list, so read as words
  }finally{await rm(at.dir,{recursive:true,force:true});}
});
