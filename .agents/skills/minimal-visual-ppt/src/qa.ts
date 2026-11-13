import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import sharp from 'sharp';
import type { DeckPlan,AssetManifest,BuildManifest,Config } from './types.js';
import {inspectDeck,renderDeck,sourceSha256,type BackendReport} from './office.js';

const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false});
const arr=(value:any):any[]=>value==null?[]:Array.isArray(value)?value:[value];
const normalized=(s:string)=>s.replace(/[\s\u00a0]+/gu,'').normalize('NFC');
function descendants(node:any,key:string):any[]{
 if(node==null||typeof node!=='object')return [];
 return Object.entries(node).flatMap(([k,v])=>[...(k===key?arr(v):[]),...arr(v).flatMap(n=>descendants(n,key))]);
}
function nativeText(node:any):string {return descendants(node,'t').map(n=>typeof n==='object'?String(n['#text']??''):String(n)).join('');}
function resolvePart(base:string,target:string):string{return path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join(base,decodeURIComponent(target)));}
function geometry(node:any):{x:number;y:number;w:number;h:number}|undefined {
 const xf=descendants(node,'xfrm')[0];if(!xf?.off||!xf?.ext)return;
 return {x:Number(xf.off['@_x'])/914400,y:Number(xf.off['@_y'])/914400,w:Number(xf.ext['@_cx'])/914400,h:Number(xf.ext['@_cy'])/914400};
}
export interface PackageInspection {errors:string[];warnings:string[];slides:any[];width:number;height:number;slideCount:number}

