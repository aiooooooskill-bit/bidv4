import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {assertInstallation,assertStopped} from '../server/installation.mjs';
const directory=resolve(process.argv[2]??fileURLToPath(new URL('..',import.meta.url)));
const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(pkg.name!=='ooo-bidpliot')throw new Error('请选择 ooo-bidpliot 插件目录');
await assertStopped(directory);
async function run(program,args){await new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd:directory,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(program+' 准备失败（退出 '+code+'）')))})}
await run('npm',['ci','--no-fund','--no-audit']);
await run('npm',['run','check']);
await run(process.execPath,[join(directory,'scripts/build.mjs')]);
await assertInstallation(directory);
console.log('ooo-bidpliot 固定目录准备完成，可通过 dsh 官方本地目录安装');
