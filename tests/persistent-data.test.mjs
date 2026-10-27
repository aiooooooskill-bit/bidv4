import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,realpath,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32,posix} from 'node:path';
import {defaultDataDirectory} from '../server/data-location.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const run=(code,home)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,['--input-type=module','-e',code],{env:Object.fromEntries(Object.entries({...process.env,DSH_HOME:home}).filter(([k])=>k!=='DATA_DIR')),stdio:['ignore','pipe','pipe']});let out='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>out+=b);c.on('error',reject);c.on('close',status=>resolve({status,out}))});
const mounted=installation=>`import {mountDataDirectory} from ${JSON.stringify(new URL('../server/data-location.mjs',import.meta.url).href)};console.log(await mountDataDirectory(${JSON.stringify(installation)}))`;
async function fixture(fn){const base=await mkdtemp(join(tmpdir(),'bid-persistent-data-'));try{await fn(base)}finally{await rm(base,{recursive:true,force:true})}}
test('替换整个插件目录后，独立数据库、原件、动作和旧会话路径仍可读取',()=>fixture(async base=>{
 const home=join(base,'harness'),installation=join(base,'profile/node_modules/ooo-bidpliot'),store=join(base,'profile/ooo-bidpliot-data');await mkdir(installation,{recursive:true});
 let r=await run(mounted(installation),home);assert.equal(r.status,0,r.out);assert.equal((await lstat(join(installation,'data'))).isSymbolicLink(),true);assert.equal(await realpath(join(installation,'data')),await realpath(store));
 const files={'app.db':Buffer.from([83,81,76,105,116,101,0,255]),'workspace/t_real/sources/中文原件.docx':Buffer.from('original document'),'actions/t_real/latest.json':Buffer.from('{"outcome":{"state":"stopped"}}'),'conversations/t_real.json':Buffer.from('{"session_id":"same-session"}')};
 for(const [p,bytes]of Object.entries(files)){await mkdir(join(store,p,'..'),{recursive:true});await writeFile(join(store,p),bytes)}
 const oldCwd=join(installation,'data/workspace/t_real');
 for(let version=2;version<=3;version++){
  await rm(installation,{recursive:true,force:true});for(const [p,bytes]of Object.entries(files))assert.deepEqual(await readFile(join(store,p)),bytes);
  await mkdir(installation,{recursive:true});await writeFile(join(installation,'version'),String(version));r=await run(mounted(installation),home);assert.equal(r.status,0,r.out);
  for(const [p,bytes]of Object.entries(files))assert.deepEqual(await readFile(join(installation,'data',p)),bytes);
  assert.deepEqual(await readFile(join(oldCwd,'sources/中文原件.docx')),files['workspace/t_real/sources/中文原件.docx']);
 }
}));
test('拒绝覆盖尚未转存的实体数据和指向其他位置的入口',()=>fixture(async base=>{
 const home=join(base,'home'),installation=join(base,'code');await mkdir(join(installation,'data'),{recursive:true});await writeFile(join(installation,'data/app.db'),'production');
 let r=await run(mounted(installation),home);assert.equal(r.status,1);assert.match(r.out,/禁止覆盖/);assert.equal(await readFile(join(installation,'data/app.db'),'utf8'),'production');
 await rm(join(installation,'data'),{recursive:true});const other=join(base,'other');await mkdir(other);await symlink(other,join(installation,'data'),process.platform==='win32'?'junction':'dir');r=await run(mounted(installation),home);assert.equal(r.status,1);assert.equal(await realpath(join(installation,'data')),await realpath(other));
}));
test('运行锁位于独立数据根；即使安装目录已被移除仍能阻止更新',()=>fixture(async base=>{
 const home=join(base,'home'),installation=join(base,'deleted-code'),claims=join(base,'ooo-bidpliot-data/.hosts');await mkdir(claims,{recursive:true});await writeFile(join(claims,process.pid+'.json'),JSON.stringify({pid:process.pid}));
 const code=`import {assertStopped} from ${JSON.stringify(new URL('../server/installation.mjs',import.meta.url).href)};await assertStopped(${JSON.stringify(installation)})`;
 const r=await run(code,home);assert.equal(r.status,1);assert.match(r.out,/目录仍由宿主/);assert.ok((await readFile(join(claims,process.pid+'.json'),'utf8')).includes(String(process.pid)));
}));

test('macOS 与 Windows 的客户端安装、pnpm 虚拟存储和固定目录路径均位于安装树旁',()=>{
 for(const [paths,code,expected]of [
  [posix,'/Users/a/.dsh/profiles/desktop/node_modules/ooo-bidpliot','/Users/a/.dsh/profiles/desktop/ooo-bidpliot-data'],
  [posix,'/Users/a/.dsh/profiles/desktop/node_modules/.pnpm/pkg/node_modules/ooo-bidpliot','/Users/a/.dsh/profiles/desktop/ooo-bidpliot-data'],
  [posix,'/Users/a/招投标/ooo-bidpliot','/Users/a/招投标/ooo-bidpliot-data'],
  [win32,'C:\\Users\\a\\.dsh\\profiles\\desktop\\node_modules\\ooo-bidpliot','C:\\Users\\a\\.dsh\\profiles\\desktop\\ooo-bidpliot-data'],
  [win32,'D:\\插件\\ooo-bidpliot','D:\\插件\\ooo-bidpliot-data'],
  [win32,'\\\\server\\share\\plugins\\ooo-bidpliot','\\\\server\\share\\plugins\\ooo-bidpliot-data'],
 ])assert.equal(defaultDataDirectory(code,paths),expected);
});

test('安装前没有任何第三方依赖仍能准备数据入口，且拒绝代码内和node_modules内的数据位置',()=>fixture(async base=>{
 const code=join(base,'bare-code'),home=join(base,'home');await mkdir(join(code,'server'),{recursive:true});await cp(join(root,'server/data-location.mjs'),join(code,'server/data-location.mjs'));
 const entry=pathToFileURL(join(code,'server/data-location.mjs')).href;
 let r=await run(`const {mountDataDirectory}=await import(${JSON.stringify(entry)});await mountDataDirectory(${JSON.stringify(code)})`,home);assert.equal(r.status,0,r.out);
 for(const bad of [join(code,'..data'),join(base,'node_modules/user-data')]){
  r=await run(`process.env.DATA_DIR=${JSON.stringify(bad)};`+mounted(code),home);assert.equal(r.status,1);assert.match(r.out,/必须相互独立|不能放在 node_modules/);
 }
}));