/** Independent OOXML checks; never trusts the builder manifest as evidence of native objects. */
export async function inspectPackage(pptxPath:string,build:BuildManifest):Promise<PackageInspection>{
 const errors:string[]=[],warnings:string[]=[],slides:any[]=[];
 const zip=await JSZip.loadAsync(await fs.readFile(pptxPath));
 for(const part of ['[Content_Types].xml','_rels/.rels','ppt/_rels/presentation.xml.rels'])if(!zip.file(part))errors.push(`PPTX is missing required package part: ${part}`);
 async function xml(name:string):Promise<any>{
   const file=zip.file(name);if(!file)throw new Error(`PPTX is missing required part: ${name}`);
   const content=await file.async('string');const valid=XMLValidator.validate(content);if(valid!==true)throw new Error(`Invalid XML ${name}: ${JSON.stringify(valid)}`);
   return parser.parse(content);
 }
 const pres=await xml('ppt/presentation.xml');
 const size=pres.presentation?.sldSz;
 const width=Number(size?.['@_cx'])/914400,height=Number(size?.['@_cy'])/914400;
 if(!Number.isFinite(width)||!Number.isFinite(height))errors.push('Presentation size is missing or invalid');
 let slideFiles=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1])-Number(b.match(/slide(\d+)/)?.[1]));
 if(pres.presentation?.sldIdLst?.sldId&&zip.file('ppt/_rels/presentation.xml.rels')){
   const rels=arr((await xml('ppt/_rels/presentation.xml.rels')).Relationships?.Relationship);
   const ordered=arr(pres.presentation.sldIdLst.sldId).map(s=>{
     const id=s['@_id'];const r=rels.find(r=>r['@_Id']===id);
     return r?resolvePart('ppt',String(r['@_Target'])):'';
   });
   if(ordered.every(s=>slideFiles.includes(s)))slideFiles=ordered;
   else errors.push('Presentation slide order contains unresolved slide relationships');
 }
 if(slideFiles.length!==build.slides.length)errors.push(`Slide count differs: OOXML=${slideFiles.length}, build=${build.slides.length}`);
 // Resolve every internal package relationship, including linked charts and their workbooks.
 for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.rels'))){
   const rel=await xml(name);
   const parent=name==='_rels/.rels'?'':path.posix.dirname(name).replace(/(?:^|\/)\_rels$/,'');
   for(const r of arr(rel.Relationships?.Relationship)){
     if(r['@_TargetMode']==='External')continue;
     const target=String(r['@_Target']||'');
     const resolved=resolvePart(parent,target);
     if(!zip.file(resolved))errors.push(`Broken package relationship ${name}: ${target}`);
   }
 }
 for(let i=0;i<slideFiles.length;i++){
   const name=slideFiles[i],doc=await xml(name),tree=doc.sld?.cSld?.spTree||{};
   const slideBuild=build.slides[i];
   const objects:any[]=[];
   // The builder emits top-level native shapes; groups are recursively inspected as well.
   for(const kind of ['sp','pic','graphicFrame'])for(const item of descendants(tree,kind)){
     const nv=descendants(item,'cNvPr')[0];if(!nv)continue;
     const objectName=String(nv['@_name']||'');
     const object={name:objectName,id:String(nv['@_id']),kind,text:kind==='sp'?nativeText(item):'',geometry:geometry(item)};
     objects.push(object);
     const g=object.geometry;
     if(g&&(!Object.values(g).every(Number.isFinite)||g.w<0||g.h<0||g.x<-.015||g.y<-.015||g.x+g.w>width+.015||g.y+g.h>height+.015))errors.push(`Slide ${i+1}: ${objectName} is outside slide bounds`);
     if(kind==='pic'&&g){
       const embed=descendants(item,'blip')[0]?.['@_embed'];
       const relName=`ppt/slides/_rels/${path.posix.basename(name)}.rels`;
       if(embed&&zip.file(relName)){
         const rels=await xml(relName);const r=arr(rels.Relationships?.Relationship).find(r=>r['@_Id']===embed);
         if(r){
           const imageName=resolvePart('ppt/slides',String(r['@_Target']));
           const image=zip.file(imageName);
           if(image){try{
             const metadata=await sharp(await image.async('nodebuffer')).metadata();
             const crop=descendants(item,'srcRect')[0]||{};
             const availableW=1-(Number(crop['@_l']||0)+Number(crop['@_r']||0))/100000;
             const availableH=1-(Number(crop['@_t']||0)+Number(crop['@_b']||0))/100000;
             const ratio=(metadata.width! * availableW)/(metadata.height! * availableH);
             if(Math.abs((g.w/g.h)/ratio-1)>.035)errors.push(`Slide ${i+1}: ${objectName} image aspect ratio is distorted`);
           }catch(e){errors.push(`Slide ${i+1}: unreadable embedded image ${imageName}: ${String(e)}`);}}
         }
       }
     }
   }
   const seen=new Set<string>();for(const o of objects){if(seen.has(o.name))errors.push(`Slide ${i+1}: duplicate object name ${o.name}`);seen.add(o.name);}
   for(const expected of slideBuild?.objects||[]){
     const actual=objects.find(o=>o.name===expected.name);
     if(!actual){errors.push(`Slide ${i+1}: expected object is missing: ${expected.name}`);continue;}
     if(expected.kind==='text'){
       if(actual.kind!=='sp')errors.push(`Slide ${i+1}: ${expected.name} is not native editable text`);
       else if(normalized(actual.text)!==normalized(expected.text||''))errors.push(`Slide ${i+1}: text content differs in ${expected.name}`);
     }
   }
   const timing=doc.sld?.timing;
   const ids=new Set(objects.map(o=>o.id));
   const targets=descendants(timing,'spTgt').map(t=>String(t['@_spid']));
   for(const id of targets)if(!ids.has(id))errors.push(`Slide ${i+1}: animation references nonexistent shape ID ${id}`);
   const animationEffects=descendants(timing,'cTn').filter(n=>n['@_presetID']!=null).map(n=>{
     const fade=descendants(n,'animEffect').find(e=>String(e['@_filter']||'').includes('fade'));
     const shapeId=String(descendants(n,'spTgt')[0]?.['@_spid']||'');
     return {name:objects.find(o=>o.id===shapeId)?.name,shapeId,presetId:Number(n['@_presetID']),
       duration:Number(fade?.cBhvr?.cTn?.['@_dur'])/1000,trigger:String(n['@_nodeType']||''),
       delay:Number(n.stCondLst?.cond?.['@_delay']||0)/1000,motion:descendants(n,'animMotion').length>0,fade:!!fade};
   });
   const chartSeries:any[]=[];
   const relName=`ppt/slides/_rels/${path.posix.basename(name)}.rels`;
   if(zip.file(relName)){
     const relationships=arr((await xml(relName)).Relationships?.Relationship);
     for(const chart of descendants(tree,'chart')){
       const r=relationships.find(r=>r['@_Id']===chart['@_id']);if(!r)continue;
       const chartPath=resolvePart('ppt/slides',String(r['@_Target']));if(!zip.file(chartPath))continue;
       const chartDoc=await xml(chartPath);
       for(const series of descendants(chartDoc,'ser'))chartSeries.push({labels:descendants(series.cat,'v').map(String),values:descendants(series.val,'v').map(Number)});
     }
   }
   slides.push({index:i+1,id:slideBuild?.id,layout:slideBuild?.layout,objects,chartSeries,animationTargets:[...new Set(targets)],animationEffects,hasTiming:!!timing});
 }
 return {errors,warnings,slides,width,height,slideCount:slideFiles.length};
}

