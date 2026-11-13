import sharp from 'sharp';
import {mkdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {AssetManifest,Config,DeckPlan,FadeMode,Gradient,PhotoAsset,SlidePlan} from './types.js';
import {LocalProvider,explicitLocalCandidate} from './providers/local.js';
import {PexelsProvider} from './providers/pexels.js';
import {errorMessage,type ImageCandidate,type ImageProvider} from './providers/types.js';
export type {ImageProvider,ImageCandidate} from './providers/types.js';

export interface BlendOptions extends Gradient {targetWidth:number;targetHeight:number;focalPoint?:{x:number;y:number}}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};

/** Applies an independent alpha mask; all text remains outside this photograph layer. */
export async function blendImage(input:string,output:string,options:BlendOptions):Promise<Record<string,unknown>>{
 const {mode,width,opacity,position,targetWidth,targetHeight,focalPoint}=options;
 if(!['fade-left','fade-right','fade-top','soft-overlay'].includes(mode))throw new Error(`Unknown fade mode: ${mode}`);
 if(![width,opacity,position].every(Number.isFinite)||width<=0||width>1||opacity<0||opacity>1||position<0||position>1)throw new Error('Gradient width must be (0,1], opacity and position must be [0,1]');
 if(!Number.isInteger(targetWidth)||!Number.isInteger(targetHeight)||targetWidth<1||targetHeight<1||targetWidth*targetHeight>20000000)throw new Error('Invalid image target size');
 const meta=await sharp(input).rotate().metadata();
 if(!meta.width||!meta.height)throw new Error(`Cannot decode photograph: ${input}`);
 let pipeline=sharp(input).rotate();
 const orientation=meta.orientation||1;const swap=[5,6,7,8].includes(orientation);
 const sw=swap?meta.height:meta.width,sh=swap?meta.width:meta.height;
 const targetRatio=targetWidth/targetHeight,sourceRatio=sw/sh;
 const cropW=Math.min(sw,Math.round(sh*targetRatio)),cropH=Math.min(sh,Math.round(sw/targetRatio));
 let left=0,top=0;
 if(focalPoint){
  if(!Number.isFinite(focalPoint.x)||!Number.isFinite(focalPoint.y)||focalPoint.x<0||focalPoint.x>1||focalPoint.y<0||focalPoint.y>1)throw new Error('Image focal point must be in [0,1]');
  left=Math.round(Math.max(0,Math.min(sw-cropW,focalPoint.x*sw-cropW/2)));
  top=Math.round(Math.max(0,Math.min(sh-cropH,focalPoint.y*sh-cropH/2)));
  pipeline=pipeline.extract({left,top,width:cropW,height:cropH}).resize(targetWidth,targetHeight,{fit:'fill'});
 }else{
  pipeline=pipeline.resize(targetWidth,targetHeight,{fit:'cover',position:sharp.strategy.attention});
 }
 const mask=Buffer.alloc(targetWidth*targetHeight*4);
 for(let y=0;y<targetHeight;y++)for(let x=0;x<targetWidth;x++){
  const nx=targetWidth===1?1:x/(targetWidth-1),ny=targetHeight===1?1:y/(targetHeight-1);
  let d=mode==='fade-left'?nx:mode==='fade-right'?1-nx:ny;
  if(mode==='soft-overlay')d=Math.min(nx,1-nx,ny,1-ny)*2;
  const alpha=Math.round(255*opacity*smooth((d-position)/width));const i=(y*targetWidth+x)*4;
  mask[i]=255;mask[i+1]=255;mask[i+2]=255;mask[i+3]=alpha;
 }
 await mkdir(path.dirname(output),{recursive:true});
 await pipeline.ensureAlpha().composite([{input:mask,raw:{width:targetWidth,height:targetHeight,channels:4},blend:'dest-in'}]).png().toFile(output);
 return {sourceWidth:sw,sourceHeight:sh,targetWidth,targetHeight,sourceRatio,targetRatio,fit:'cover',
  focalPoint:focalPoint||'Sharp attention heuristic',retainedArea:cropW*cropH/(sw*sh),
  ...(focalPoint?{left,top,cropWidth:cropW,cropHeight:cropH}:{}),subjectPreservation:'Requires visual review; attention is a saliency heuristic'};
}

