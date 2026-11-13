import path from 'node:path';
import {config as envConfig} from 'dotenv';
import {readJson} from './io.js';
import type {Config} from './types.js';
envConfig({quiet:true});
export async function loadConfig(file?:string, overrides:Partial<Config>={}):Promise<Config>{
 const raw=file?await readJson<Partial<Config>>(file):{};
 const result:Config={provider:'pexels',python:process.env.MVP_PYTHON||'python',localAssets:process.env.MVP_LOCAL_ASSETS||undefined,pexelsApiKey:process.env.PEXELS_API_KEY,soffice:process.env.MVP_SOFFICE||undefined,timeoutMs:20000,maxImageBytes:20*1024*1024,animate:true,render:true,strict:false,...raw,...overrides};
 for(const key of ['python','localAssets','soffice','pexelsApiKey'] as const)if(result[key]!==undefined&&typeof result[key]!=='string')throw new Error(`Config ${key} must be a string`);
 if(!['pexels','local','none'].includes(result.provider))throw new Error('Invalid provider; use pexels, local or none');
 if(!Number.isFinite(result.timeoutMs)||result.timeoutMs<100||!Number.isFinite(result.maxImageBytes)||result.maxImageBytes<1024)throw new Error('Invalid image timeout or size limit');
 for(const key of ['animate','render','strict'] as const)if(typeof result[key]!=='boolean')throw new Error(`Config ${key} must be boolean`);
 if(!result.python)throw new Error('Config python executable is empty');
 if(result.localAssets)result.localAssets=path.resolve(file?path.dirname(file):process.cwd(),result.localAssets);
 return result;
}
