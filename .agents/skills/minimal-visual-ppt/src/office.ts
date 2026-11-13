import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {createHash} from 'node:crypto';
import type { Config, DeckPlan } from './types.js';
import {clearPreviews} from './state.js';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
export interface BackendReport {status:'passed'|'failed'|'unavailable'|'disabled'; backend?:string; errors?:string[]; warnings?:string[]; reason?:string; [key:string]:any}
export async function sourceSha256(file:string):Promise<string>{return createHash('sha256').update(await fs.readFile(file)).digest('hex');}

async function invoke(script:string,args:string[],reportPath:string,config:Config):Promise<BackendReport> {
 await fs.mkdir(path.dirname(reportPath),{recursive:true});
 // Remove stale results before a new process so timeouts cannot masquerade as success.
 await fs.rm(reportPath,{force:true});
 let processError:string|undefined;
 await new Promise<void>(resolve=>{
   const proc=spawn(config.python,[path.join(scripts,script),...args,'--report',reportPath],{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let stderr='';
   proc.stdout.on('data',()=>{}); proc.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000)});
   const timer=setTimeout(()=>{processError='PowerPoint backend exceeded its time limit';proc.kill();},Math.max(config.timeoutMs,120_000));
   proc.on('error',error=>{processError=error.message;clearTimeout(timer);resolve()});
   proc.on('close',code=>{clearTimeout(timer);if(code!==0&&!processError)processError=stderr||`Backend exited with code ${code}`;resolve()});
 });
 let report:BackendReport;
 try {report=JSON.parse(await fs.readFile(reportPath,'utf8'));}
 catch {report={status:'unavailable',reason:processError||'Backend produced no report',errors:[]};await fs.writeFile(reportPath,JSON.stringify(report,null,2));}
 return report;
}

export async function animateDeck(plan:DeckPlan,pptxPath:string,config:Config,outDir:string):Promise<BackendReport> {
 outDir=path.resolve(outDir);pptxPath=path.resolve(pptxPath);
 await fs.mkdir(outDir,{recursive:true});
 const reportPath=path.join(outDir,'animation-report.json');
 if(!config.animate){const r:BackendReport={status:'disabled',reason:'Native animation disabled by configuration'};await fs.writeFile(reportPath,JSON.stringify(r,null,2));return r;}
 const planPath=path.join(outDir,'animation-plan.json');await fs.writeFile(planPath,JSON.stringify(plan,null,2));
 return invoke('office_backend.py',['animate','--input',pptxPath,'--output',pptxPath,'--plan',planPath],reportPath,config);
}

export async function inspectDeck(pptxPath:string,config:Config,outDir:string,fix=true):Promise<BackendReport> {
 return invoke('office_backend.py',['inspect','--input',path.resolve(pptxPath),...(fix?['--fix']:[])],path.resolve(outDir,'office-inspection.json'),config);
}

export async function renderDeck(pptxPath:string,config:Config,outDir:string):Promise<BackendReport> {
 await clearPreviews(outDir);
 const reportPath=path.resolve(outDir,'render-report.json');
 if(!config.render){const r:BackendReport={status:'disabled',reason:'Preview rendering disabled by configuration'};await fs.mkdir(outDir,{recursive:true});await fs.writeFile(reportPath,JSON.stringify(r,null,2));return r;}
 let digest:string;
 try{digest=await sourceSha256(pptxPath);}
 catch(error){
   const report:BackendReport={status:'failed',errors:[`PPTX source cannot be read for rendering: ${String(error)}`],sourcePath:path.resolve(pptxPath)};
   await fs.mkdir(outDir,{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2));return report;
 }
 async function finish(report:BackendReport):Promise<BackendReport>{
   report.sourceSha256=digest;report.sourcePath=path.resolve(pptxPath);report.renderedAt=new Date().toISOString();
   if(report.status==='passed'&&await sourceSha256(pptxPath)!==digest){
     report.status='failed';report.errors=[...(report.errors||[]),'PPTX source changed during preview rendering; rerun render'];
     await clearPreviews(outDir);
   }
   await fs.writeFile(reportPath,JSON.stringify(report,null,2));return report;
 }
 const output=path.resolve(outDir,'previews');
 const com=await invoke('office_backend.py',['render','--input',path.resolve(pptxPath),'--output',output],reportPath,config);
 if(com.status==='passed'||com.status==='failed')return finish(com);
 const fallback=await invoke('render_fallback.py',['--input',path.resolve(pptxPath),'--output',output,...(config.soffice?['--soffice',config.soffice]:[])],reportPath,config);
 fallback.warnings=[...(fallback.warnings||[]),`PowerPoint COM unavailable: ${com.reason||'unknown reason'}`];
 return finish(fallback);
}