interface Composition {meanRGB:number[];saliencyX:number;saliencyY:number;edgeEnergy:number;quietLeft:number;quietRight:number;quietTop:number;width:number;height:number}

async function analyze(file:string):Promise<Composition>{
 const meta=await sharp(file).metadata();if(!meta.width||!meta.height)throw new Error('Image has no dimensions');
 const {data,info}=await sharp(file).rotate().resize(96,64,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
 const sum=[0,0,0];let total=0,sx=0,sy=0,left=0,right=0,top=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  const i=(y*info.width+x)*info.channels;for(let c=0;c<3;c++)sum[c]+=data[i+c];
  if(x===0||y===0)continue;
  let edge=0;for(let c=0;c<3;c++)edge+=Math.abs(data[i+c]-data[i-info.channels+c])+Math.abs(data[i+c]-data[i-info.width*info.channels+c]);
  edge/=6;total+=edge;sx+=edge*x/info.width;sy+=edge*y/info.height;
  if(x<info.width*.33)left+=edge;if(x>info.width*.66)right+=edge;if(y<info.height*.33)top+=edge;
 }
 const n=info.width*info.height;
 return {meanRGB:sum.map(x=>x/n),saliencyX:total?sx/total:.5,saliencyY:total?sy/total:.5,edgeEnergy:total/n,
  quietLeft:1-clamp(left/(n*.33*45)),quietRight:1-clamp(right/(n*.33*45)),quietTop:1-clamp(top/(n*.33*45)),width:meta.width,height:meta.height};
}

function imageSize(layout:SlidePlan['layout']):{width:number;height:number}{
 const width=1400;return {width,height:Math.round(width*(layout==='L03'?4.5/13.333:layout==='L05'?7.5/13.333:7.5/7.233))};
}
function score(candidate:ImageCandidate,composition:Composition,slide:SlidePlan,palette?:number[]):number{
 const {width,height}=imageSize(slide.layout);const ratio=width/height;
 const ratioScore=Math.exp(-Math.abs(Math.log((composition.width/composition.height)/ratio)));
 const clarity=Math.min(1,Math.min(composition.width/width,composition.height/height));
 const space=slide.gradient.mode==='fade-right'?composition.quietRight:slide.gradient.mode==='fade-top'?composition.quietTop:composition.quietLeft;
 const subject=slide.gradient.mode==='fade-right'?1-composition.saliencyX:slide.gradient.mode==='fade-top'?composition.saliencyY:composition.saliencyX;
 const paletteScore=palette?1-Math.sqrt(palette.reduce((s,v,i)=>s+(v-composition.meanRGB[i])**2,0))/(255*Math.sqrt(3)):.7;
 return .4*candidate.relevance+.2*ratioScore+.12*clarity+.1*space+.08*subject+.1*paletteScore;
}

async function acquire(candidate:ImageCandidate,dest:string,config:Config):Promise<void>{
 if(candidate.localPath){
  const st=await stat(candidate.localPath);if(!st.isFile()||st.size>config.maxImageBytes)throw new Error('Local image is missing, not a file, or exceeds size limit');
  await copyFile(candidate.localPath,dest);return;
 }
 if(!candidate.downloadUrl)throw new Error('Candidate has no download location');
 const url=new URL(candidate.downloadUrl);if(url.protocol!=='https:')throw new Error('Only HTTPS image downloads are supported');
 const response=await fetch(url,{signal:AbortSignal.timeout(config.timeoutMs)});
 if(!response.ok)throw new Error(`Image download failed (HTTP ${response.status})`);
 if(!/^image\/(jpeg|png|webp|avif|tiff)(;|$)/i.test(response.headers.get('content-type')||''))throw new Error('Image response has unsupported content type');
 if(Number(response.headers.get('content-length')||0)>config.maxImageBytes)throw new Error('Image exceeds download size limit');
 if(!response.body)throw new Error('Image response body is empty');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try {while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>config.maxImageBytes)throw new Error('Image exceeds download size limit');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 await writeFile(dest,Buffer.concat(chunks));
}

