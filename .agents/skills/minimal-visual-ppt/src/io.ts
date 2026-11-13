import fs from 'node:fs/promises';
import path from 'node:path';
export async function writeJson(file:string,value:unknown){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n','utf8');}
export async function readJson<T=unknown>(file:string):Promise<T>{try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')) as T;}catch(e){throw new Error(`Cannot read JSON ${file}: ${(e as Error).message}`);}}
