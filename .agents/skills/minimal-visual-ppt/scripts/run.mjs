#!/usr/bin/env node
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
try {
 const result=spawnSync(process.execPath,[require.resolve('tsx/cli'),fileURLToPath(new URL('../src/cli.ts',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;process.exit(result.status??1);
}catch(e){console.error(`Cannot start minimal-visual-ppt: ${e.message}. Run npm install in the skill folder or workspace first.`);process.exit(1);}
