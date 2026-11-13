export interface ImageCandidate {
 id:string; provider:string; url:string; author:string; authorUrl?:string; license:string; licenseUrl?:string;
 downloadUrl?:string; localPath?:string; width?:number; height?:number; keywords:string[]; relevance:number;
}
/** Replace this small interface to integrate another stock library or an approved local catalogue. */
export interface ImageProvider {name:string; search(query:string,keywords:string[],orientation?:'landscape'|'portrait'):Promise<ImageCandidate[]>}

export function tokens(query:string,keywords:string[]):string[]{
 return [...new Set([...keywords,...query.toLowerCase().split(/[\s,，、;；/]+/u)].map(x=>x.trim().toLowerCase()).filter(x=>x.length>1))];
}

export function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}
