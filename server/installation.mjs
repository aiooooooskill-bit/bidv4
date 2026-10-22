import {access,mkdir,readFile,readdir,stat,unlink,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {pythonExecutable} from './platform.mjs';
import {resolveDataDirectory} from './data-location.mjs';

const requiredFiles=['package.json','package-lock.json','cordis.patch.yml','server/agent.mjs','server/data-location.mjs','server/native/roles.json','business/python/runner.py','business/python/pyproject.toml','business/python/uv.lock','business/python/app/resources/tender_base_template.docx','dist/client.js','dist/renderer/figureRenderer.js','dist/pdfjs/pdf.worker.min.mjs'];
const assetDirectories=['dist/pdfjs/cmaps','dist/pdfjs/standard_fonts','dist/pdfjs/wasm'];
const skills=['document-parse','tender-analysis','tender-outline','tender-body','tender-qa','humanizer-zh','tender-review'];
export async function probePython(directory){
 const python=pythonExecutable(directory);
 const code="import sys,json,docx,pydantic,httpx,trafilatura,jieba,pypdfium2,PIL,markdown_it,filelock; assert sys.version_info >= (3,12); print(json.dumps({'version':sys.version.split()[0],'prefix':sys.prefix}))";
 return await new Promise((resolve,reject)=>{
  const child=spawn(python,['-X','utf8','-c',code],{cwd:directory,stdio:['ignore','pipe','pipe']});let output='',error='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Python 环境检查超时'))},15000);
  child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{error+=b});child.on('error',e=>{clearTimeout(timer);reject(new Error('Python 环境不可用：'+e.message))});
  child.on('close',exitCode=>{clearTimeout(timer);if(exitCode!==0)reject(new Error('Python 依赖检查失败：'+error.slice(-1200)));else try{resolve(JSON.parse(output))}catch{reject(new Error('Python 环境检查未返回有效结果'))}});
 });
}
export async function checkInstallation(directory,{probePython:checkPython=true,dshVersion}={}){
 directory=resolve(directory);const checks=[],errors=[];let manifest,python;
 const check=async(name,fn)=>{try{await fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false});errors.push(error.message)}};
 await check('Node.js',()=>{if(Number(process.versions.node.split('.')[0])<24)throw new Error('需要 Node.js 24 或更高版本')});
 await check('操作系统',()=>{if(!['darwin','linux','win32'].includes(process.platform))throw new Error('不支持的操作系统：' + process.platform)});
 await check('插件清单',async()=>{manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(manifest.name!=='ooo-bidpliot'||manifest.dsh?.bundle?.patch!=='cordis.patch.yml')throw new Error('目录不是有效的 ooo-bidpliot 插件');await access(directory,constants.W_OK)});
 for(const relative of [...requiredFiles,...skills.map(name=>'business/python/app/skills/'+name+'/SKILL.md')])await check(relative,async()=>{const info=await stat(join(directory,relative));if(!info.isFile()||!info.size)throw new Error('缺少或为空的交付文件：'+relative+'；请重新准备完整目录')});
 for(const relative of assetDirectories)await check(relative,async()=>{if(!(await readdir(join(directory,relative))).length)throw new Error('资源目录为空：'+relative)});
 if(manifest){
  const require=createRequire(join(directory,'package.json'));
  const clientPeers=new Set(['react','react-dom',...(manifest.dsh?.client?.inject??[])]);
  for(const name of Object.keys({...manifest.dependencies,...manifest.peerDependencies}).filter(name=>!clientPeers.has(name)))await check('Node依赖 '+name,()=>{try{require.resolve(name==='@deepseek-ai/dsh'?name+'/package.json':name)}catch{throw new Error('缺少 Node 依赖 '+name+'；请执行目录准备（npm run directory:prepare）')}});
  await check('dsh版本',async()=>{const required=manifest.engines?.dsh;const actual=dshVersion??JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh/package.json'),'utf8')).version;if(!required||actual!==required)throw new Error('dsh 版本不匹配：本目录要求 '+required+'，当前为 '+actual+'；请使用已验证的宿主版本');});
  for(const name of ['@deepseek-ai/cordis','@deepseek-ai/cordis-plugin-loader'])await check(name+'版本',async()=>{const required=manifest.peerDependencies?.[name],actual=JSON.parse(await readFile(require.resolve(name+'/package.json'),'utf8')).version;if(!required||actual!==required)throw new Error(name+' 版本不匹配：本目录要求 '+required+'，当前为 '+actual);});
 }
 await check('Python环境',async()=>{await access(pythonExecutable(directory),constants.X_OK);if(checkPython)python=await probePython(directory)});
 return {ok:errors.length===0,directory,name:manifest?.name,version:manifest?.version??null,node:process.versions.node,python,checks,errors};
}
export async function assertInstallation(directory){const report=await checkInstallation(directory);if(!report.ok)throw new Error('插件目录未准备完成：\n'+report.errors.join('\n'));return report}
function alive(pid){try{process.kill(pid,0);return true}catch(error){return error.code!=='ESRCH'}}
export async function assertStopped(directory){
 const dataDirectory=await resolveDataDirectory(directory);
 for(const relative of [join(dataDirectory,'.hosts'),join(dataDirectory,'locks'),join(directory,'data/.hosts'),join(directory,'data/locks')]){
  let names;try{names=await readdir(relative)}catch(error){if(error.code==='ENOENT')continue;throw error}
  for(const name of names){const path=join(relative,name),text=await readFile(path,'utf8');let pid;if(relative.endsWith('.hosts')){pid=JSON.parse(text).pid}else pid=Number(text);if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('无法确认目录运行状态：'+path);if(alive(pid))throw new Error('目录仍由宿主或业务进程 '+pid+' 使用；请先关闭宿主或禁用插件再准备/更新');await unlink(path)}
 }
}
export async function claimHost(directory){
 const dir=join(await resolveDataDirectory(directory),'.hosts');await mkdir(dir,{recursive:true});const path=join(dir,process.pid+'.json');await writeFile(path,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
 return async()=>{await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error})};
}
