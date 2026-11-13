import test from 'node:test';
import assert from 'node:assert/strict';
import {PexelsProvider} from '../src/providers/pexels.js';

test('Pexels sends Authorization and correctly encoded query/orientation, retaining source metadata',async t=>{
 const requests:{url:URL;init?:RequestInit}[]=[];
 t.mock.method(globalThis,'fetch',async (input:string|URL|Request,init?:RequestInit)=>{
  requests.push({url:new URL(String(input)),init});
  return Response.json({photos:[{id:123,url:'https://www.pexels.com/photo/example-123/',photographer:'Test Photographer',
   photographer_url:'https://www.pexels.com/@test/',width:4000,height:6000,alt:'Laboratory & science',
   src:{original:'https://images.pexels.com/photos/123/original.jpeg',large2x:'https://images.pexels.com/photos/123/large.jpeg'}}]});
 });
 const provider=new PexelsProvider('test-key-only',2000);
 const results=await provider.search('实验室 & science',['laboratory'],'portrait');
 assert.equal(requests.length,1);const {url,init}=requests[0];
 assert.equal(url.origin,'https://api.pexels.com');assert.equal(url.pathname,'/v1/search');
 assert.equal(url.searchParams.get('query'),'实验室 & science');assert.match(url.href,/%26/);
 assert.equal(url.searchParams.get('orientation'),'portrait');assert.equal(url.searchParams.get('per_page'),'8');
 assert.equal(new Headers(init?.headers).get('Authorization'),'test-key-only');assert.ok(init?.signal);
 assert.equal(results.length,1);assert.equal(results[0].id,'123');assert.equal(results[0].provider,'pexels');
 assert.equal(results[0].url,'https://www.pexels.com/photo/example-123/');assert.equal(results[0].author,'Test Photographer');
 assert.equal(results[0].authorUrl,'https://www.pexels.com/@test/');assert.equal(results[0].license,'Pexels License');
 assert.equal(results[0].licenseUrl,'https://www.pexels.com/license/');assert.equal(results[0].width,4000);assert.equal(results[0].height,6000);
 assert.equal(results[0].downloadUrl,'https://images.pexels.com/photos/123/large.jpeg');assert.ok(results[0].keywords.includes('laboratory'));
});

test('Pexels HTTP errors report status and never include API credentials',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('Unauthorized',{status:401}));
 await assert.rejects(()=>new PexelsProvider('private-test-value').search('forest',['forest']),error=>{
  assert.match((error as Error).message,/HTTP 401/);assert.ok(!(error as Error).message.includes('private-test-value'));return true;
 });
});

test('Pexels rejects missing keys and malformed data without inventing photos',async t=>{
 let count=0;t.mock.method(globalThis,'fetch',async()=>{count++;return Response.json({unexpected:[]});});
 await assert.rejects(()=>new PexelsProvider('').search('forest',['forest']),/PEXELS_API_KEY/);assert.equal(count,0);
 await assert.rejects(()=>new PexelsProvider('test').search('forest',['forest']),/valid photos array/);
 assert.deepEqual(await new PexelsProvider('test').search('  ',[]),[]);assert.equal(count,1);
});
