import fs from 'node:fs/promises';
import path from 'node:path';
/** Removes only known generated artifacts, never the output directory or source material. */
export async function clearPreviews(outDir:string){
 const root=path.resolve(outDir),dir=path.join(root,'previews');
 let names:string[]=[];try{names=await fs.readdir(dir);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 for(const name of names.filter(n=>/^slide-\d+\.png$/i.test(n)))await fs.rm(path.join(dir,name),{force:true});
 for(const name of ['index.html','contact-sheet.png'])await fs.rm(path.join(root,name),{force:true});
}
export async function invalidateAfterBuild(outDir:string){
 await clearPreviews(outDir);
 for(const name of ['animation-report.json','animation-plan.json','render-report.json','office-inspection.json','qa-report.json','qa-report.md','run-report.json'])await fs.rm(path.join(path.resolve(outDir),name),{force:true});
}
