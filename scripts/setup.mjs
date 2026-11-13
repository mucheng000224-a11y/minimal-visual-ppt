/** Installs project dependencies, including hosts whose Node distribution omits npm. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const version='11.6.2';
async function main(){
 const folder=path.join(root,'work/tools/npm-bootstrap');await fs.mkdir(folder,{recursive:true});
 const response=await fetch(`https://registry.npmjs.org/npm/${version}`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`npm metadata HTTP ${response.status}`);
 const meta=await response.json();const archive=await fetch(meta.dist.tarball,{signal:AbortSignal.timeout(120000)});if(!archive.ok)throw new Error(`npm archive HTTP ${archive.status}`);
 const bytes=Buffer.from(await archive.arrayBuffer());
 const actual='sha512-'+createHash('sha512').update(bytes).digest('base64');if(actual!==meta.dist.integrity)throw new Error('npm archive integrity mismatch');
 const tarball=path.join(folder,'npm.tgz');await fs.writeFile(tarball,bytes);
 const extraction=spawnSync('tar',['-xzf',tarball,'-C',folder],{stdio:'inherit',windowsHide:true});if(extraction.status!==0)throw new Error('tar extraction failed; install a normal Node.js distribution including npm');
 const cli=path.join(folder,'package/bin/npm-cli.js');
 const install=spawnSync(process.execPath,[cli,'install','--no-fund','--no-audit'],{cwd:root,stdio:'inherit',windowsHide:true});if(install.status!==0)throw new Error('Dependency install failed');
 console.log(`Dependencies installed. On hosts without npm, use:\nnode "${cli}" run deck -- --input examples/course-report.md --output outputs/course-report\nOr: node .agents/skills/minimal-visual-ppt/scripts/run.mjs --help`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
