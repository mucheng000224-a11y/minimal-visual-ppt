import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const escape=(x:string)=>x.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function makePreviewIndex(outDir:string){
 const dir=path.resolve(outDir,'previews');let files:string[]=[];
 try{
  const report=JSON.parse(await fs.readFile(path.join(outDir,'render-report.json'),'utf8'));
  if(report.status==='passed'&&Array.isArray(report.files))files=report.files.map((file:string)=>{const full=path.resolve(file);if(path.dirname(full)!==dir||!/^slide-\d+\.png$/i.test(path.basename(full)))throw new Error('Render report contains an invalid preview path');return path.basename(full);});
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(!files.length){for(const name of ['index.html','contact-sheet.png'])await fs.rm(path.join(outDir,name),{force:true});return;}
 const thumbs=await Promise.all(files.map(async(f,i)=>({input:await sharp(path.join(dir,f)).resize(480,270,{fit:'contain',background:'#F6F4EF'}).png().toBuffer(),left:(i%3)*500+10,top:Math.floor(i/3)*300+10})));
 await sharp({create:{width:1500,height:Math.ceil(files.length/3)*300,channels:3,background:'#E4E5E0'}}).composite(thumbs).png().toFile(path.join(outDir,'contact-sheet.png'));
 const html=`<!doctype html><meta charset="utf-8"><title>PowerPoint previews</title><style>body{font:16px system-ui;background:#f6f4ef;color:#263332;margin:40px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:32px}img{width:100%;box-shadow:0 2px 14px #0001}figure{margin:0}figcaption{padding:10px 0}a{color:#52776c}</style><h1>PowerPoint previews</h1><p><a href="deck.pptx">PowerPoint</a> · <a href="qa-report.json">Quality report</a> · <a href="assets.json">Photo sources</a></p><main>${files.map((f,i)=>`<figure><a href="previews/${escape(f)}"><img src="previews/${escape(f)}" alt="Slide ${i+1}"></a><figcaption>${i+1}</figcaption></figure>`).join('')}</main>`;
 await fs.writeFile(path.join(outDir,'index.html'),html,'utf8');
}
