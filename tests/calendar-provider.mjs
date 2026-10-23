// Test-only process preload: a connected Google Calendar that lives in a file.
// No production hook, no real credentials, no network. With DAYLIGHT_TEST_PASSTHROUGH=1
// only the calendar is replaced and every other request goes out as usual, which is how
// the evaluation set runs real conversations without touching anyone's real calendar.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
if(process.env.DAYLIGHT_TEST_PROVIDERS!=='1')throw Error('Test preload requires explicit test environment');
const store=createStore(process.env.DAYLIGHT_DATA_DIR);store.tokens({access_token:'test-only',expiresAt:Date.now()+3600000});store.close();
const file=join(process.env.DAYLIGHT_DATA_DIR,'provider.json');if(!existsSync(file))writeFileSync(file,JSON.stringify({events:{},writes:0}));
const ok=x=>({ok:true,status:200,json:async()=>x});
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url);
  if(u.hostname==='www.googleapis.com'&&u.pathname.startsWith('/calendar/v3/')){
    const body=opts.body?JSON.parse(opts.body):null,state=JSON.parse(readFileSync(file,'utf8')),method=opts.method||'GET',id=u.pathname.split('/').at(-1);
    if(method==='GET'&&u.searchParams.has('timeMin')){  // a day's listing: only events overlapping it, as Google returns
      const from=Date.parse(u.searchParams.get('timeMin')),to=Date.parse(u.searchParams.get('timeMax')||'9999-12-31T00:00:00Z');
      const at=t=>Date.parse(t?.dateTime||t?.date);
      return ok({items:Object.values(state.events).filter(e=>at(e.start)<to&&at(e.end)>from)});
    }
    if(method==='GET')return ok(state.events[id]);
    if(method==='POST'&&state.events[body.id])return {ok:false,status:409};
    if(method==='PUT'&&opts.headers['If-Match']!==state.events[id]?.etag)return {ok:false,status:412};
    state.writes++;state.events[body.id]={...body,etag:String(state.writes),htmlLink:'https://calendar.google.com/calendar/event?eid='+body.id};writeFileSync(file,JSON.stringify(state));return ok(state.events[body.id]);
  }
  if(process.env.DAYLIGHT_TEST_PASSTHROUGH==='1')return realFetch(url,opts);
  throw Error('Unexpected network request in isolated test');
};
