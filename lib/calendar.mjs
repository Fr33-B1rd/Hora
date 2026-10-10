import { calendarEvidence } from './verification.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { dayBounds, instant, minute, localParts, intersects, ZONE } from './time.mjs';
const scope='https://www.googleapis.com/auth/calendar.events.owned';
export function eventId(date,kind){return 'da1'+createHash('sha256').update(date+':'+kind).digest('hex').slice(0,40);}
export function createCalendar(config,store,fetchImpl=fetch) {
  const sessions=new Map();let refreshing;
  const configured=!!(config.clientId&&config.clientSecret);
  async function exchange(body){const r=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirect})});if(!r.ok)throw new Error(`Google Authorization failed (${r.status}), please reconnect your account.`);return r.json();}
  async function token(){const t=store.tokens();if(!t)throw new Error('Please connect first Google Calendar。');if(t.expiresAt>Date.now()+60000)return t.access_token;if(!t.refresh_token)throw new Error('Google Authorization has expired, please reconnect.');if(!refreshing)refreshing=exchange({grant_type:'refresh_token',refresh_token:t.refresh_token}).then(n=>{store.tokens({...t,...n,expiresAt:Date.now()+n.expires_in*1000});return n.access_token;}).finally(()=>refreshing=null);return refreshing;}
  async function api(path,method='GET',body){const r=await fetchImpl('https://www.googleapis.com/calendar/v3'+path,{method,signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const e=new Error(`Google Calendar Returned ${r.status}. Please check authorization or try again later.`);e.status=r.status;throw e;}return r.status===204?{}:r.json();}
  const apiRoot='/calendars/primary/events';
  return {
    status:()=>({configured,connected:!!store.tokens()}),
    begin(){if(!configured)throw new Error('Please fill in first GOOGLE_CLIENT_ID  and  GOOGLE_CLIENT_SECRET。');for(const [k,v] of sessions)if(v.expires<Date.now())sessions.delete(k);const state=randomBytes(24).toString('hex'),verifier=randomBytes(48).toString('base64url');sessions.set(state,{verifier,expires:Date.now()+600000});const q=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirect,response_type:'code',scope,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});return {state,url:'https://accounts.google.com/o/oauth2/v2/auth?'+q};},
    async callback(code,state,cookie){const session=sessions.get(state);sessions.delete(state);if(!session||session.expires<Date.now()||cookie!==state||!code)throw new Error('Authorization session has expired or does not match, please reconnect.');const t=await exchange({grant_type:'authorization_code',code,code_verifier:session.verifier});if(t.scope&&!t.scope.split(' ').includes(scope))throw new Error('Required calendar permissions not granted.');store.tokens({...t,expiresAt:Date.now()+t.expires_in*1000});return true;},
    disconnect(){store.tokens(null);},
    async day(date){const bounds=dayBounds(date),items=[];let pageToken;
      do{const q=new URLSearchParams({...bounds,singleEvents:'true',maxResults:'2500',...(pageToken?{pageToken}:{})});const r=await api(apiRoot+'?'+q);items.push(...(r.items||[]));pageToken=r.nextPageToken;if(items.length>10000)throw new Error('Too many events today to safely check.');}while(pageToken);
      const own=[],busy=[];
      for(const e of items){if(e.status==='cancelled'||e.transparency==='transparent'||e.attendees?.some(a=>a.self&&a.responseStatus==='declined'))continue;const start=e.start?.dateTime||(e.start?.date?instant(e.start.date,0):null),end=e.end?.dateTime||(e.end?.date?instant(e.end.date,0):null);if(!start||!end)continue;
        const p=e.extendedProperties?.private;
        if(p?.daylight==='v1'&&e.id===eventId(date,p.kind)){own.push({id:e.id,kind:p.kind,placeId:p.placeId,locked:p.locked==='1',tentative:p.tentative==='1',start,end,etag:e.etag,url:e.htmlLink});}else busy.push({start,end});
      }
      return {date,...bounds,busy,own,checkedAt:new Date().toISOString()};
    },
    locks(day){return day.own.filter(e=>e.locked&&e.kind!=='meeting').map(e=>{const p=localParts(Date.parse(e.start));return {kind:e.kind,placeId:e.placeId,start:Number(p.hour)*60+Number(p.minute),duration:(Date.parse(e.end)-Date.parse(e.start))/60000};});},
    async write(date,stops,expected,proposalId,preservedKinds=[]){
      const fresh=await this.day(date),success=[];
      // A timed-out request may already have committed. Reconcile only this proposal's
      // previously persisted intent and exact target fields before treating it as successful.
      for(const curr of fresh.own){const pending=store.get('pending:'+curr.id),s=stops.find(s=>eventId(date,s.kind)===curr.id);if(pending?.proposalId===proposalId&&s&&curr.placeId===(s.placeId||'')&&Date.parse(curr.start)===Date.parse(instant(date,s.start))&&Date.parse(curr.end)===Date.parse(instant(date,s.end))&&curr.locked===!!s.locked){store.put('event:'+curr.id,{proposalId,etag:curr.etag,id:curr.id});store.remove('pending:'+curr.id);}}
      for(const prev of expected.own){const curr=fresh.own.find(e=>e.id===prev.id),saved=store.get('event:'+prev.id);if(!curr||curr.etag!==prev.etag){if(!(curr&&saved?.proposalId===proposalId&&saved.etag===curr.etag))throw new Error('Activities in the calendar after preview have been modified; please preview again.');}}
      for(const e of fresh.own)if(!expected.own.some(p=>p.id===e.id)&&store.get('event:'+e.id)?.proposalId!==proposalId)throw new Error('New arrangements added after preview; please preview again.');
      for(const e of fresh.own)if(!stops.some(s=>s.kind===e.kind)&&!preservedKinds.includes(e.kind))throw new Error('An existing activity is missing from the new plan. Resolve it in  Google Calendar Preview again after handling.');
      for(let i=0;i<stops.length;i++)for(let j=i+1;j<stops.length;j++)if(stops[i].start<stops[j].end&&stops[j].start<stops[i].end)throw Error('Pending personal activity conflicts with meeting; please replan.');
      const events=stops.map(s=>({id:eventId(date,s.kind),summary:`Daylight${s.tentative?' · Tentative':''} · ${s.label||{hair:'Haircut',ramen:'Ramen',movie:'Movie',meeting:'Meeting'}[s.kind]||'Personal activity'}`,description:calendarEvidence(s),...(s.placeId?{location:'https://www.google.com/maps/search/?api=1&query=Stockholm&query_place_id='+encodeURIComponent(s.placeId)}:{}),start:{dateTime:instant(date,s.start),timeZone:ZONE},end:{dateTime:instant(date,s.end),timeZone:ZONE},extendedProperties:{private:{daylight:'v1',kind:s.kind,label:s.label||'',placeId:s.placeId||'',locked:s.locked?'1':'0',tentative:s.tentative?'1':'0'}},reminders:{useDefault:false,overrides:[{method:'popup',minutes:10}]}}));
      if(events.some(e=>[...fresh.busy,...fresh.own.filter(x=>preservedKinds.includes(x.kind))].some(b=>intersects({start:e.start.dateTime,end:e.end.dateTime},b))))throw new Error('New conflict appeared in calendar; please refresh and replan.');
      for(const e of events){const c=fresh.own.find(o=>o.id===e.id);if(c?.locked&&(Date.parse(c.start)!==Date.parse(e.start.dateTime)||Date.parse(c.end)!==Date.parse(e.end.dateTime)||c.placeId!==e.extendedProperties.private.placeId))throw new Error('Cannot modify locked activity.');}
      for(const e of events){
        const current=fresh.own.find(o=>o.id===e.id),saved=store.get('event:'+e.id);
        if(current&&saved?.proposalId===proposalId&&saved.etag===current.etag){success.push({id:current.id,url:current.url});continue;}
        // Persist the intended stable id before the request, so an ambiguous response can be recovered.
        store.put('pending:'+e.id,{proposalId,id:e.id});
        try{
          let result;
          if(current){const r=await fetchImpl('https://www.googleapis.com/calendar/v3'+apiRoot+'/'+e.id+'?sendUpdates=none',{method:'PUT',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json','If-Match':current.etag},body:JSON.stringify(e)});if(!r.ok)throw new Error(`Update failed (${r.status}); please preview again`);result=await r.json();}
          else {try{result=await api(apiRoot+'?sendUpdates=none','POST',e);}catch(error){if(error.status!==409)throw error;result=await api(apiRoot+'/'+e.id);if(result.extendedProperties?.private?.daylight!=='v1'||Date.parse(result.start?.dateTime)!==Date.parse(e.start.dateTime)||Date.parse(result.end?.dateTime)!==Date.parse(e.end.dateTime)||result.extendedProperties?.private?.placeId!==e.extendedProperties.private.placeId)throw new Error('The event number already has a different arrangement, please preview again.');}}
          store.put('event:'+e.id,{proposalId,etag:result.etag,id:e.id});store.remove('pending:'+e.id);success.push({id:e.id,url:result.htmlLink});
        }catch(error){error.partial=success;error.message+=' The write result may not be fully confirmed yet; please check the written items and retry the same preview.';throw error;}
      }
      return success;
    }
  };
}
