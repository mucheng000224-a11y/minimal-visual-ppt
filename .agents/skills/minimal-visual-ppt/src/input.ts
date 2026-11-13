import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import {XMLParser} from 'fast-xml-parser';
import type {Config,DeckPlan} from './types.js';
import {validatePlan,planText} from './plan.js';
const exec=promisify(execFile);
const decode=(s:string)=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
export async function readInput(file:string,config:Config):Promise<DeckPlan>{
 const source=path.resolve(file);const ext=path.extname(source).toLowerCase();let text:string;const warnings:string[]=[];
 if(ext==='.json'){const plan=JSON.parse((await fs.readFile(source,'utf8')).replace(/^\uFEFF/,''));validatePlan(plan);resolveImagePaths(plan,path.dirname(source));return plan;}
 if(['.md','.txt','.markdown'].includes(ext))text=await fs.readFile(source,'utf8');
 else if(ext==='.docx'){
  const html=await mammoth.convertToHtml({path:source});
  text=decode(html.value.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi,'\n# $1\n').replace(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/gi,'\n## $1\n').replace(/<\/(p|li|tr)>/gi,'\n').replace(/<[^>]+>/g,''));
  warnings.push(...html.messages.map(x=>x.message),'Word converted to content; original page layout and embedded images are not reconstructed.');
 }else if(ext==='.pdf'){
  const {stdout}=await exec(config.python,[fileURLToPath(new URL('../scripts/extract_pdf.py',import.meta.url)),source],{timeout:60000,maxBuffer:20*1024*1024,windowsHide:true});
  const parsed=JSON.parse(stdout) as {pages:string[]};text=`# ${path.basename(source,ext)}\n`+parsed.pages.map((p,i)=>`## 第 ${i+1} 页\n${p}`).join('\n');
  warnings.push('PDF text-layer extraction preserves reading text; formulas, figures, tables and column order require review. Scanned PDFs require local OCR.');
 }else if(ext==='.pptx'){
  const zip=await JSZip.loadAsync(await fs.readFile(source));
  const parser=new XMLParser({ignoreAttributes:false,alwaysCreateTextNode:true,parseTagValue:false});
  const texts=(v:unknown):string[]=>{if(!v||typeof v!=='object')return [];return Object.entries(v).flatMap(([k,x])=>k==='a:t'?(Array.isArray(x)?x:[x]).map(t=>typeof t==='object'?String(t['#text']??''):String(t)):Array.isArray(x)?x.flatMap(texts):texts(x));};
  // Read relationship order rather than numeric slide filenames (which may be reordered).
  const pres=parser.parse(await zip.file('ppt/presentation.xml')!.async('string'));
  const rels=parser.parse(await zip.file('ppt/_rels/presentation.xml.rels')!.async('string'));
  const arr=<T>(v:T|T[]|undefined):T[]=>v===undefined?[]:Array.isArray(v)?v:[v];
  const targets=new Map(arr<any>(rels.Relationships.Relationship).map(r=>[r['@_Id'],r['@_Target']]));
  const slides=arr<any>(pres['p:presentation']['p:sldIdLst']['p:sldId']);
  const sections:string[]=[];
  for(const [i,s] of slides.entries()){
   const target=targets.get(s['@_r:id']);if(typeof target!=='string')throw new Error(`Missing PPTX slide relationship ${i+1}`);
   const name=path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join('ppt',target));const part=zip.file(name);if(!part)throw new Error(`Missing PPTX slide ${name}`);
   const doc=parser.parse(await part.async('string'));
   const find=(node:any,key:string):any[]=>!node||typeof node!=='object'?[]:Object.entries(node).flatMap(([k,v])=>[...(k===key?arr(v):[]),...arr(v).flatMap(x=>find(x,key))]);
   const shapes=find(doc,'p:sp').map(shape=>({shape,text:find(shape,'a:p').map(p=>texts(p).join('')).filter(Boolean).join('\n'),name:String(find(shape,'p:cNvPr')[0]?.['@_name']||''),placeholder:String(find(shape,'p:ph')[0]?.['@_type']||'')})).filter(x=>x.text);
   const content=shapes.filter(x=>!/__folio$/.test(x.name)&&!['ftr','dt','sldNum'].includes(x.placeholder));
   const title=content.find(x=>/__title$/.test(x.name))||content.find(x=>['title','ctrTitle'].includes(x.placeholder))||content[0];
   const lines=content.filter(x=>x!==title).map(x=>x.text);
   // Native tables carry text outside p:sp. Retain those cells as content too.
   lines.push(...find(doc,'a:tbl').flatMap(texts));
   sections.push(`## ${title?.text||`Slide ${i+1}`}\n${lines.join('\n')}`);
  }
  text=`# ${path.basename(source,ext)}\n${sections.join('\n')}`;warnings.push('PowerPoint import extracts native text; charts, notes and embedded images need explicit content/material selection.');
 }else throw new Error(`Unsupported input ${ext}. Use Markdown, TXT, DOCX, text-layer PDF, PPTX or deck-plan.json`);
 const plan=planText(text,source);plan.warnings.push(...warnings);resolveImagePaths(plan,path.dirname(source));return plan;
}
function resolveImagePaths(plan:DeckPlan,base:string){for(const s of plan.slides)if(s.image.localPath)s.image.localPath=path.resolve(base,s.image.localPath);}
