import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {tokens,type ImageCandidate,type ImageProvider} from './types.js';

interface LocalEntry {path?:string;localPath?:string;keywords?:string[];author?:string;authorUrl?:string;url?:string;license?:string;licenseUrl?:string}

export class LocalProvider implements ImageProvider {
 name='local';
 constructor(private manifestPath:string){}
 async search(query:string,keywords:string[]):Promise<ImageCandidate[]>{
  const parsed:unknown=JSON.parse(await readFile(this.manifestPath,'utf8'));
  const entries=Array.isArray(parsed)?parsed:(parsed as {assets?:unknown})?.assets;
  if(!Array.isArray(entries))throw new Error('Local asset manifest must be an array or {assets: [...]}');
  const wanted=tokens(query,keywords);
  return entries.flatMap((entry:LocalEntry,index:number)=>{
   if(!entry||typeof entry!=='object')return [];
   const file=entry.localPath??entry.path;if(typeof file!=='string'||!file.trim())return [];
   const tags=Array.isArray(entry.keywords)?entry.keywords.filter(x=>typeof x==='string'):[];
   // Filename contributes only when there are no catalogue tags; explicit tags are the authority.
   const haystack=(tags.length?tags.join(' '):path.basename(file)).toLowerCase();
   const hits=wanted.filter(word=>haystack.includes(word)||tags.some(tag=>word.includes(tag.toLowerCase()))).length;
   if(!hits)return [];
   const localPath=path.resolve(path.dirname(this.manifestPath),file);
   return [{id:`local-${index}`,provider:'local',url:entry.url||pathToFileURL(localPath).href,
    author:entry.author||'User-provided material; author not specified',authorUrl:entry.authorUrl,
    license:entry.license||'User-provided material; rights must be confirmed by user',licenseUrl:entry.licenseUrl,
    localPath,keywords:tags,relevance:Math.min(1,hits/Math.max(1,wanted.length))}];
  });
 }
}

export function explicitLocalCandidate(file:string):ImageCandidate{
 const localPath=path.resolve(file);
 return {id:'user-provided',provider:'local',url:pathToFileURL(localPath).href,author:'User-provided material; author not specified',license:'User-provided material; rights must be confirmed by user',localPath,keywords:[],relevance:1};
}
