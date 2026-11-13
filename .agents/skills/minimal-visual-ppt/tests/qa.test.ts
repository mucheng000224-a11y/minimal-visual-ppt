import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import { inspectPackage,checkDeck } from '../src/qa.js';
import {buildDeck} from '../src/build.js';
import type {Config,DeckPlan} from '../src/types.js';

test('package inspector rejects missing named object and rasterized expected text', async()=>{
 const zip=new JSZip();
 zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
 zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2" name="s1__title"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-qa-'));
 try {
 const file=path.join(dir,'defective.pptx');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
 const result=await inspectPackage(file,{version:'1.0',pptxPath:file,repairs:[],warnings:[],slides:[{id:'s1',layout:'L04',objects:[{name:'s1__title',slideId:'s1',kind:'text',text:'Editable title',x:0,y:0,w:1,h:1},{name:'s1__body-1',slideId:'s1',kind:'text',text:'Body',x:0,y:2,w:1,h:1}]}]});
 assert.ok(result.errors.some((x:string)=>x.includes('native editable text')));
 assert.ok(result.errors.some((x:string)=>x.includes('s1__body-1')));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('package inspector catches out of bounds geometry and broken relationships', async()=>{
 const zip=new JSZip();
 zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
 zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="s1__title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="12192000" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
 zip.file('ppt/slides/_rels/slide1.xml.rels','<Relationships><Relationship Id="rId1" Target="../media/missing.png" Type="image"/></Relationships>');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-qa-'));
 try {
 const file=path.join(dir,'defective.pptx');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
 const result=await inspectPackage(file,{version:'1.0',pptxPath:file,repairs:[],warnings:[],slides:[{id:'s1',layout:'L04',objects:[{name:'s1__title',slideId:'s1',kind:'text',text:'Title',x:13.333,y:0,w:1,h:1}]}]});
 assert.ok(result.errors.some((x:string)=>x.includes('outside slide')));
 assert.ok(result.errors.some((x:string)=>x.includes('missing.png')));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('reads actual native animation timing and chart data from their package parts',async()=>{
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<Types/>');
 zip.file('_rels/.rels','<Relationships><Relationship Id="rId1" Target="ppt/presentation.xml" Type="officeDocument"/></Relationships>');
 zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="rId1" Target="slides/slide1.xml" Type="slide"/></Relationships>');
 zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
 zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r" xmlns:c="c"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="s1__title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="s1__chart"/></p:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn presetID="10" nodeType="afterEffect"><p:stCondLst><p:cond delay="80"/></p:stCondLst><p:childTnLst><p:animEffect filter="fade"><p:cBhvr><p:cTn dur="550"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:animEffect><p:animMotion path="M 0 0.012 L 0 0 E"/></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>');
 zip.file('ppt/slides/_rels/slide1.xml.rels','<Relationships><Relationship Id="rId1" Target="/ppt/charts/chart1.xml" Type="chart"/></Relationships>');
 zip.file('ppt/charts/chart1.xml','<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>42</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-qa-'));
 try{
  const file=path.join(dir,'native.pptx');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
  const result=await inspectPackage(file,{version:'1.0',pptxPath:file,repairs:[],warnings:[],slides:[{id:'s1',layout:'L06',objects:[{name:'s1__title',slideId:'s1',kind:'text',text:'Title',x:0,y:0,w:1,h:1}]}]});
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.slides[0].chartSeries,[{labels:['A'],values:[42]}]);
  assert.deepEqual(result.slides[0].animationEffects,[{name:'s1__title',shapeId:'2',presetId:10,duration:.55,trigger:'afterEffect',delay:.08,motion:true,fade:true}]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('rejects cached passed previews after the PPTX source changes externally',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-qa-stale-'));
 const plan:DeckPlan={schemaVersion:'1.0',title:'Preview provenance',language:'en-US',source:'test fixture',warnings:[],style:{background:'F7F5F0',foreground:'242722',accent:'77836E',fontFace:'Microsoft YaHei'},slides:[{id:'s1',type:'content',title:'Preview provenance',body:['Editable body'],layout:'L04',image:{required:false,query:'',keywords:[]},gradient:{mode:'fade-left',width:.3,opacity:1,position:0},animations:[]}]};
 const config:Config={provider:'none',python:'mvp-nonexistent-python',timeoutMs:1000,maxImageBytes:1000,animate:false,render:true,strict:false};
 try{
   const build=await buildDeck(plan,{version:'1.0',assets:[],warnings:[]},dir);
   const original=await fs.readFile(build.pptxPath);
   const digest=createHash('sha256').update(original).digest('hex');
   const preview=path.join(dir,'test-only-preview.png');await sharp({create:{width:1600,height:900,channels:3,background:'#eeeeee'}}).png().toFile(preview);
   await fs.writeFile(path.join(dir,'render-report.json'),JSON.stringify({status:'passed',sourceSha256:digest,files:[preview]}));
   // Package metadata mutation preserves all native slide content but invalidates cached evidence.
   const zip=await JSZip.loadAsync(original);await fs.writeFile(build.pptxPath,await zip.generateAsync({type:'nodebuffer',comment:'external revision'}));
   const result=await checkDeck(plan,{version:'1.0',assets:[],warnings:[]},build,config,dir);
   assert.equal(result.status,'failed');
   assert.ok(result.errors.some((e:string)=>/stale preview|source.*hash/i.test(e)),JSON.stringify(result.errors));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
