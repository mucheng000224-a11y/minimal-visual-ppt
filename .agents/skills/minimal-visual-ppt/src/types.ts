export type Layout = 'L01'|'L02'|'L03'|'L04'|'L05'|'L06';
export type FadeMode = 'fade-left'|'fade-right'|'fade-top'|'soft-overlay';
export interface Gradient {mode:FadeMode; width:number; opacity:number; position:number}
export interface Animation {target:string; effect:'fade'|'float'; trigger:'on-click'|'with-previous'|'after-previous'; duration:number; delay:number}
export interface SlidePlan {
  id:string; type:'cover'|'content'|'data'|'process'|'comparison'|'closing'; title:string; body:string[];
  layout:Layout; image:{required:boolean; query:string; keywords:string[]; localPath?:string; focalPoint?:{x:number;y:number}};
  gradient:Gradient; animations:Animation[];
  data?:{kind:'bar'|'process'|'comparison'; labels:string[]; values?:number[]; unit?:string; columns?:string[][]};
  notes?:string;
}
export interface DeckPlan {
  schemaVersion:'1.0'; title:string; language:string; source:string; warnings:string[];
  style:{background:string; foreground:string; accent:string; fontFace:string}; slides:SlidePlan[];
}
export interface PhotoAsset {
  slideId:string; provider:string; url:string; author:string; authorUrl?:string; license:string; licenseUrl?:string;
  downloadPath:string; processedPath?:string; width:number; height:number; query:string;
  score?:number; analysis?:Record<string,unknown>; crop?:Record<string,unknown>;
}
export interface AssetManifest {version:'1.0'; assets:PhotoAsset[]; warnings:string[]}
export interface ObjectRecord {name:string; slideId:string; kind:'text'|'image'|'shape'|'chart'; x:number;y:number;w:number;h:number; text?:string; fontSize?:number; fontFace?:string; role?:string}
export interface BuildManifest {version:'1.0'; pptxPath:string; slides:{id:string; layout:Layout; objects:ObjectRecord[]}[]; repairs:string[]; warnings:string[]}
export interface Config {
  provider:'pexels'|'local'|'none'; pexelsApiKey?:string; localAssets?:string; python:string; soffice?:string;
  timeoutMs:number; maxImageBytes:number; animate:boolean; render:boolean; strict:boolean;
}
