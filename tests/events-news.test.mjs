import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents,selectEvents} from '../lib/nearby-events.mjs';
import {parseNews,translateTitles} from '../lib/local-news.mjs';
const config={key:'test',base:'https://model.invalid/v1',model:'test'};
test('nearby events retain trusted links and exclude past, distant and wrong-category results',()=>{
  const event={id:'1',title:'Music',startDate:'2026-10-07',endDate:'2026-10-08',href:'https://www.visitstockholm.com/events/test/',categories:['Music'],venueName:'Park',location:{latitude:59.33,longitude:18.06}};
  const items=[event,{...event,id:'2',startDate:'2026-09-01',endDate:'2026-09-02'},{...event,id:'3',location:{latitude:60,longitude:18}},{...event,id:'4',href:'https://evil.invalid/events/test'}];
  const html='<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{componentProps:{contentBlocks:[{value:{items}}]}}}})+'</script>';
  const parsed=parseEvents(html);assert.equal(parsed.length,3);
  assert.equal(selectEvents(parsed,event.location,{today:'2026-10-07',category:'music'}).length,1);
  assert.equal(selectEvents(parsed,event.location,{today:'2026-10-07',category:'exhibitions'}).length,0);
  assert.throws(()=>parseEvents('changed'),/changed/);
});
test('news validates source, timestamp, freshness and deduplicates headlines',()=>{
  const item=(url,date,title='A &amp; B')=>`<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
  const url='https://www.svt.se/nyheter/lokalt/stockholm/example',date='2026-10-07T10:00:00Z';
  const xml='<rss>'+item(url,date)+item(url,date)+item('https://evil.invalid/',date)+item(url+'old','2026-09-01')+item(url+'future','2026-10-08')+'</rss>';
  const cards=parseNews(xml,{now:Date.parse('2026-10-07T12:00:00Z')});assert.equal(cards.length,1);assert.equal(cards[0].title,'A & B');
});
test('translated titles cannot replace provider links or dates',async()=>{
  const cards=[{title:'Hej',url:'https://www.svt.se/example',publishedAt:'2026-10-07'}];
  const translated=await translateTitles(cards,config,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'translate_titles',arguments:'{"titles":["Hello"]}'}}]}}]})})});
  assert.equal(translated[0].url,cards[0].url);assert.equal(translated[0].publishedAt,cards[0].publishedAt);assert.equal(translated[0].translatedTitle,'Hello');
});
