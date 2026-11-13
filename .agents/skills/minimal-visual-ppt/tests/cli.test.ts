import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import JSZip from 'jszip';
import {readInput} from '../src/input.js';
import {loadConfig} from '../src/config.js';

const cli=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
const tsx=fileURLToPath(import.meta.resolve('tsx/cli'));
const runner=fileURLToPath(new URL('../scripts/run.mjs',import.meta.url));
function command(args:string[],cwd:string,useSkillEntrypoint=false):Promise<{code:number;stdout:string;stderr:string}>{
 return new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[...(useSkillEntrypoint?[runner]:[tsx,cli]),...args],{cwd,windowsHide:true,env:{...process.env,PEXELS_API_KEY:'',MVP_PYTHON:'missing-python-for-tests',MVP_LOCAL_ASSETS:'',MVP_SOFFICE:''}});
  let stdout='',stderr='';p.stdout.on('data',x=>stdout+=String(x));p.stderr.on('data',x=>stderr+=String(x));
  const timer=setTimeout(()=>{p.kill();reject(new Error('CLI test exceeded 30 seconds'));},30000);
  p.on('error',error=>{clearTimeout(timer);reject(error);});p.on('close',code=>{clearTimeout(timer);resolve({code:code??-1,stdout,stderr});});
 });
}
const json=async(file:string)=>JSON.parse(await fs.readFile(file,'utf8'));

test('independent CLI plan/images/build stages preserve Unicode and honestly fall back without an API key',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-cli-'));
 try{
  const input=path.join(dir,'课程 大纲.md'),out=path.join(dir,'课程 成果');
  await fs.writeFile(input,'# 实验课程汇报\n## 研究问题\n- 中文内容与 Unicode café 保留。\n- 科学实验强调证据。');
  let result=await command(['plan','--input',input,'--output',out],dir);assert.equal(result.code,0,result.stderr);
  const plan=await json(path.join(out,'deck-plan.json'));assert.equal(plan.slides[0].title,'研究问题');assert.ok(plan.slides[0].body[0].includes('café'));
  result=await command(['images','--output',out],dir);assert.equal(result.code,0,result.stderr);
  const assets=await json(path.join(out,'assets.json'));assert.equal(assets.assets.length,0);assert.ok(assets.warnings.some((x:string)=>/PEXELS_API_KEY/.test(x)));
  result=await command(['build','--output',out],dir);assert.equal(result.code,0,result.stderr);
  const build=await json(path.join(out,'build-manifest.json'));assert.equal(build.slides[0].layout,'L04');assert.ok(build.repairs.length);
  const zip=await JSZip.loadAsync(await fs.readFile(path.join(out,'deck.pptx')));const xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.ok(xml.includes('研究问题'));assert.ok(xml.includes('café'));assert.match(xml,/<a:t>/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('static CLI pipeline with unavailable Python reports disabled features and unavailable measured checks',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-static-'));
 try{
  const input=path.join(dir,'input.md'),out=path.join(dir,'out');await fs.writeFile(input,'# 测试报告\n## [L04] 结论\n文字作为原生对象保留。');
  const result=await command(['--input',input,'--output',out,'--provider','none','--no-animate','--no-render'],dir,true);assert.equal(result.code,0,result.stderr);
  const animation=await json(path.join(out,'animation-report.json')),render=await json(path.join(out,'render-report.json')),qa=await json(path.join(out,'qa-report.json'));
  assert.equal(animation.status,'disabled');assert.equal(render.status,'disabled');assert.equal(qa.backends.office,'unavailable');
  assert.equal(qa.checks.measuredTextFit,'unavailable');assert.equal(qa.checks.subjectiveVisualReview,'required');assert.equal(qa.checks.nativeText,'passed');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('malformed plan JSON returns exit code 1 with an error artifact',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-json-error-'));
 try{
  const input=path.join(dir,'broken.json'),out=path.join(dir,'out');await fs.writeFile(input,'{broken');
  const result=await command(['plan','--input',input,'--output',out],dir);assert.equal(result.code,1);assert.match(result.stderr,/Error:/);
  const error=await json(path.join(out,'plan-error.json'));assert.equal(error.status,'failed');assert.ok(error.error);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('standalone render of a missing presentation exits nonzero even without strict mode',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-render-error-'));
 try{
  const result=await command(['render','--output',path.join(dir,'missing'),'--python',process.env.MVP_PYTHON||'python'],dir);
  assert.equal(result.code,2,'A failed render backend must propagate failure');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('strict QA cannot succeed while enabled animation/render and exact Office checks are unavailable',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-strict-'));
 try{
  const input=path.join(dir,'input.md'),out=path.join(dir,'out');await fs.writeFile(input,'# 检查\n## [L04] 结论\n原生文本。');
  const generated=await command(['--input',input,'--output',out,'--provider','none','--no-animate','--no-render'],dir);assert.equal(generated.code,0,generated.stderr);
  const result=await command(['qa','--output',out,'--strict'],dir);assert.equal(result.code,2,'Strict QA must reject unavailable enabled backends: '+result.stdout+result.stderr);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('PowerPoint input supports valid package-absolute slide relationships',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-input-'));
 try{
  const zip=new JSZip();zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="rId1" Target="/ppt/slides/slide1.xml" Type="slide"/></Relationships>');
  zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>可编辑标题</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>中文正文</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  const input=path.join(dir,'有效.pptx');await fs.writeFile(input,await zip.generateAsync({type:'nodebuffer'}));
  const plan=await readInput(input,await loadConfig(undefined,{provider:'none'}));assert.equal(plan.slides[0].title,'可编辑标题');assert.deepEqual(plan.slides[0].body,['中文正文']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
