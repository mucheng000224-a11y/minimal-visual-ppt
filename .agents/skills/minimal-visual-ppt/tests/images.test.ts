import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {blendImage,processImages} from '../src/images.js';
import {LocalProvider} from '../src/providers/local.js';
import type {DeckPlan,Config} from '../src/types.js';

const config:Config={provider:'local',python:'python',timeoutMs:500,maxImageBytes:2000000,animate:false,render:false,strict:false};
function plan(localPath?:string):DeckPlan {return {schemaVersion:'1.0',title:'Forest',language:'en',source:'test',warnings:[],style:{background:'FAF8F4',foreground:'222222',accent:'708070',fontFace:'Microsoft YaHei'},slides:[{id:'s1',type:'content',title:'Forest ecology',body:['Trees and habitats'],layout:'L01',image:{required:true,query:'forest trees',keywords:['forest'],localPath},gradient:{mode:'fade-left',width:.4,opacity:.9,position:0},animations:[]}]};}

test('Sharp exports real alpha fades in each direction and keeps aspect ratio',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-image-'));const src=path.join(dir,'src.png');
 await sharp({create:{width:500,height:250,channels:4,background:{r:40,g:80,b:30,alpha:1}}}).png().toFile(src);
 for(const mode of ['fade-left','fade-right','fade-top','soft-overlay'] as const){
  const out=path.join(dir,mode+'.png');
  await blendImage(src,out,{mode,width:.4,position:0,opacity:.8,targetWidth:200,targetHeight:100});
  const {data,info}=await sharp(out).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,200);assert.equal(info.height,100);assert.equal(info.channels,4);
  const a=(x:number,y:number)=>data[(y*info.width+x)*4+3];
  if(mode==='fade-left'){assert.ok(a(0,50)<2);assert.ok(a(199,50)>200);}
  if(mode==='fade-right'){assert.ok(a(199,50)<2);assert.ok(a(0,50)>200);}
  if(mode==='fade-top'){assert.ok(a(100,0)<2);assert.ok(a(100,99)>200);}
  if(mode==='soft-overlay'){assert.ok(a(100,50)>200);assert.ok(a(0,50)<2);}
 }
});

test('local provider rejects unrelated assets instead of fabricating relevance',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-local-'));const manifest=path.join(dir,'manifest.json');
 await writeFile(manifest,JSON.stringify([{path:'forest.jpg',keywords:['forest','trees'],author:'Test author',license:'User provided'},{path:'car.jpg',keywords:['car'],author:'Other',license:'User provided'}]));
 const provider=new LocalProvider(manifest);const good=await provider.search('forest trees',['forest']);const bad=await provider.search('finance',['finance']);
 assert.equal(good.length,1);assert.equal(bad.length,0);assert.equal(good[0].author,'Test author');
});

test('API failure uses only matching local material and records provenance plus actual PNG',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-fallback-'));const src=path.join(dir,'forest.png');
 await sharp({create:{width:1000,height:900,channels:3,background:'#64805b'}}).png().toFile(src);
 const manifest=path.join(dir,'manifest.json');await writeFile(manifest,JSON.stringify([{path:src,keywords:['forest'],author:'Photographer',url:'https://example.org/photo',license:'User provided'}]));
 const result=await processImages(plan(),{...config,provider:'pexels',pexelsApiKey:'not-a-real-key',localAssets:manifest},path.join(dir,'out'),{primary:{name:'failing-api',search:async()=>{throw new Error('offline');}}});
 assert.equal(result.assets.length,1);assert.equal(result.assets[0].author,'Photographer');assert.equal(result.assets[0].url,'https://example.org/photo');
 assert.ok(result.warnings.some(x=>x.includes('offline')));const meta=await sharp(result.assets[0].processedPath!).metadata();assert.ok(meta.hasAlpha);
 assert.equal(JSON.parse(await readFile(path.join(dir,'out','assets.json'),'utf8')).assets.length,1);
});

test('missing sources degrade honestly and explicit localPath is marked user provided',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-missing-'));const none=await processImages(plan(),{...config,provider:'none'},path.join(dir,'empty'));
 assert.equal(none.assets.length,0);assert.ok(none.warnings.some(x=>x.includes('s1')));
 const src=path.join(dir,'local.png');await sharp({create:{width:900,height:900,channels:3,background:'#779966'}}).png().toFile(src);
 const result=await processImages(plan(src),config,path.join(dir,'provided'));assert.equal(result.assets[0].provider,'local');assert.match(result.assets[0].license,/user.provided/i);
});

test('invalid gradient and undecodable local input produce actionable errors',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-invalid-'));const src=path.join(dir,'src.png');
 await sharp({create:{width:100,height:100,channels:3,background:'#448866'}}).png().toFile(src);
 await assert.rejects(()=>blendImage(src,path.join(dir,'invalid.png'),{mode:'fade-left',width:0,position:0,opacity:1,targetWidth:100,targetHeight:100}),/width/);
 const invalid=path.join(dir,'invalid.jpg');await writeFile(invalid,'not an image');
 const result=await processImages(plan(invalid),config,path.join(dir,'out'));
 assert.equal(result.assets.length,0);assert.ok(result.warnings.some(x=>x.includes('rejected')));
});

test('alpha mask preserves original photographic colors and existing transparency',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-alpha-'));const src=path.join(dir,'src.png');const out=path.join(dir,'out.png');
 await sharp({create:{width:100,height:100,channels:4,background:{r:40,g:80,b:30,alpha:.5}}}).png().toFile(src);
 await blendImage(src,out,{mode:'fade-left',width:.25,position:.1,opacity:.8,targetWidth:100,targetHeight:100});
 const {data,info}=await sharp(out).raw().toBuffer({resolveWithObject:true});const i=(50*info.width+99)*4;
 assert.ok(Math.abs(data[i]-40)<3&&Math.abs(data[i+1]-80)<3&&Math.abs(data[i+2]-30)<3);
 assert.ok(data[i+3]>=100&&data[i+3]<=103);
});
