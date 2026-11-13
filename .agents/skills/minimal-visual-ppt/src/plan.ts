import {Ajv} from 'ajv';
import fs from 'node:fs';
import type {DeckPlan,SlidePlan,Layout} from './types.js';
import {bodyBoxes,contentBoxes,textSize} from './layout.js';
const schema=JSON.parse(fs.readFileSync(new URL('../schema/deck-plan.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({allErrors:true,strict:true}).compile(schema);
export function validatePlan(value:unknown):asserts value is DeckPlan{
 if(!validate(value))throw new Error(`Invalid deck plan: ${JSON.stringify(validate.errors)}`);
 const p=value as DeckPlan;const ids=new Set<string>();
 for(const s of p.slides){
  if(ids.has(s.id))throw new Error(`Duplicate slide ID: ${s.id}`);ids.add(s.id);
  if(s.data&&s.layout!=='L06')throw new Error(`Data must use L06 layout: ${s.id}`);
  if(s.data?.kind==='process'&&s.data.labels.length>6)throw new Error(`Process supports 1–6 steps; split ${s.id}`);
  if(s.data?.kind==='comparison'&&(s.data.labels.length<2||s.data.labels.length>4))throw new Error(`Comparison supports 2–4 columns: ${s.id}`);
  if(s.data?.kind==='bar'&&(!s.data.values||s.data.values.length!==s.data.labels.length))throw new Error(`Bar data labels/values differ: ${s.id}`);
  if(s.data?.kind==='comparison'&&(!s.data.columns||s.data.columns.length!==s.data.labels.length))throw new Error(`Comparison columns missing: ${s.id}`);
  const targets=new Set(['title',...s.body.map((_,i)=>`body-${i+1}`),...(s.image.required?['image']:[])]);
  for(const a of s.animations)if(!targets.has(a.target))throw new Error(`Unknown planned animation target ${s.id}__${a.target}`);
 }
}
function makeSlide(title:string,body:string[],layout:Layout,index:number,query:string,data?:SlidePlan['data'],localPath?:string):SlidePlan{
 const photo=!['L04','L06'].includes(layout);
 return {id:`s${String(index+1).padStart(3,'0')}`,type:data?.kind==='bar'?'data':data?.kind==='process'?'process':data?.kind==='comparison'?'comparison':index===0?'cover':'content',title,body,layout,
 image:{required:photo,query,keywords:query.split(/[\s,，]+/).filter(Boolean),...(localPath?{localPath}:{})},
 gradient:{mode:layout==='L02'?'fade-right':layout==='L03'?'fade-top':layout==='L05'?'soft-overlay':'fade-left',width:layout==='L03'?.42:.42,opacity:1,position:0},
 animations:[{target:'title',effect:'fade',trigger:'on-click',duration:.5,delay:0},...body.map((_,i)=>({target:`body-${i+1}`,effect:'fade' as const,trigger:'after-previous' as const,duration:.35,delay:.08})),...(photo?[{target:'image',effect:'fade' as const,trigger:'with-previous' as const,duration:.65,delay:0}]:[])],...(data?{data}:{})};
}
/** Deterministic content-preserving planner. Agent-authored plans can replace its editorial decisions. */
export function planText(input:string,source='inline'):DeckPlan{
 const text=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();if(!text)throw new Error('Input has no extractable text');
 const title=text.match(/^#\s+(.+)$/m)?.[1]||text.split('\n')[0].replace(/^#+\s*/,'');
 const plan:DeckPlan={schemaVersion:'1.0',title,language:/[\u4e00-\u9fff]/u.test(text)?'zh-CN':'en',source,warnings:[],style:{background:'F6F4EF',foreground:'263332',accent:'52776C',fontFace:'Microsoft YaHei'},slides:[]};
 const sectionMatches=[...text.matchAll(/^##\s+(.+)$/gm)];
 const sections:{heading:string;raw:string}[]=[];
 if(sectionMatches.length){
  const intro=text.slice(0,sectionMatches[0].index).replace(/^#\s+.+$/m,'').trim();
  if(intro)sections.push({heading:title,raw:intro});
  sectionMatches.forEach((m,i)=>sections.push({heading:m[1],raw:text.slice(m.index!+m[0].length,sectionMatches[i+1]?.index??text.length).trim()}));
 }else sections.push({heading:title,raw:text.replace(/^#\s+.+$/m,'').trim()});
 for(const [i,section] of sections.entries()){
  const explicit=section.heading.match(/^\[(L0[1-6])\]\s*/)?.[1] as Layout|undefined;
  const heading=section.heading.replace(/^\[L0[1-6]\]\s*/,'').trim();
  const query=section.raw.match(/<!--\s*image:\s*(.*?)\s*-->/)?.[1]||heading;
  const local=section.raw.match(/<!--\s*local:\s*(.*?)\s*-->/)?.[1];
  const floatImage=/<!--\s*image-motion:\s*float\s*-->/.test(section.raw);
  const focalText=section.raw.match(/<!--\s*focal:\s*(.*?)\s*-->/)?.[1];
  const focal=focalText?.split(',').map(Number);
  if(focal&&(focal.length!==2||focal.some(x=>!Number.isFinite(x)||x<0||x>1)))throw new Error(`Invalid focal point in ${heading}; use x,y in [0,1]`);
  const fadeText=section.raw.match(/<!--\s*fade-width:\s*(.*?)\s*-->/)?.[1];
  const fade=fadeText===undefined?undefined:Number(fadeText);
  if(fade!==undefined&&(!Number.isFinite(fade)||fade<=0||fade>1))throw new Error(`Invalid fade-width in ${heading}; use (0,1]`);
  const dataBlocks=[...section.raw.matchAll(/```data\s*\n([\s\S]*?)```/g)];
  if(dataBlocks.length>1)throw new Error(`Multiple datasets in ${heading}: use one data block per ## section to preserve each dataset.`);
  const dataText=dataBlocks[0];
  let data:SlidePlan['data'];if(dataText){try{data=JSON.parse(dataText[1]);}catch{throw new Error(`Invalid data JSON in ${heading}`);}}
  const layout:Layout=data?'L06':explicit||(['L01','L02','L04','L03'] as Layout[])[i%4];
  if(data&&explicit&&explicit!=='L06')plan.warnings.push(`${heading}: ${explicit} → L06 so native data remains visible.`);
  const raw=section.raw.replace(/```data\s*\n[\s\S]*?```/g,'').replace(/<!--[\s\S]*?-->/g,'');
  const lines=raw.split('\n').map(x=>x.replace(/^\s*[-*]\s+/,'').replace(/^###\s+/,'').trim()).filter(Boolean);
  // Fit the same regions and font metrics that the builder will use. Content is
  // split only when needed; joining body strings recovers every source glyph.
  const queue=[...lines];let page=0;
  do {
   const pageLayout:Layout=data&&page>0?'L04':layout;
   const pageData=page===0?data:undefined;
   const provisional=makeSlide(heading,[],pageLayout,plan.slides.length,query,pageData,local);
   const regions=contentBoxes(pageLayout,provisional.type,!!pageData);
   let pageTitle=page?`${heading}（续 ${page+1}）`:heading;
   try{textSize(pageTitle,regions.title,regions.titleSize,regions.titleMin);}
   catch {
    if(page){pageTitle=heading;}
    try{textSize(pageTitle,regions.title,regions.titleSize,regions.titleMin);}
    catch{throw new Error(`Heading cannot fit layout ${pageLayout}. Shorten the heading or move its detail into body text before pagination: ${heading.slice(0,80)}`);}
   }
   const fits=(body:string[])=>{try{bodyBoxes(body,regions.body,regions.bodySize);return true;}catch{return false;}};
   const body:string[]=[];
   while(queue.length){
    const next=queue[0];
    if(fits([...body,next])){body.push(queue.shift()!);continue;}
    if(body.length)break;
    // A single paragraph exceeds the page: binary-search a lossless prefix.
    const glyphs=Array.from(next);let low=1,high=glyphs.length,best=0;
    while(low<=high){const mid=Math.floor((low+high)/2);if(fits([glyphs.slice(0,mid).join('')])){best=mid;low=mid+1;}else high=mid-1;}
    if(!best)throw new Error(`No body text can fit layout ${pageLayout}; check font and page regions.`);
    // Prefer a nearby sentence or word boundary without discarding whitespace.
    const floor=Math.floor(best*.75);
    for(let k=best-1;k>=floor;k--)if(/[。！？；.!?;\s]/u.test(glyphs[k])){best=k+1;break;}
    body.push(glyphs.slice(0,best).join(''));
    const remainder=glyphs.slice(best).join('');if(remainder)queue[0]=remainder;else queue.shift();
    break;
   }
   const result=makeSlide(pageTitle,body,pageLayout,plan.slides.length,query,pageData,local);
   if(focal)result.image.focalPoint={x:focal[0],y:focal[1]};
   if(fade!==undefined)result.gradient.width=fade;
   if(floatImage)for(const animation of result.animations)if(animation.target==='image')animation.effect='float';
   plan.slides.push(result);page++;
   if(plan.slides.length>200)throw new Error('Content requires more than 200 slides. Split the input into smaller presentations.');
  }while(queue.length);
 }
 if(text.length<35)plan.warnings.push('Topic-only input: no claims, numbers or evidence were invented. Ask the agent to develop a sourced outline or provide content.');
 plan.warnings.push('Deterministic planning preserves supplied content; narrative emphasis and photo subject suitability require editorial review.');
 validatePlan(plan);return plan;
}
