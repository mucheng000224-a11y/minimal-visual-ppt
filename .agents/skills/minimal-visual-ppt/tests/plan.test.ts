import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planText, validatePlan} from '../src/plan.js';

test('an explicit image-motion directive requests a native gentle drift',()=>{
 const plan=planText('# 项目\n## [L05] 风场\n<!-- image-motion: float -->\n<!-- image: wind -->\n现场观察。');
 assert.equal(plan.slides[0].animations.find(a=>a.target==='image')?.effect,'float');
});
test('photography focal point and feather width directives survive planning and reject invalid values',()=>{
 const p=planText('# 风场\n## [L03] 场景\n<!-- focal: 0.5,0.58 -->\n<!-- fade-width: 0.28 -->\n测量说明。');
 assert.deepEqual(p.slides[0].image.focalPoint,{x:.5,y:.58});assert.equal(p.slides[0].gradient.width,.28);
 assert.throws(()=>planText('# 风场\n## 场景\n<!-- focal: 0.5,2 -->\n正文'),/Invalid|focal/);
});
test('multiple datasets fail explicitly, conflicting Markdown layouts repair to L06, JSON cannot hide data',()=>{
 const block='```data\n{"kind":"process","labels":["A","B"]}\n```';
 assert.throws(()=>planText(`# 两组数据\n## 同页\n${block}\n${block}`),/multiple|多个|one data/i);
 const p=planText(`# 方案\n## [L01] 流程\n${block}`);assert.equal(p.slides[0].layout,'L06');assert.ok(p.warnings.some(w=>w.includes('L06')));
 p.slides[0].layout='L04';assert.throws(()=>validatePlan(p),/L06|layout|Invalid/);
});
import {buildDeck} from '../src/build.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import type {AssetManifest, Layout} from '../src/types.js';

test('planner preserves all long content by pagination and assigns unique IDs',()=>{
 const body=Array.from({length:18},(_,i)=>`${i+1} 数据来自课堂实测，必须保留这一段完整的中文内容。`).join('\n');
 const p=planText(`# 教学汇报\n## 方法\n${body}`,'test.md');
 assert.ok(p.slides.length>1);assert.equal(new Set(p.slides.map(s=>s.id)).size,p.slides.length);
 assert.equal(p.slides.flatMap(s=>s.body).join('').replace(/\s/g,''),body.replace(/\s/g,''));validatePlan(p);
});
test('schema rejects invalid gradient, duplicate IDs and inconsistent data',()=>{
 const p=planText('# 汇报\n## A\n内容\n## B\n更多内容','test.md');
 p.slides[0].gradient.width=2;assert.throws(()=>validatePlan(p));
 p.slides[0].gradient.width=.4;p.slides[1].id=p.slides[0].id;assert.throws(()=>validatePlan(p));
 p.slides[1].id='s002';p.slides[0].data={kind:'bar',labels:['A','B'],values:[1]};assert.throws(()=>validatePlan(p));
});
test('planner uses explicit layout, data and image query without inventing numbers',()=>{
 const p=planText('# 结果\n## [L06] 测量\n```data\n{"kind":"bar","labels":["A","B"],"values":[12,20],"unit":"人"}\n```\n## [L01] 实验\n<!-- image: students laboratory -->\n测试说明','test.md');
 assert.deepEqual(p.slides[0].data?.values,[12,20]);assert.equal(p.slides[1].image.query,'students laboratory');
});

test('dense variable paragraphs fit the actual regions of every layout and retain all content',async()=>{
 const layouts:Layout[]=['L01','L02','L03','L04','L05','L06'];
 const paragraphs=['课程实测一段说明。','长段落需要完整保存。'.repeat(25),'English observations with spaces and measurements. '.repeat(16),'短段。','课程结论与后续验证。'.repeat(15)];
 const source='# 密集课程汇报\n'+layouts.map(layout=>`## [${layout}] ${layout}内容检验\n${paragraphs.join('\n')}`).join('\n');
 const p=planText(source,'dense.md');
 assert.equal(p.slides.flatMap(s=>s.body).join('').replace(/\s/g,''),layouts.map(()=>paragraphs.join('')).join('').replace(/\s/g,''));
 assert.ok(layouts.every(l=>p.slides.some(s=>s.layout===l)));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-plan-fit-'));
 const photo=path.join(dir,'photo.png');await sharp({create:{width:1200,height:800,channels:3,background:'#456789'}}).png().toFile(photo);
 const assets:AssetManifest={version:'1.0',warnings:[],assets:p.slides.filter(s=>s.image.required).map(s=>({slideId:s.id,provider:'local',url:'local://test',author:'test',license:'user-provided',downloadPath:photo,width:1200,height:800,query:'test'}))};
 const built=await buildDeck(p,assets,dir);assert.equal(built.slides.length,p.slides.length);
 const recovered=built.slides.flatMap(s=>s.objects.filter(o=>o.role?.startsWith('body-')).map(o=>o.text)).join('').replace(/\s/g,'');
 assert.equal(recovered,layouts.map(()=>paragraphs.join('')).join('').replace(/\s/g,''));
});

test('data annotations paginate into text continuations and oversize headings fail with an actionable message',()=>{
 const text='这段注释完整保留到下一页。'.repeat(50);
 const p=planText(`# 数据\n## [L06] 实测\n\`\`\`data\n{"kind":"bar","labels":["A","B"],"values":[1,2]}\n\`\`\`\n${text}`,'data.md');
 assert.equal(p.slides[0].layout,'L06');assert.ok(p.slides[0].data);
 assert.ok(p.slides.slice(1).every(s=>s.layout==='L04'&&!s.data));
 assert.equal(p.slides.flatMap(s=>s.body).join(''),text);
 assert.throws(()=>planText(`# 标题\n## [L01] ${'标题'.repeat(300)}\n正文`),/heading|标题|pagination/i);
});