export async function processImages(plan:DeckPlan,config:Config,outDir:string,providers:{primary?:ImageProvider;fallback?:ImageProvider}={}):Promise<AssetManifest>{
 const folder=path.resolve(outDir,'images');await mkdir(folder,{recursive:true});const result:AssetManifest={version:'1.0',assets:[],warnings:[]};
 const primary=providers.primary??(config.provider==='pexels'?new PexelsProvider(config.pexelsApiKey||'',config.timeoutMs):config.provider==='local'&&config.localAssets?new LocalProvider(config.localAssets):undefined);
 const fallback=providers.fallback??(config.localAssets&&config.provider!=='local'?new LocalProvider(config.localAssets):undefined);
 let palette:number[]|undefined;
 for(const slide of plan.slides){
  if(!slide.image.required||['L04','L06'].includes(slide.layout))continue;
  let candidates:ImageCandidate[]=[];
  if(slide.image.localPath)candidates=[explicitLocalCandidate(slide.image.localPath)];
  else if(primary){try{candidates=await primary.search(slide.image.query,slide.image.keywords,['L01','L02'].includes(slide.layout)?'portrait':'landscape');}
   catch(error){result.warnings.push(`${slide.id}: ${primary.name}: ${errorMessage(error)}`);}}
  // Local material can also win when a primary candidate cannot be downloaded or decoded.
  if(!slide.image.localPath&&fallback){try{candidates.push(...await fallback.search(slide.image.query,slide.image.keywords));}
   catch(error){result.warnings.push(`${slide.id}: local fallback: ${errorMessage(error)}`);}}
  const ranked:{candidate:ImageCandidate;file:string;composition:Composition;score:number}[]=[];
  for(const candidate of candidates.slice(0,12)){
   const digest=createHash('sha256').update(candidate.localPath||candidate.downloadUrl||candidate.url).digest('hex').slice(0,12);
   const file=path.join(folder,`${slide.id}-${digest}.original`);
   try{await acquire(candidate,file,config);const composition=await analyze(file);ranked.push({candidate,file,composition,score:score(candidate,composition,slide,palette)});}
   catch(error){result.warnings.push(`${slide.id}: rejected ${candidate.provider} candidate ${candidate.id}: ${errorMessage(error)}`);}
  }
  ranked.sort((a,b)=>b.score-a.score);const chosen=ranked[0];
  if(!chosen){result.warnings.push(`${slide.id}: no suitable real photograph available; build must use a no-image layout`);continue;}
  const {width,height}=imageSize(slide.layout);const processedPath=path.join(folder,`${slide.id}-${slide.gradient.mode}.png`);
  try{
   const crop=await blendImage(chosen.file,processedPath,{...slide.gradient,targetWidth:width,targetHeight:height,focalPoint:slide.image.focalPoint});
   const asset:PhotoAsset={slideId:slide.id,provider:chosen.candidate.provider,url:chosen.candidate.url,author:chosen.candidate.author,
    authorUrl:chosen.candidate.authorUrl,license:chosen.candidate.license,licenseUrl:chosen.candidate.licenseUrl,downloadPath:chosen.file,
    processedPath,width:chosen.composition.width,height:chosen.composition.height,query:slide.image.query,score:chosen.score,
    analysis:{...chosen.composition,method:'Lexical/API relevance, edge-energy saliency and quiet-space proxies, aspect ratio, resolution and mean-RGB palette distance. No semantic subject or license verification.',manualReviewRequired:true},crop};
   result.assets.push(asset);palette=chosen.composition.meanRGB;
   if((crop.retainedArea as number)<.45)result.warnings.push(`${slide.id}: crop retains less than 45% of source area; review subject framing or set focalPoint/use another layout`);
  }catch(error){result.warnings.push(`${slide.id}: image blend failed: ${errorMessage(error)}; build must use a no-image layout`);}
 }
 await writeFile(path.resolve(outDir,'assets.json'),JSON.stringify(result,null,2),'utf8');return result;
}
