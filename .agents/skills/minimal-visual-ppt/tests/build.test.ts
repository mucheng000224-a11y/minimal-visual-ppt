import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import sharp from 'sharp';
import { buildDeck } from '../src/build.js';
import type { DeckPlan, Layout, AssetManifest } from '../src/types.js';

function plan(layouts: Layout[]): DeckPlan {
  return { schemaVersion: '1.0', title: '测试报告', language:'zh-CN', source:'unit test', warnings:[],
    style:{background:'F7F5F0',foreground:'242722',accent:'77836E',fontFace:'Microsoft YaHei'},
    slides:layouts.map((layout,i)=>({id:`s${i+1}`,type:'content',title:`原生标题 ${i+1}`,body:['第一项可编辑正文','第二项正文'],layout,
      image:{required:layout!=='L04'&&layout!=='L06',query:'nature',keywords:['nature']},
      gradient:{mode:'fade-left',width:.35,opacity:1,position:0},animations:[],
      ...(layout==='L06'?{data:{kind:'bar' as const,labels:['甲','乙','丙'],values:[12,24,18],unit:'次'}}:{})}))};
}

test('builds six real layouts with editable native text, chart, unique names and in-bounds objects',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-build-'));
  const photo=path.join(dir,'image.png');
  await sharp({create:{width:1400,height:1400,channels:4,background:{r:90,g:120,b:130,alpha:.9}}}).png().toFile(photo);
  const p=plan(['L01','L02','L03','L04','L05','L06']);
  const assets:AssetManifest={version:'1.0',warnings:[],assets:p.slides.filter(s=>s.image.required).map(s=>({slideId:s.id,provider:'local',url:'local://image',author:'test',license:'user-provided',downloadPath:photo,processedPath:photo,width:1400,height:1400,query:'nature'}))};
  const manifest=await buildDeck(p,assets,dir);
  assert.deepEqual(manifest.slides.map(s=>s.layout),['L01','L02','L03','L04','L05','L06']);
  const zip=await JSZip.loadAsync(await fs.readFile(manifest.pptxPath));
  for(let i=0;i<p.slides.length;i++){
    const xml=await zip.file(`ppt/slides/slide${i+1}.xml`)!.async('string');
    assert.ok(xml.includes(`<a:t>原生标题 ${i+1}</a:t>`));
    assert.ok(xml.includes('第一项可编辑正文'));
    if(p.slides[i].image.required)assert.match(xml,/<a:srcRect[^>]+(?:l|t)="[1-9][0-9]*"/);
    const objects=manifest.slides[i].objects;
    assert.equal(new Set(objects.map(o=>o.name)).size,objects.length);
    for(const o of objects){assert.ok(o.x>=0&&o.y>=0&&o.x+o.w<=13.334&&o.y+o.h<=7.501,JSON.stringify(o));assert.ok(xml.includes(o.name));}
  }
  assert.ok(zip.file('ppt/charts/chart1.xml'));
  assert.ok(manifest.slides[5].objects.some(o=>o.kind==='chart'));
});

test('missing photographs use a declared text fallback without placeholder images',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-build-'));
  const p=plan(['L01']);p.slides[0].type='cover';p.slides[0].body=Array.from({length:6},(_,i)=>`条目 ${i+1}`);
  const result=await buildDeck(p,{version:'1.0',assets:[],warnings:[]},dir);
  assert.equal(result.slides[0].layout,'L04');
  assert.equal(result.slides[0].objects.filter(o=>o.kind==='image').length,0);
  assert.ok(result.repairs.length>0);
});

test('rejects impossible text rather than silently discarding or clipping it',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-build-'));
  const p=plan(['L04']);p.slides[0].body=['长'.repeat(10000)];
  await assert.rejects(buildDeck(p,{version:'1.0',assets:[],warnings:[]},dir),/fit|容纳|pagination/i);
});

test('process and comparison data remain native editable text and shapes',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-data-layouts-'));
  const p=plan(['L06','L06']);
  p.slides[0].data={kind:'process',labels:['收集观察','分析证据','验证结论']};
  p.slides[1].data={kind:'comparison',labels:['课堂实践','课后拓展'],columns:[['以现场记录为依据','每周复核'],['以独立观察为依据','每月复核']]};
  const result=await buildDeck(p,{version:'1.0',assets:[],warnings:[]},dir);
  const zip=await JSZip.loadAsync(await fs.readFile(result.pptxPath));
  const first=await zip.file('ppt/slides/slide1.xml')!.async('string');
  const second=await zip.file('ppt/slides/slide2.xml')!.async('string');
  for(const label of p.slides[0].data.labels)assert.ok(first.includes(`<a:t>${label}</a:t>`));
  for(const label of [...p.slides[1].data.labels,...p.slides[1].data.columns!.flat()])assert.ok(second.includes(`<a:t>${label}</a:t>`));
  assert.ok(result.slides[0].objects.filter(o=>o.kind==='shape').length>0);
  assert.ok(result.slides[1].objects.filter(o=>o.kind==='shape').length>0);
  assert.equal(result.slides.flatMap(s=>s.objects).filter(o=>o.kind==='image').length,0);
});
