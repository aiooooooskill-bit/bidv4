import {cp,mkdir,mkdtemp,readFile,readdir,lstat,rename,rm,writeFile} from 'node:fs/promises';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {assertInstallation,assertStopped} from '../server/installation.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const excluded=new Set(['data','backups','node_modules','.venv','__pycache__','.pytest_cache','.git','.DS_Store']);
async function absent(path){try{await lstat(path);throw new Error('目标目录已经存在：'+path)}catch(error){if(error.code!=='ENOENT')throw error}}
async function copyDelivery(source,target){
 const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));if(pkg.name!=='ooo-bidpliot'||!Array.isArray(pkg.files))throw new Error('交付来源缺少 ooo-bidpliot 文件白名单');
 for(const item of ['package.json','package-lock.json',...pkg.files]){
  if(item.includes('..')||item.includes('*')||excluded.has(item.split('/')[0]))throw new Error('不允许的交付文件规则：'+item);
  await cp(join(source,item),join(target,item),{recursive:true,dereference:false,filter:async path=>{const rel=relative(source,path),parts=rel.split(sep);if(parts.some(p=>excluded.has(p))||rel.endsWith('.pyc')||rel.endsWith('.bak')||rel.endsWith('.db'))return false;if((await lstat(path)).isSymbolicLink())throw new Error('交付源码不允许符号链接：'+rel);return true}});
 }
 const files=[];
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else files.push(relative(target,path))}}await walk(target);
 await writeFile(join(target,'delivery-files.json'),JSON.stringify({name:pkg.name,version:pkg.version??null,files:files.sort()},null,2)+'\n');
}
async function run(program,args,cwd){await new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(program+' 更新准备失败（退出 '+code+'）')))})}
const [command,sourceArg,targetArg]=process.argv.slice(2);
if(command==='export'){
 if(!sourceArg)throw new Error('用法：node scripts/delivery.mjs export <新交付目录>');const target=resolve(sourceArg);if(target===root||target.startsWith(join(root,'data')+sep))throw new Error('不能导出到源码根或用户数据目录');await absent(target);await mkdir(target,{recursive:true});
 try{await copyDelivery(root,target);console.log('无版本本地目录已导出：'+target)}catch(error){await rm(target,{recursive:true,force:true});throw error}
}else if(command==='update'){
 if(!sourceArg||!targetArg)throw new Error('用法：node scripts/delivery.mjs update <干净交付来源> <固定安装目录>');
 const source=resolve(sourceArg),target=resolve(targetArg);if(source===target||source.startsWith(target+sep)||target.startsWith(source+sep))throw new Error('更新来源与安装目录必须互相独立');
 const existing=JSON.parse(await readFile(join(target,'package.json'),'utf8'));if(existing.name!=='ooo-bidpliot')throw new Error('更新目标不是 ooo-bidpliot 插件');await assertStopped(target);
 const stage=await mkdtemp(join(dirname(target),'.ooo-bidpliot-next-')),backup=target+'.previous-'+Date.now();let oldMoved=false,dataMoved=false,committed=false,safeToRemoveStage=true;
 try{
  await copyDelivery(source,stage);await run(process.execPath,[join(stage,'scripts/prepare.mjs')],stage);await assertStopped(target);
  await rename(target,backup);oldMoved=true;
  try{await rename(join(backup,'data'),join(stage,'data'));dataMoved=true;safeToRemoveStage=false}catch(error){if(error.code!=='ENOENT')throw error}
  await rename(stage,target);committed=true;await assertInstallation(target);
 }catch(error){
  try{
   if(committed){await rename(target,stage);committed=false}
   if(dataMoved){await rename(join(stage,'data'),join(backup,'data'));safeToRemoveStage=true}
   if(oldMoved)await rename(backup,target);
  }catch(rollbackError){throw new AggregateError([error,rollbackError],'更新回滚未完成；已保留可恢复文件，请保留这些目录：'+stage+'、'+backup+'、'+target)}
  throw error;
 }finally{if(safeToRemoveStage)await rm(stage,{recursive:true,force:true})}
 await rm(backup,{recursive:true,force:true});console.log('固定目录更新完成，原 data 已保留：'+target);
}else throw new Error('用法：node scripts/delivery.mjs export <目录> | update <来源> <固定安装目录>');
