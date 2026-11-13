#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import {Command} from 'commander';
import {loadConfig} from './config.js';
import {readJson,writeJson} from './io.js';
import {readInput} from './input.js';
import {validatePlan} from './plan.js';
import {processImages} from './images.js';
import {buildDeck} from './build.js';
import {animateDeck,renderDeck} from './office.js';
import {checkDeck} from './qa.js';
import {makePreviewIndex} from './preview.js';
import type {DeckPlan,AssetManifest,BuildManifest,Config} from './types.js';

type Options={input?:string;output:string;plan?:string;assets?:string;config?:string;provider?:Config['provider'];localAssets?:string;python?:string;animate?:boolean;render?:boolean;strict?:boolean};
const program=new Command().name('minimal-visual-ppt').description('Create editable Minimal Editorial PowerPoint decks locally.').version('1.0.0').enablePositionalOptions();
function options(command:Command){return command.option('-i, --input <file>','MD/TXT/DOCX/PDF/PPTX or validated JSON plan').option('-o, --output <directory>','Output directory','outputs/deck').option('--plan <file>','Existing deck-plan.json').option('--assets <file>','Existing assets.json').option('--config <file>','JSON configuration').option('--provider <provider>','pexels, local or none').option('--local-assets <file>','Local photograph catalogue').option('--python <executable>','Python executable').option('--no-animate','Generate static PPTX only').option('--no-render','Skip preview rendering (reported unavailable)').option('--strict','Require available animation/render backends and passing QA');}
async function configFor(o:Options){const overrides:Partial<Config>={};for(const k of ['provider','localAssets','python','strict'] as const)if(o[k]!==undefined)(overrides as any)[k]=o[k];if(o.animate===false)overrides.animate=false;if(o.render===false)overrides.render=false;return loadConfig(o.config,overrides);}
async function getPlan(o:Options,config:Config){
 if(o.plan||o.input){return readInput(o.plan||o.input!,config);}
 const p=await readJson<DeckPlan>(path.join(o.output,'deck-plan.json'));validatePlan(p);return p;
}
async function assetsFor(o:Options){return readJson<AssetManifest>(o.assets||path.join(o.output,'assets.json'));}
async function run(stage:string,o:Options){
 const out=path.resolve(o.output);o.output=out;await fs.mkdir(out,{recursive:true});const config=await configFor(o);
 const report:any={stage,startedAt:new Date().toISOString(),output:out,status:'running'};
 try{
  if(stage==='render'){report.render=await renderDeck(path.join(out,'deck.pptx'),config,out);await makePreviewIndex(out);}
  else {
   const plan=await getPlan(o,config);
   if(stage==='plan'||stage==='generate')await writeJson(path.join(out,'deck-plan.json'),plan);
   if(stage==='plan'){report.slides=plan.slides.length;}
   else if(stage==='images')report.assets=await processImages(plan,config,out);
   else if(stage==='animate')report.animation=await animateDeck(plan,path.join(out,'deck.pptx'),config,out);
   else if(stage==='build')report.build=await buildDeck(plan,await assetsFor(o),out);
   else if(stage==='qa')report.qa=await checkDeck(plan,await assetsFor(o),await readJson<BuildManifest>(path.join(out,'build-manifest.json')),config,out);
   else{
    console.log(`Planning ${plan.slides.length} slides…`);
    const assets=await processImages(plan,config,out);console.log(`Prepared ${assets.assets.length} photographs.`);
    const build=await buildDeck(plan,assets,out);console.log('Built editable deck.pptx.');
    report.animation=await animateDeck(plan,build.pptxPath,config,out);
    report.render=await renderDeck(build.pptxPath,config,out);
    report.qa=await checkDeck(plan,assets,build,config,out);
    await makePreviewIndex(out);report.slides=plan.slides.length;
   }
  }
  const qa=report.qa;
  if(qa?.status==='failed'||qa?.passed===false||qa?.errors?.length||report.animation?.status==='failed'||report.render?.status==='failed'){process.exitCode=2;}
  if(config.strict){
   for(const key of ['animation','render'])if((key==='animation'?config.animate:config.render)&&report[key]&&(!['passed','completed','success','verified'].includes(report[key].status))){console.error(`Strict mode: ${key} status ${report[key].status}`);process.exitCode=2;}
  }
  report.status=process.exitCode===2?'failed':'completed';report.finishedAt=new Date().toISOString();
  await writeJson(path.join(out,stage==='generate'?'run-report.json':`${stage}-run.json`),report);
  console.log(`${stage}: ${out}`);
 }catch(error){report.status='failed';report.error=(error as Error).message;await writeJson(path.join(out,`${stage}-error.json`),report);throw error;}
}
options(program).action(o=>run('generate',o));
for(const [stage,description] of [['generate','Run planning, images, build, animation, render and QA'],['plan','Extract content and create validated deck-plan.json'],['images','Retrieve, select and blend real photographs'],['build','Build native editable PPTX from plan and assets'],['animate','Add native Office animation and verify saved targets'],['render','Render actual slide previews using PowerPoint or LibreOffice'],['qa','Inspect PPTX, provenance, object bounds and backend evidence']] as const){options(program.command(stage).description(description)).action(o=>run(stage,o));}
program.parseAsync(process.argv).catch(error=>{console.error(`Error: ${(error as Error).message}`);process.exitCode=1;});
