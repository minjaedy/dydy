import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNaverLocation, travelLocationRoute} from './travel-location.js';
import worker from './worker.js';

test('short map URL resolution follows only Naver map links and stops at place IDs',async()=>{
  const url='https://naver.me/example', destination='https://map.naver.com/p/entry/place/12345';
  const calls=[];
  const result=await resolveNaverLocation(url,async(link,options)=>{
    calls.push(link);
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:307,headers:{Location:destination}});
  });
  assert.deepEqual(calls,[url]);
  assert.equal(result.link,destination);
  assert.equal(result.coords,null);
  const outside=await resolveNaverLocation(url,async()=>new Response(null,{status:302,headers:{Location:'https://example.org/out'}}));
  assert.equal(outside.link,url);
  assert.equal(await resolveNaverLocation('https://example.org/not-a-map'),null);
  const req=new Request('https://test/travel/location',{method:'POST',body:JSON.stringify({link:url})});
  assert.equal((await worker.fetch(req,{},{})).status,401);
  assert.equal((await travelLocationRoute(new Request(req.url))).status,405);
});
