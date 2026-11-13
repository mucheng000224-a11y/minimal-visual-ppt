import fs from 'node:fs/promises';
import path from 'node:path';
import pptxgen from 'pptxgenjs';
import sharp from 'sharp';
import type { AssetManifest,BuildManifest,DeckPlan,ObjectRecord,SlidePlan,Layout } from './types.js';
import { PAGE,IMAGE_BOXES,bodyBoxes,textSize,contentBoxes,type Box } from './layout.js';
import {validatePlan} from './plan.js';
import {invalidateAfterBuild} from './state.js';

/** Creates a new package for every call; does not mutate the supplied plan. */
export async function buildDeck(plan:DeckPlan,assets:AssetManifest,outDir:string):Promise<BuildManifest>{
  validatePlan(plan);
  await fs.mkdir(outDir,{recursive:true});
  // PptxGenJS publishes CommonJS declarations alongside an ES export. NodeNext
  // sees a synthetic default namespace; its .default type is the constructor.
  const Constructor=pptxgen as unknown as typeof pptxgen.default;
  const pptx=new Constructor();
  pptx.defineLayout({name:'EDITORIAL_WIDE',width:PAGE.w,height:PAGE.h});
  pptx.layout='EDITORIAL_WIDE';
  pptx.author='minimal-visual-ppt';pptx.subject='Minimal editorial presentation';pptx.title=plan.title;
  pptx.company='';
  pptx.theme={headFontFace:plan.style.fontFace,bodyFontFace:plan.style.fontFace};
  const manifest:BuildManifest={version:'1.0',pptxPath:path.resolve(outDir,'deck.pptx'),slides:[],repairs:[],warnings:[]};
  const names=new Set<string>();
  for(let index=0;index<plan.slides.length;index++){
    const item=plan.slides[index];
    const photo=assets.assets.find(a=>a.slideId===item.id);
    let layout:Layout=item.layout;
    if(IMAGE_BOXES[layout]&&!photo){
      layout='L04';manifest.repairs.push(`${item.id}: ${item.layout} → L04 because no suitable photograph is available.`);
    }
    // A missing photo must not reduce the available paragraph height. A cover
    // planned for a side photograph therefore uses the normal text-page region.
    const displayType=layout==='L04'&&item.layout!=='L04'?'content':item.type;
    const slide=pptx.addSlide();slide.background={color:plan.style.background};
    const objects:ObjectRecord[]=[];
    const register=(suffix:string,kind:ObjectRecord['kind'],box:Box,extras:Partial<ObjectRecord>={})=>{
      const name=`${item.id}__${suffix}`;
      if(names.has(name))throw new Error(`Duplicate object name: ${name}`);
      if(box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>PAGE.w+.001||box.y+box.h>PAGE.h+.001)throw new Error(`Object out of page bounds: ${name}`);
      names.add(name);objects.push({name,slideId:item.id,kind,...box,...extras});return name;
    };
    const putText=(suffix:string,text:string,box:Box,max:number,min=16,options:Record<string,unknown>={})=>{
      const fontSize=textSize(text,box,max,min);
      const name=register(suffix,'text',box,{text,fontSize,fontFace:plan.style.fontFace,role:suffix});
      slide.addText(text,{...box,fontSize,fontFace:plan.style.fontFace,color:plan.style.foreground,
        margin:0,breakLine:false,valign:'top',fit:'shrink',
        lineSpacingMultiple:1.1,lang:plan.language,objectName:name,...options});
    };
    const putBody=(box:Box,max=22)=>{
      const fitted=bodyBoxes(item.body,box,max);
      item.body.forEach((text,i)=>putText(`body-${i+1}`,text,fitted[i].box,fitted[i].size,fitted[i].size));
    };
    const line=(suffix:string,x:number,y:number,w:number,h=0,color=plan.style.accent)=>{
      const safeH=Math.max(h,.001);
      const name=register(suffix,'shape',{x,y,w,h:safeH},{role:'rule'});
      slide.addShape(pptx.ShapeType.line,{x,y,w,h,line:{color,width:.7,transparency:25},objectName:name});
    };
    const imageBox=IMAGE_BOXES[layout];
    if(imageBox&&photo){
      const file=photo.processedPath||photo.downloadPath;
      await fs.access(file).catch(()=>{throw new Error(`Photograph missing for ${item.id}: ${file}`);});
      const metadata=await sharp(file).metadata();
      if(!metadata.width||!metadata.height)throw new Error(`Cannot read photograph dimensions: ${file}`);
      const name=register('image','image',imageBox,{role:'photograph'});
      // In v4, sizing uses options.w/h as the source aspect ratio, rather than
      // reading bitmap dimensions. Pass that ratio before asking for a cover crop.
      slide.addImage({path:file,x:imageBox.x,y:imageBox.y,w:imageBox.w,h:imageBox.w*metadata.height/metadata.width,
        sizing:{type:'cover',w:imageBox.w,h:imageBox.h},objectName:name,altText:`${item.image.query}; ${photo.author}; ${photo.license}`});
    }
    if(layout==='L05'){
      const box={x:.55,y:.8,w:6.45,h:5.95};
      const name=register('panel','shape',box,{role:'readability-panel'});
      slide.addShape(pptx.ShapeType.rect,{...box,objectName:name,line:{color:plan.style.background,transparency:100},fill:{color:plan.style.background,transparency:14}});
    }
    const left=layout==='L02'?7.7:layout==='L05'?1.0:.75;
    putText('folio',`${String(index+1).padStart(2,'0')}  /  ${String(plan.slides.length).padStart(2,'0')}`,
      {x:left,y:layout==='L05'?1.12:.36,w:1.2,h:.24},10,10,{color:plan.style.accent,charSpacing:1.4});
    const regions=contentBoxes(layout,displayType,!!item.data);
    putText('title',item.title,regions.title,regions.titleSize,regions.titleMin,{bold:true});
    putBody(regions.body,regions.bodySize);
    if(layout==='L01'||layout==='L02'){
      line('rule',left,2.87,.55);
    }else if(layout==='L05'){
      line('rule',1,3.43,.55);
    }else if(layout==='L06'){
      if(item.data)addData(item,{x:.9,y:3.17,w:11.55,h:3.5});
    }else if(layout==='L04'){
      const cover=displayType==='cover'||displayType==='closing';
      line('rule',.85,cover?3.25:2.85,.65);
    }
    const source=photo?`Photograph: ${photo.author}\nProvider: ${photo.provider}\nSource: ${photo.url}\nLicense: ${photo.license}${photo.licenseUrl?` (${photo.licenseUrl})`:''}\nLocal asset: ${photo.downloadPath}`:'No photograph used.';
    slide.addNotes([item.notes||'',`Slide ID: ${item.id}; layout: ${layout}`,source].join('\n\n'));
    manifest.slides.push({id:item.id,layout,objects});

    function addData(s:SlidePlan,box:Box){
      const data=s.data!;
      if(data.kind==='bar'){
        if(!data.values||data.values.length!==data.labels.length||!data.values.every(Number.isFinite))throw new Error(`${s.id}: bar labels and finite values must have equal lengths.`);
        const name=register('chart','chart',box,{role:'bar-data'});
        slide.addChart(pptx.ChartType.bar,[{name:data.unit||'Value',labels:data.labels,values:data.values}],{
          ...box,objectName:name,catAxisLabelFontFace:plan.style.fontFace,valAxisLabelFontFace:plan.style.fontFace,
          catAxisLabelFontSize:15,valAxisLabelFontSize:12,dataLabelFormatCode:`0${data.unit?'"'+data.unit+'"':''}`,
          showLegend:false,showValue:true,dataLabelPosition:'outEnd',dataLabelColor:plan.style.foreground,
          chartColors:[plan.style.accent],showTitle:false,
          catAxisLineShow:false,valAxisLineShow:false,catGridLine:{style:'none'},valGridLine:{color:'DFE1DA',size:.6},
          catAxisLabelColor:plan.style.foreground,valAxisLabelColor:'71756F',
          showPercent:false,showSerName:false,
          showLeaderLines:false,
          valAxisMinVal:data.values.every(v=>v>=0)?0:undefined,
          layout:{x:.08,y:.06,w:.84,h:.8},
        });
      }else if(data.kind==='process'){
        if(data.labels.length<1||data.labels.length>6)throw new Error(`${s.id}: process needs 1–6 steps; split longer processes.`);
        const n=data.labels.length;const cell=box.w/n;
        line('process-rule',box.x,box.y+.57,box.w-.15);
        data.labels.forEach((label,i)=>{
          const x=box.x+i*cell;
          putText(`step-number-${i+1}`,String(i+1).padStart(2,'0'),{x,y:box.y,w:cell-.25,h:.46},20,20,{color:plan.style.accent});
          putText(`step-${i+1}`,label,{x,y:box.y+.94,w:cell-.3,h:1.85},21,16,{bold:true});
        });
      }else{
        if(data.labels.length<2||data.labels.length>4)throw new Error(`${s.id}: comparison needs 2–4 columns.`);
        const n=data.labels.length;const cell=box.w/n;
        data.labels.forEach((label,i)=>{
          const x=box.x+i*cell;
          if(i)line(`comparison-rule-${i}`,x-.2,box.y,.001,box.h-.1,'D3D8CE');
          putText(`column-title-${i+1}`,label,{x,y:box.y,w:cell-.45,h:.65},24,18,{color:plan.style.accent,bold:true});
          const values=data.columns?.[i]||[];
          const fitted=bodyBoxes(values,{x,y:box.y+.95,w:cell-.45,h:box.h-1.05},19);
          values.forEach((value,j)=>putText(`column-${i+1}-row-${j+1}`,value,fitted[j].box,fitted[j].size,fitted[j].size));
        });
      }
    }
  }
  await pptx.writeFile({fileName:manifest.pptxPath});
  await invalidateAfterBuild(outDir);
  await fs.writeFile(path.join(outDir,'build-manifest.json'),JSON.stringify(manifest,null,2),'utf8');
  return manifest;
}
