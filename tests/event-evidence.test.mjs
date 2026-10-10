import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEventDetails,eventRef,eventDetails,parseEvents} from '../lib/nearby-events.mjs';
const url='https://www.visitstockholm.com/events/fixture/next/';
const html=event=>'<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{componentProps:{event}}}}).replaceAll('<','\\u003c')+'</script>';
const event={title:'Fictional concert',href:url,venueName:'Test hall',startDate:'2026-10-07',endDate:'2027-06-17'};
test('a date range never produces all-day or daily occurrences',()=>{
 const r=parseEventDetails(html(event),url);assert.equal(r.scheduleStatus,'date_only');assert.deepEqual(r.occurrences,[]);assert.equal(r.ticketStatus,'unknown');
});
test('official venue coordinates and address survive detail extraction',()=>{
 const location={latitude:59.3359354,longitude:18.077741};
 const r=parseEventDetails(html({...event,location,address:'Nybrogatan 31'}),url);
 assert.deepEqual(r.location,location);assert.equal(r.address,'Nybrogatan 31');
 assert.equal(parseEventDetails(html({...event,location:{latitude:999,longitude:18}}),url).location,null);
});
test('event descriptions retain source content as plain text',()=>{
 const r=parseEventDetails(html({...event,description:'<p>A guided walk &amp; stories.</p><script>doBadThings()</script><p>In Swedish.</p>'}),url);
 assert.equal(r.description,'A guided walk & stories. In Swedish.');
});
test('official occurrence times are retained; missing end, overnight or invalid times remain unknown',()=>{
 const r=parseEventDetails(html({...event,occurrences:[{date:'2026-10-07',startTime:'21:00:00',endTime:'22:00:00'},{date:'2026-10-08',startTime:'21:00'},{date:'2026-10-09',startTime:'23:00',endTime:'01:00'}]}),url);
 assert.deepEqual(r.occurrences,[{date:'2026-10-07',start:'21:00',end:'22:00'}]);assert.equal(r.scheduleStatus,'confirmed');assert.equal(r.ref,eventRef(url));
});
test('detail URLs cannot silently fetch another provider or mismatched event',async()=>{
 let calls=0;await assert.rejects(eventDetails('http://localhost/private',{fetchImpl:async()=>{calls++;}}),/Can only verify/);assert.equal(calls,0);
 assert.throws(()=>parseEventDetails(html({...event,href:'https://www.visitstockholm.com/events/other/next/'}),url),/not match/);
});
