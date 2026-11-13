import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {makePreviewIndex} from '../src/preview.js';
test('preview index follows current successful render evidence and hides stale or disabled previews',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-preview-'));await fs.mkdir(path.join(dir,'previews'));
 try{
  for(const n of ['001','002'])await sharp({create:{width:160,height:90,channels:3,background:'white'}}).png().toFile(path.join(dir,'previews',`slide-${n}.png`));
  await fs.writeFile(path.join(dir,'render-report.json'),JSON.stringify({status:'passed',files:[path.join(dir,'previews/slide-001.png')]}));
  await makePreviewIndex(dir);const html=await fs.readFile(path.join(dir,'index.html'),'utf8');assert.ok(!html.includes('slide-002.png'));
  await fs.writeFile(path.join(dir,'render-report.json'),JSON.stringify({status:'disabled'}));await makePreviewIndex(dir);
  await assert.rejects(fs.access(path.join(dir,'index.html')));await assert.rejects(fs.access(path.join(dir,'contact-sheet.png')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
