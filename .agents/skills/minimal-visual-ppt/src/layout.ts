import type { Layout } from './types.js';

export const PAGE={w:13.333333,h:7.5};
export interface Box{x:number;y:number;w:number;h:number}
export const IMAGE_BOXES:Partial<Record<Layout,Box>>={
  L01:{x:6.1,y:0,w:PAGE.w-6.1,h:PAGE.h},
  L02:{x:0,y:0,w:7.233333,h:PAGE.h},
  L03:{x:0,y:3,w:PAGE.w,h:4.5},
  L05:{x:0,y:0,w:PAGE.w,h:PAGE.h}
};

/** Authoritative text regions shared by the planner and PowerPoint builder. */
export function contentBoxes(layout:Layout,type:string,hasData=false):{title:Box;body:Box;titleSize:number;bodySize:number;titleMin:number}{
  if(layout==='L01'||layout==='L02'){
    const x=layout==='L01'?.75:7.7;const w=layout==='L01'?5.1:4.88;
    return {title:{x,y:1.05,w,h:1.5},body:{x,y:3.2,w,h:3.35},titleSize:38,titleMin:24,bodySize:21};
  }
  if(layout==='L03')return {title:{x:.75,y:.8,w:11.8,h:.78},body:{x:.75,y:1.83,w:11.6,h:1.02},titleSize:34,titleMin:22,bodySize:20};
  if(layout==='L05')return {title:{x:1,y:1.68,w:5.25,h:1.5},body:{x:1,y:3.7,w:5.25,h:2.35},titleSize:38,titleMin:24,bodySize:20};
  if(layout==='L06')return {title:{x:.75,y:.85,w:11.8,h:.9},body:hasData?{x:.75,y:1.95,w:11.65,h:1}:{x:.75,y:2.35,w:10.8,h:4.25},titleSize:34,titleMin:22,bodySize:hasData?18:22};
  const cover=type==='cover'||type==='closing';
  return {title:{x:.85,y:cover?1.5:1.1,w:10.8,h:1.45},body:{x:.85,y:cover?3.65:3.25,w:10.4,h:cover?2.8:3.35},titleSize:cover?44:38,titleMin:24,bodySize:23};
}

// CJK glyphs consume approximately a full em, Latin approximately .55 em.
// The 12% reserve handles punctuation, word boundaries and font substitutions.
export function lineCount(text:string,width:number,fontSize:number):number{
  const capacity=width*72/fontSize*.88;
  let lines=0;
  for(const paragraph of text.split('\n')){
    let used=0;let current=1;
    for(const ch of paragraph){
      const weight=/[\u0000-\u007f]/u.test(ch)?(/[MW@%]/.test(ch)?.9:.56):1;
      if(used+weight>capacity){current++;used=0;}
      used+=weight;
    }
    lines+=current;
  }
  return Math.max(1,lines);
}

export function textSize(text:string,box:Box,max=36,min=16):number{
  for(let size=max;size>=min;size--){
    if(lineCount(text,box.w,size)*size/72*1.32+.05<=box.h)return size;
  }
  throw new Error(`Text cannot fit in ${box.w.toFixed(2)} × ${box.h.toFixed(2)} inches. Use pagination; content is preserved: ${text.slice(0,60)}`);
}

export function bodyBoxes(texts:string[],box:Box,max=22,min=16):{box:Box;size:number}[]{
  if(!texts.length)return [];
  const gap=texts.length>3?.18:.22;
  for(let size=max;size>=min;size--){
    const heights=texts.map(text=>lineCount(text,box.w,size)*size/72*1.38+.07);
    if(heights.reduce((a,b)=>a+b,0)+gap*(texts.length-1)<=box.h){
      let y=box.y;
      return heights.map(h=>{const result={box:{x:box.x,y,w:box.w,h},size};y+=h+gap;return result;});
    }
  }
  throw new Error(`Body cannot fit: ${texts.length} paragraphs in ${box.h.toFixed(2)} inches. Use pagination; no text was discarded.`);
}
