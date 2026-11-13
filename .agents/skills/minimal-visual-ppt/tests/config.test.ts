import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../src/config.js';

test('configuration applies explicit overrides and resolves catalogue paths relative to its file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-config-'));
 try{
  const file=path.join(dir,'settings.json');await fs.writeFile(file,JSON.stringify({provider:'local',localAssets:'素材/manifest.json',animate:false,render:false,timeoutMs:1234}));
  const result=await loadConfig(file,{timeoutMs:2345});
  assert.equal(result.provider,'local');assert.equal(result.timeoutMs,2345);assert.equal(result.animate,false);assert.equal(result.render,false);
  assert.equal(result.localAssets,path.join(dir,'素材','manifest.json'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('configuration rejects invalid providers, limits and boolean values',async()=>{
 await assert.rejects(()=>loadConfig(undefined,{provider:'unknown'} as any),/provider/i);
 await assert.rejects(()=>loadConfig(undefined,{timeoutMs:0}),/timeout/i);
 await assert.rejects(()=>loadConfig(undefined,{maxImageBytes:12}),/size/i);
 for(const key of ['animate','render','strict'])await assert.rejects(()=>loadConfig(undefined,{[key]:'false'} as any),/boolean/);
});

test('configuration rejects non-string executables before spawning a backend',async()=>{
 await assert.rejects(()=>loadConfig(undefined,{python:42} as any),/python.*string|executable.*string/i);
});
