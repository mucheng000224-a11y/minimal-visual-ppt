import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import sharp from 'sharp';
const exec=promisify(execFile),require=createRequire(import.meta.url);
const cli=fileURLToPath(new URL('../../src/cli.ts',import.meta.url));
const root=process.cwd();const results:any[]=[];const covered=new Set<string>();
const strict=process.env.MVP_INTEGRATION_STRICT!=='0';
for(const name of ['course-report','innovation-project','mixed-data-report']){
 const output=path.resolve(root,'outputs',name);const started=Date.now();
 const {stdout,stderr}=await exec(process.execPath,[require.resolve('tsx/cli'),cli,'--input',path.join(root,'examples',name+'.md'),'--output',output,'--provider','local','--local-assets',path.join(root,'examples/assets/manifest.json'),...(strict?['--strict']:[])],{timeout:240000,maxBuffer:10*1024*1024,windowsHide:true});
 console.log(stdout.trim());if(stderr.trim())console.log(stderr.trim());
 const json=async(file:string)=>JSON.parse(await fs.readFile(path.join(output,file),'utf8'));
 const [plan,assets,build,qa,animation,render]=await Promise.all(['deck-plan.json','assets.json','build-manifest.json','qa-report.json','animation-report.json','render-report.json'].map(json));
 assert.equal(qa.status,'passed',JSON.stringify(qa.errors));assert.equal(qa.errors.length,0);
 const zip=await JSZip.loadAsync(await fs.readFile(path.join(output,'deck.pptx')));
 let editableObjects=0;
 for(const [i,slide] of build.slides.entries()){
  covered.add(slide.layout);const xml=await zip.file(`ppt/slides/slide${i+1}.xml`)!.async('string');
  for(const o of slide.objects.filter((o:any)=>o.kind==='text')){assert.ok(xml.includes(o.name));editableObjects++;}
 }
 for(const asset of assets.assets){assert.ok(asset.author&&asset.url&&asset.license);const m=await sharp(asset.processedPath).metadata();assert.ok(m.hasAlpha);const stats=await sharp(asset.processedPath).stats();assert.ok(stats.channels.at(-1)!.max>stats.channels.at(-1)!.min);}
 if(strict){assert.equal(animation.status,'passed');assert.equal(animation.applicationName,'Microsoft PowerPoint');assert.ok(!/kingsoft|wps/i.test(animation.applicationPath),'Animation must be verified using genuine Microsoft PowerPoint');assert.equal(path.normalize(path.dirname(animation.executable)),path.normalize(animation.applicationPath));assert.equal(render.status,'passed');assert.equal(render.files.length,plan.slides.length);assert.equal(qa.checks.measuredTextFit,'passed');}
 if(name==='innovation-project'&&strict){assert.ok(animation.xmlVerification.some((s:any)=>s.motionCount>0),'Requested gentle drift must exist as real native motion');}
 const result={name,slides:plan.slides.length,layouts:build.slides.map((s:any)=>s.layout),photos:assets.assets.length,editableTextObjects:editableObjects,quality:qa.status,animation:animation.status,render:render.status,durationSeconds:Math.round((Date.now()-started)/100)/10};
 results.push(result);console.log(JSON.stringify(result));
}
assert.deepEqual([...covered].sort(),['L01','L02','L03','L04','L05','L06']);
await fs.mkdir(path.join(root,'outputs'),{recursive:true});
await fs.writeFile(path.join(root,'outputs/integration-report.json'),JSON.stringify({status:'passed',strict,generatedAt:new Date().toISOString(),layouts:[...covered].sort(),results},null,2));
console.log('Three real decks verified; all six layouts covered.');
