import type {ImageCandidate,ImageProvider} from './types.js';

export class PexelsProvider implements ImageProvider {
 name='pexels';
 constructor(private apiKey:string,private timeoutMs=15000){}
 async search(query:string,keywords:string[],orientation:'landscape'|'portrait'='landscape'):Promise<ImageCandidate[]>{
  if(!this.apiKey)throw new Error('PEXELS_API_KEY is not configured');
  if(!query.trim())return [];
  const url=new URL('https://api.pexels.com/v1/search');
  url.search=new URLSearchParams({query,orientation,per_page:'8',size:'large'}).toString();
  const response=await fetch(url,{headers:{Authorization:this.apiKey},signal:AbortSignal.timeout(this.timeoutMs)});
  if(!response.ok)throw new Error(`Pexels search failed (HTTP ${response.status})`);
  const data=await response.json() as {photos?:{id:number;url:string;photographer:string;photographer_url:string;width:number;height:number;alt?:string;src:{large2x?:string;original?:string;large?:string}}[]};
  if(!Array.isArray(data.photos))throw new Error('Pexels API returned no valid photos array');
  return data.photos.flatMap(photo=>{
   const downloadUrl=photo.src?.large2x||photo.src?.large||photo.src?.original;
   if(!downloadUrl||!photo.url||!photo.photographer)return [];
   return [{id:String(photo.id),provider:'pexels',url:photo.url,author:photo.photographer,authorUrl:photo.photographer_url,
    license:'Pexels License',licenseUrl:'https://www.pexels.com/license/',downloadUrl,width:photo.width,height:photo.height,
    keywords:[...keywords,photo.alt||''],relevance:.8}];
  });
 }
}