async function readReport(outDir:string,name:string):Promise<BackendReport|undefined>{try{return JSON.parse(await fs.readFile(path.join(outDir,name),'utf8'));}catch{return;}}

export async function checkDeck(plan:DeckPlan,assets:AssetManifest,build:BuildManifest,config:Config,outDir:string):Promise<any>{
 outDir=path.resolve(outDir);await fs.mkdir(outDir,{recursive:true});
 const pptxPath=path.resolve(build.pptxPath);
 const errors:string[]=[],warnings:string[]=[...plan.warnings,...build.warnings,...assets.warnings],repairs=[...build.repairs];
 const office=await inspectDeck(pptxPath,config,outDir,true);
 if(office.status==='failed')errors.push(...office.errors||['PowerPoint open/inspection failed']);
 else if(office.status==='unavailable')warnings.push(`PowerPoint inspection unavailable: ${office.reason}. Exact text fit needs review in PowerPoint.`);
 if(office.repairs?.length){repairs.push(...office.repairs);if(config.render)await renderDeck(pptxPath,config,outDir);}
 let pkg:PackageInspection;
 try {pkg=await inspectPackage(pptxPath,build);errors.push(...pkg.errors);warnings.push(...pkg.warnings);}
 catch(e){pkg={errors:[String(e)],warnings:[],slides:[],width:0,height:0,slideCount:0};errors.push(...pkg.errors);}
 for(let i=0;i<plan.slides.length;i++){
   const p=plan.slides[i],s=pkg.slides[i];if(!s)continue;
   const allText=normalized(s.objects.filter((o:any)=>o.kind==='sp').map((o:any)=>o.text).join(''));
   for(const text of [p.title,...p.body])if(!allText.includes(normalized(text)))errors.push(`Slide ${i+1}: planned editable content missing: ${text.slice(0,60)}`);
   if(p.data?.kind==='bar'){
     const data=p.data;
     const match=s.chartSeries?.some((series:any)=>series.labels.length===data.labels.length&&series.values.length===data.values?.length&&series.labels.every((label:string,j:number)=>normalized(label)===normalized(data.labels[j]))&&series.values.every((value:number,j:number)=>Math.abs(value-data.values![j])<=Math.max(1,Math.abs(value))*1e-9));
     if(!match)errors.push(`Slide ${i+1}: native chart labels or values differ from the page plan`);
   }else if(p.data){
     for(const text of [...p.data.labels,...p.data.columns?.flat()||[]])if(!allText.includes(normalized(text)))errors.push(`Slide ${i+1}: planned editable data label missing: ${text.slice(0,60)}`);
   }
   const image=s.objects.find((o:any)=>o.name===`${p.id}__image`);
   if(image){
     const asset=assets.assets.find(a=>a.slideId===p.id);
     if(!asset)errors.push(`Slide ${i+1}: photo has no source manifest`);
     else{
       if(!asset.author||!asset.license||!asset.url||!asset.downloadPath)errors.push(`Slide ${i+1}: photo provenance is incomplete`);
       try {await fs.access(asset.downloadPath);}catch{errors.push(`Slide ${i+1}: source image is missing: ${asset.downloadPath}`);}
       if(asset.processedPath){
         try {
           const processed=sharp(asset.processedPath),metadata=await processed.metadata();
           if(!metadata.hasAlpha)errors.push(`Slide ${i+1}: blended photograph has no actual alpha channel`);
           else if(p.gradient.mode!=='soft-overlay'){
             const stats=await processed.stats(),alpha=stats.channels[stats.channels.length-1];
             if(alpha.min===alpha.max)errors.push(`Slide ${i+1}: photograph fade has no alpha variation`);
           }
         }catch(e){errors.push(`Slide ${i+1}: cannot inspect blended photograph: ${String(e)}`);}
       }else errors.push(`Slide ${i+1}: photograph has no processed blend asset`);
     }
   }
 }
 // Compare actual COM font faces to the authored manifest, allowing only documented Chinese fallback.
 for(const slide of office.slides||[]){
   for(const object of slide.objects||[]){
     if(!object.editableText)continue;
     const expected=build.slides[slide.index-1]?.objects.find(o=>o.name===object.name);
     if(expected?.fontFace&&object.fontFace&&expected.fontFace!==object.fontFace){
       const fallbacks=['Microsoft YaHei','微软雅黑'];
       if(!(fallbacks.includes(expected.fontFace)&&fallbacks.includes(object.fontFace)))warnings.push(`Slide ${slide.index}: font substituted in ${object.name}: ${expected.fontFace} → ${object.fontFace}`);
     }
   }
   const textObjects=(slide.objects||[]).filter((o:any)=>o.editableText);
   for(let a=0;a<textObjects.length;a++)for(let b=a+1;b<textObjects.length;b++){
     const left=textObjects[a],right=textObjects[b];
     if([left.boundLeft,left.boundTop,right.boundLeft,right.boundTop].some(v=>!Number.isFinite(v)))continue;
     const overlapW=Math.min(left.boundLeft+left.boundWidth,right.boundLeft+right.boundWidth)-Math.max(left.boundLeft,right.boundLeft);
     const overlapH=Math.min(left.boundTop+left.boundHeight,right.boundTop+right.boundHeight)-Math.max(left.boundTop,right.boundTop);
     if(overlapW>1.2&&overlapH>1.2)errors.push(`Slide ${slide.index}: measured text overlaps: ${left.name} / ${right.name}`);
   }
 }
 const animation=await readReport(outDir,'animation-report.json');
 if(config.animate){
   if(animation?.status==='failed')errors.push(...animation.errors||['Native animation failed']);
   else if(animation?.status!=='passed')warnings.push(`Native animation ${animation?.status||'not-run'}: ${animation?.reason||'No successful native animation verification report'}`);
   if(animation?.status==='passed'&&!pkg.slides.some(s=>s.hasTiming)&&plan.slides.some(s=>s.animations.length))errors.push('Animation report claimed success but PPTX contains no native timing');
   if(animation?.status==='passed'){
     for(let i=0;i<plan.slides.length;i++)for(const expected of plan.slides[i].animations){
       const name=`${plan.slides[i].id}__${expected.target}`,s=pkg.slides[i];
       if(expected.target==='image'&&!s?.objects.some((o:any)=>o.name===name))continue;
       const actual=s?.animationEffects.find((e:any)=>e.name===name);
       const trigger={'on-click':'clickEffect','with-previous':'withEffect','after-previous':'afterEffect'}[expected.trigger];
       if(!actual||!actual.fade||Math.abs(actual.duration-expected.duration)>.03||actual.trigger!==trigger||Math.abs(actual.delay-expected.delay)>.03||expected.effect==='float'&&!actual.motion)errors.push(`Slide ${i+1}: native animation in the live PPTX differs from plan for ${name}`);
     }
   }
 }
 const render=await readReport(outDir,'render-report.json');
 if(config.render&&render?.status==='passed'&&render.sourceSha256!==await sourceSha256(pptxPath)){
   render.status='failed';render.errors=[...(render.errors||[]),'Stale preview evidence: source SHA-256 hash differs from the current PPTX; rerun render'];
 }
 if(config.strict){
   if(office.status!=='passed')errors.push(`Strict QA requires measured Microsoft PowerPoint inspection; status=${office.status}`);
   if(config.animate&&animation?.status!=='passed')errors.push(`Strict QA requires native animation verification; status=${animation?.status||'not-run'}`);
   if(config.render&&render?.status!=='passed')errors.push(`Strict QA requires real preview rendering; status=${render?.status||'not-run'}`);
 }
 if(config.render){
   if(render?.status==='failed')errors.push(...render.errors||['Rendering failed']);
   else if(render?.status!=='passed')warnings.push(`Preview rendering ${render?.status||'not-run'}: ${render?.reason||'No rendering report'}`);
   else{
     if(render.files?.length!==pkg.slideCount)errors.push('Rendered preview count differs from presentation slide count');
     for(const file of render.files||[])try{const m=await sharp(file).metadata();if(!m.width||!m.height)errors.push(`Invalid preview: ${file}`);}catch{errors.push(`Missing or unreadable preview: ${file}`);}
   }
 }
 const report={version:'1.0',status:errors.length?'failed':'passed',generatedAt:new Date().toISOString(),pptxPath,
   errors:[...new Set(errors)],warnings:[...new Set(warnings)],repairs,
   checks:{packageOpen:pkg.errors.length?'failed':'passed',powerPointOpen:office.opened?'passed':office.status,
     nativeText:pkg.errors.some(e=>/text|editable/.test(e))?'failed':'passed',geometry:pkg.errors.some(e=>/outside|distort/.test(e))?'failed':'passed',
     measuredTextFit:office.status==='passed'?'passed':office.status,nativeAnimation:animation?.status||'not-run',previewRender:render?.status||'not-run',
     subjectiveVisualReview:'required'},
   manualReview:{status:'required',items:['Photography subject crop and semantic relevance','Natural blend between photo and page background','Editorial hierarchy, whitespace, text/photo separation','Data claims and units against the original source'],note:'No subjective score is fabricated. Review each real preview; software checks cannot certify visual quality.'},
   slides:pkg.slides.map(s=>({...s,preview:render?.files?.[s.index-1],textMeasurements:office.slides?.[s.index-1]?.objects.filter((o:any)=>o.editableText)})),
   backends:{office:office.status,animation:animation?.status||'not-run',render:render?.status||'not-run'}};
 await fs.writeFile(path.join(outDir,'qa-report.json'),JSON.stringify(report,null,2));
 const md=[`# PowerPoint quality report`,``,`Status: **${report.status}**`,``,`- Slides: ${pkg.slideCount}`,
   ...Object.entries(report.checks).map(([k,v])=>`- ${k}: ${v}`),``,`## Automatic repairs`,...repairs.map(r=>`- ${r}`),
   ``,`## Errors`,...(report.errors.length?report.errors.map(e=>`- ${e}`):['None detected by the available checks.']),
   ``,`## Warnings`,...report.warnings.map(w=>`- ${w}`),``,`## Visual review required`,...report.manualReview.items.map(s=>`- ${s}`),``,report.manualReview.note,
   ``,`## Per-slide previews`,...report.slides.map(s=>`- Slide ${s.index} · ${s.id} · ${s.layout}${s.preview?` · [Preview](${path.relative(outDir,s.preview).replaceAll('\\','/')})`:''}`)].join('\n');
 await fs.writeFile(path.join(outDir,'qa-report.md'),md);
 return report;
}
