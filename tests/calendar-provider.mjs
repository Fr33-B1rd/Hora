// Test-only process preload: a connected Google Calendar that lives in a file.
// No production hook, no real credentials, no network.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
if(process.env.DAYLIGHT_TEST_PROVIDERS!=='1')throw Error('Test preload requires explicit test environment');
const store=createStore(process.env.DAYLIGHT_DATA_DIR);store.tokens({access_token:'test-only',expiresAt:Date.now()+3600000});store.close();
const file=join(process.env.DAYLIGHT_DATA_DIR,'provider.json');if(!existsSync(file))writeFileSync(file,JSON.stringify({events:{},writes:0}));
const ok=x=>({ok:true,json:async()=>x});
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),body=opts.body?JSON.parse(opts.body):null;
  if(u.hostname==='www.googleapis.com'&&u.pathname.startsWith('/calendar/v3/')){
    const state=JSON.parse(readFileSync(file,'utf8')),method=opts.method||'GET',id=u.pathname.split('/').at(-1);
    if(method==='GET')return ok(u.searchParams.has('timeMin')?{items:Object.values(state.events)}:state.events[id]);
    if(method==='POST'&&state.events[body.id])return {ok:false,status:409};
    if(method==='PUT'&&opts.headers['If-Match']!==state.events[id]?.etag)return {ok:false,status:412};
    state.writes++;state.events[body.id]={...body,etag:String(state.writes),htmlLink:'https://calendar.google.com/calendar/event?eid='+body.id};writeFileSync(file,JSON.stringify(state));return ok(state.events[body.id]);
  }
  throw Error('Unexpected network request in isolated test');
};
