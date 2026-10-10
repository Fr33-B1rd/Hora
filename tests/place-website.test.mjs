import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIPv4,readPlaceWebsite} from '../lib/place-website.mjs';
const site='https://example.org/',resolve=async()=>['93.184.216.34'];
test('official text reader retains evidence and observed same-site links, strips scripts and bounds output',async()=>{
 const r=await readPlaceWebsite(site,site,{resolve,request:async(url,address)=>{
  assert.equal(address,'93.184.216.34');assert.equal(url.href,site);
  return {status:200,type:'text/html',text:'<script>SECRET SCRIPT</script><nav>Navigation</nav><main>Saturday seafood buffet. <a href="/menu">Menu</a><a href="https://elsewhere.org/">Other</a><p>'+('Example '.repeat(1000))+'</p></main>'};
 }});
 assert.match(r.text,/Saturday seafood buffet/);assert.doesNotMatch(r.text,/SECRET SCRIPT|Navigation/);assert.ok(r.text.length<=3000);assert.deepEqual(r.links,[{url:site+'menu',label:'Menu'}]);
});
test('private, mixed DNS and non-HTTPS addresses cannot be fetched',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','100.64.1.1','224.0.0.1']){
  assert.equal(publicIPv4(ip),false);
  await assert.rejects(readPlaceWebsite(site,site,{resolve:async()=>['93.184.216.34',ip],request:async()=>assert.fail('must not fetch')}),/publicly readable network/);
 }
 for(const url of ['ftp://example.org/','https://127.0.0.1/','https://user:password@example.org/','https://example.org:444/'])await assert.rejects(readPlaceWebsite(url,url,{resolve,request:async()=>assert.fail()}),/HTTPS/);
});
test('an observed HTTP website is upgraded to HTTPS without changing its host or path',async()=>{
 const r=await readPlaceWebsite('http://example.org/menu','http://example.org/menu',{resolve,request:async url=>{assert.equal(url.href,'https://example.org/menu');return {status:200,type:'text/plain',text:'Menu'};}});
 assert.equal(r.url,'https://example.org/menu');
});
test('redirects must stay on observed official host, with fresh validated DNS',async()=>{
 let count=0;
 await assert.rejects(readPlaceWebsite(site,site,{resolve,request:async()=>({status:302,location:'https://evil.org/'})}),/another site/);
 await assert.rejects(readPlaceWebsite(site,site,{resolve:async()=>++count===1?['93.184.216.34']:['127.0.0.1'],request:async()=>({status:302,location:'/menu'})}),/publicly readable network/);
 assert.equal(count,2);
 await assert.rejects(readPlaceWebsite(site,site,{resolve,request:async()=>({status:302,location:'/menu'})}),/Too many redirects/);
});
test('unreadable or failed sources stay unknown instead of fabricating a service',async()=>{
 for(const response of [{status:403,type:'text/html',text:'denied'},{status:200,type:'application/pdf',text:'binary'}])await assert.rejects(readPlaceWebsite(site,site,{resolve,request:async()=>response}),/still needs verification/);
 await assert.rejects(readPlaceWebsite(site,site,{resolve,request:async()=>{throw Error('network failure');}}),/network failure/);
});
