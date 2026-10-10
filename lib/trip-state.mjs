import {activityDefinitions,precedenceRules,budgetState} from './activities.mjs';
import {validDate,minute} from './time.mjs';
const keys=['labels','date','origin','budget','budgetMode','activityDefinitions','precedence','start','deadline','timeMode','activities','transport','lowWalking','maxWalking','choiceGroups'];
export function activeActivities(s){const optional=new Set((s.choiceGroups||[]).flatMap(g=>g.options));const selected=new Set((s.choiceGroups||[]).map(g=>g.selected).filter(Boolean));return s.activities.filter(id=>!optional.has(id)||selected.has(id));}
export function conversationSlots(raw={}, {defaultFlexibleWindow=true}={}){
  const s={date:null,origin:null,budget:null,budgetMode:'unknown',activityDefinitions:{},precedence:[],start:null,deadline:null,timeMode:'unknown',activities:[],transport:'transit',lowWalking:false,maxWalking:null,choiceGroups:[],labels:{}};
  for(const k of keys)if(raw[k]!==undefined)s[k]=raw[k];
  Object.assign(s,budgetState(raw,{conversation:true}));
  if(!['unknown','fixed','flexible'].includes(s.timeMode))throw Error('Invalid time preference.');
  // labels: fact → 'user' (they said it) or 'assistant' (it was assumed).
  s.labels=Object.fromEntries(Object.entries(s.labels&&typeof s.labels==='object'?s.labels:{}).filter(([k,v])=>k.length<=80&&['user','assistant'].includes(v)).slice(0,60));
  if(defaultFlexibleWindow&&s.timeMode==='flexible'){s.start??='10:00';s.deadline??='20:00';}
  if(s.date!==null)validDate(s.date);
  if(s.origin!==null&&(typeof s.origin!=='string'||!s.origin.trim()||s.origin.length>200))throw Error('Invalid departure point.');
  for(const [k,max] of [['maxWalking',180]])if(s[k]!==null&&(!Number.isFinite(s[k])||s[k]<0||s[k]>max))throw Error('Invalid budget or walking limit.');
  for(const k of ['start','deadline'])if(s[k]!==null){if(typeof s[k]!=='string'||!/^\d\d:\d\d$/.test(s[k]))throw Error('Invalid time format.');minute(s[k]);}
  const definitions=activityDefinitions(s.activities,s.activityDefinitions);s.activities=definitions.map(a=>a.id);s.activityDefinitions=Object.fromEntries(definitions.map(a=>[a.id,a]));
  s.precedence=precedenceRules(s.precedence,s.activities);
  if(!Array.isArray(s.choiceGroups)||s.choiceGroups.length>3)throw Error('Invalid alternative group.');
  const members=new Set(),groupIds=new Set();
  for(const g of s.choiceGroups){
    if(!g||typeof g.id!=='string'||!g.id||groupIds.has(g.id)||!Array.isArray(g.options)||g.options.length<2||g.options.length>6||g.options.some(id=>!s.activities.includes(id)||members.has(id))||new Set(g.options).size!==g.options.length)throw Error('Alternative groups must contain non‑duplicate existing activities.');
    if(g.selected!==null&&!g.options.includes(g.selected))throw Error('Selection must belong to the corresponding alternative group.');
    if(!['pending','user','assistant'].includes(g.selectionBy)||(g.selected===null)!==(g.selectionBy==='pending'))throw Error('Invalid alternative selection source.');
    if(typeof g.userQuote!=='string'||!g.userQuote.trim()||g.userQuote.length>500||typeof g.reason!=='string'||g.reason.length>500||typeof g.delegationQuote!=='string'||g.delegationQuote.length>500)throw Error('Alternative group lacks a valid source or justification.');
    if(g.selectionBy==='assistant'&&!g.reason.trim())throw Error('Assistant provisional selection requires an explanation.');
    groupIds.add(g.id);g.options.forEach(id=>members.add(id));
  }
  if(!['walk','transit'].includes(s.transport)||typeof s.lowWalking!=='boolean')throw Error('Invalid travel preference.');
  return s;
}
