import * as path from 'node:path';
import {mkdir,lstat,realpath,symlink} from 'node:fs/promises';
import {canonicalizeWatchPath} from '@deepseek-ai/dsh-home-paths';

// Package-manager installs keep data beside node_modules, never inside it.
// A fixed-directory installation keeps code and data as sibling directories.
export function defaultDataDirectory(installation,paths=path){
 let parent=paths.dirname(installation),container=parent;
 for(let current=parent;paths.dirname(current)!==current;current=paths.dirname(current)){
  if(paths.basename(current).toLowerCase()==='node_modules')container=paths.dirname(current);
 }
 return paths.join(container,'ooo-bidpliot-data');
}
export async function resolveDataDirectory(installation){
 const configured=process.env.DATA_DIR;
 if(configured!==undefined&&(!configured.trim()||!path.isAbsolute(configured)))throw new Error('DATA_DIR 必须是独立数据目录的绝对路径');
 return canonicalizeWatchPath(configured??defaultDataDirectory(installation));
}
const inside=(parent,target)=>{const part=path.relative(parent,target);return part===''||(part!=='..'&&!part.startsWith('..'+path.sep)&&!path.isAbsolute(part))};
export async function mountDataDirectory(installation){
 const code=await realpath(installation),dataDirectory=await resolveDataDirectory(code);
 if(dataDirectory.split(path.sep).some(part=>part.toLowerCase()==='node_modules'))throw new Error('独立数据目录不能放在 node_modules 内');
 if(inside(code,dataDirectory)||inside(dataDirectory,code))throw new Error('插件代码与生产数据目录必须相互独立');
 await mkdir(dataDirectory,{recursive:true,mode:0o700});
 const target=await realpath(dataDirectory),mount=path.join(installation,'data');
 if(inside(code,target)||inside(target,code))throw new Error('插件代码与生产数据目录必须相互独立');
 let info;try{info=await lstat(mount)}catch(error){if(error.code!=='ENOENT')throw error}
 if(info){
  let actual;try{actual=await realpath(mount)}catch(error){if(error.code!=='ENOENT')throw error}
  if(!info.isSymbolicLink()||actual!==target)throw new Error('插件 data 入口不是独立数据目录；请关闭客户端并先备份、原位转存现有数据，禁止覆盖');
 }else{
  // This mount preserves existing native-session workspace paths; it owns no data.
  try{await symlink(target,mount,process.platform==='win32'?'junction':'dir')}
  catch(error){if(error.code!=='EEXIST'||!(await lstat(mount)).isSymbolicLink()||await realpath(mount)!==target)throw error}
 }
 return target;
}
