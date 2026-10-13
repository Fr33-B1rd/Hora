// Shared to-do lists, for one person or for a group chat. A list is only a
// name; in a group the assistant uses the group's own name, so everyone there
// adds to and ticks off the same list, and each change records who made it.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {validDate,dateInStockholm} from '../lib/time.mjs';

const plain='Plain text for a chat app: no markdown, no bold, no headings, no tables.';
const MAX_OPEN=60,KEEP_DONE=30;
export const todoFile=()=>join(process.env.HERMES_HOME||join(homedir(),'.hermes'),'daylight','todos.json');
export const todoTools=[
  {name:'todo',description:'A to-do list that is kept between conversations: add an item, show the list, mark an item done, reopen or remove one. Use it whenever someone asks to note a task, asks what is left to do, or says something on the list is finished. In a group chat every member shares one list: pass the group’s name as list, and who is speaking as by. In a private chat use the list “me”.',inputSchema:{type:'object',additionalProperties:false,required:['action','list'],properties:{
    action:{type:'string',enum:['add','show','done','reopen','remove']},
    list:{type:'string',maxLength:60,description:'“me” in a private chat; in a group, the group’s name'},
    text:{type:'string',maxLength:200,description:'For add: the task, in the words of whoever asked'},
    item:{type:'string',maxLength:200,description:'For done, reopen, remove: the item’s number from the list, or a few words of its text'},
    by:{type:'string',maxLength:60,description:'Who asked, by the name shown in the chat'},
    due:{type:'string',description:'For add: a date it is due, YYYY-MM-DD, only if one was given'}}}},
];

const listKey=name=>String(name||'').trim().toLowerCase().replace(/\s+/g,' ').slice(0,60);
async function load(file){try{const state=JSON.parse(await readFile(file,'utf8'));return {lists:{},...state};}catch(error){if(error.code==='ENOENT')return {lists:{}};throw error;}}
async function save(file,state){await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(state,null,1),'utf8');await rename(file+'.tmp',file);}
const shown=item=>({number:item.id,task:item.text,...(item.by?{addedBy:item.by}:{}),...(item.due?{due:item.due}:{}),...(item.done?{doneBy:item.done.by||'someone',doneOn:item.done.on}:{})});
// The one item meant by a number or by a few words of its text; several or none is for the caller to resolve.
export function findItem(items,wanted){
  const q=String(wanted||'').trim().toLowerCase().replace(/^#/,'');if(!q)return [];
  if(/^\d+$/.test(q)){const byNumber=items.filter(i=>String(i.id)===q);if(byNumber.length)return byNumber;}
  const words=q.split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>1||/\d/.test(w));
  return words.length?items.filter(i=>words.every(w=>i.text.toLowerCase().includes(w))):[];
}

export async function todo({action,list,text,item,by,due},{file=todoFile(),today=dateInStockholm()}={}){
  const key=listKey(list);if(!key)throw Error('Say which list: “me”, or the group’s name.');
  const state=await load(file),items=state.lists[key]||=[],who=String(by||'').trim().slice(0,60)||null;
  const view=()=>{const open=items.filter(i=>!i.done),done=items.filter(i=>i.done);return {list:key,open:open.map(shown),recentlyDone:done.slice(-5).map(shown)};};
  if(action==='show'){
    const v=view(),overdue=v.open.filter(i=>i.due&&i.due<today).length;
    return {...v,howToAnswer:[plain,v.open.length?'List the open items, one per line: number, task, who added it, and the due date if any.':'Say nothing is open on this list.',overdue?`${overdue} item${overdue>1?'s are':' is'} past due: say which.`:null,v.recentlyDone.length&&!v.open.length?'You may mention the last thing that was finished.':null].filter(Boolean)};
  }
  if(action==='add'){
    const task=String(text||'').replace(/\s+/g,' ').trim();if(!task)throw Error('Say what the task is.');
    if(due)validDate(due);
    if(items.filter(i=>!i.done).length>=MAX_OPEN)throw Error('This list already has '+MAX_OPEN+' open items. Finish or remove some first.');
    const same=items.find(i=>!i.done&&i.text.toLowerCase()===task.toLowerCase());
    if(same)return {status:'already_on_the_list',item:shown(same),...view(),howToAnswer:[plain,'Say it is already on the list, with its number.']};
    const added={id:(state.next=(state.next||0)+1),text:task.slice(0,200),by:who,added:today,due:due||null,done:null};items.push(added);
    await save(file,state);
    return {status:'added',item:shown(added),openCount:items.filter(i=>!i.done).length,howToAnswer:[plain,'Confirm in one sentence, with the item’s number.']};
  }
  if(!['done','reopen','remove'].includes(action))throw Error('action must be add, show, done, reopen or remove.');
  const pool=action==='reopen'?items.filter(i=>i.done):action==='done'?items.filter(i=>!i.done):items,found=findItem(pool,item);
  if(found.length!==1)return {status:found.length?'several_match':'no_such_item',matching:found.map(shown),...view(),howToAnswer:[plain,found.length?'Ask which of the matching items they mean, giving the numbers.':'Say there is no such item on this list, and show what is open.']};
  const target=found[0];
  if(action==='done')target.done={by:who,on:today};
  else if(action==='reopen')target.done=null;
  else items.splice(items.indexOf(target),1);
  const finished=items.filter(i=>i.done);if(finished.length>KEEP_DONE)for(const old of finished.slice(0,finished.length-KEEP_DONE))items.splice(items.indexOf(old),1);
  await save(file,state);
  return {status:action==='done'?'marked_done':action==='reopen'?'reopened':'removed',item:shown(target),openCount:items.filter(i=>!i.done).length,
    howToAnswer:[plain,'Confirm in one sentence, and say how many items are still open.']};
}

export const todoHandlers={todo:args=>todo(args)};
