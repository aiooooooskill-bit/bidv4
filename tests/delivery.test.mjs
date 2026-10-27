import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,symlink,readdir,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {checkInstallation} from '../server/installation.mjs';
import {evaluatePluginCompatibility} from '@deepseek-ai/dsh-app-boot';
const root=fileURLToPath(new URL('..',import.meta.url));
async function command(script,args=[]){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,...args],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{output+=b});child.on('error',reject);child.on('close',code=>resolve({code,output}))})}
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'ooo-bidpliot-delivery-unit-'));try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}
async function sourceFixture(dir){
 const source=join(dir,'source');await mkdir(join(source,'scripts'),{recursive:true});await mkdir(join(source,'server'),{recursive:true});await mkdir(join(source,'dist'),{recursive:true});
 await cp(join(root,'scripts/delivery.mjs'),join(source,'scripts/delivery.mjs'));await cp(join(root,'server/installation.mjs'),join(source,'server/installation.mjs'));await cp(join(root,'server/platform.mjs'),join(source,'server/platform.mjs'));
 await writeFile(join(source,'package.json'),JSON.stringify({name:'ooo-bidpliot',type:'module',files:['scripts','server','dist']}));await writeFile(join(source,'package-lock.json'),'{}');await writeFile(join(source,'dist/client.js'),'complete client');return source;
}
test('交付白名单包含运行资源，排除用户数据、环境、备份和缓存',()=>fixture(async dir=>{
 const source=await sourceFixture(dir);
 for(const name of ['data','backups','node_modules']){await mkdir(join(source,name));await writeFile(join(source,name,'private.db'),'never ship')}
 await mkdir(join(source,'server/__pycache__'));await writeFile(join(source,'server/__pycache__/private.pyc'),'never ship');
 const target=join(dir,'delivery'),result=await command(join(source,'scripts/delivery.mjs'),['export',target]);assert.equal(result.code,0,result.output);
 const manifest=JSON.parse(await readFile(join(target,'delivery-files.json'),'utf8'));assert.equal(manifest.version,null);assert.ok(manifest.files.includes('dist/client.js'));assert.ok(manifest.files.every(p=>!/(^|\/)(data|backups|node_modules|__pycache__)(\/|$)/.test(p)));assert.ok(!(await readdir(target)).includes('data'));
}));
test('错误交付白名单被拒绝，不能将 data 当运行文件发布',()=>fixture(async dir=>{
 const source=await sourceFixture(dir);await writeFile(join(source,'package.json'),JSON.stringify({name:'ooo-bidpliot',type:'module',files:['data']}));
 const result=await command(join(source,'scripts/delivery.mjs'),['export',join(dir,'delivery')]);assert.equal(result.code,1);assert.match(result.output,/不允许的交付文件规则/);
}));
test('构建后段失败不破坏原 client 和 renderer，临时半成品清理',()=>fixture(async dir=>{
 await mkdir(join(dir,'scripts'));await mkdir(join(dir,'server'));await mkdir(join(dir,'src/lib'),{recursive:true});await mkdir(join(dir,'dist/renderer'),{recursive:true});
 await cp(join(root,'scripts/build.mjs'),join(dir,'scripts/build.mjs'));await cp(join(root,'server/installation.mjs'),join(dir,'server/installation.mjs'));await cp(join(root,'server/platform.mjs'),join(dir,'server/platform.mjs'));await symlink(join(root,'node_modules'),join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 await writeFile(join(dir,'package.json'),' {"name":"ooo-bidpliot","type":"module"}');await writeFile(join(dir,'src/plugin.tsx'),'export const apply=()=>{}');await writeFile(join(dir,'src/lib/figureRenderer.ts'),'export const broken = ;');
 await writeFile(join(dir,'dist/client.js'),'original client');await writeFile(join(dir,'dist/renderer/figureRenderer.js'),'original renderer');
 const result=await command(join(dir,'scripts/build.mjs'));assert.equal(result.code,1);assert.equal(await readFile(join(dir,'dist/client.js'),'utf8'),'original client');assert.equal(await readFile(join(dir,'dist/renderer/figureRenderer.js'),'utf8'),'original renderer');assert.ok((await readdir(dir)).every(name=>!name.startsWith('.dist-build-')));
}));
test('新环境准备失败时不切换固定安装目录或用户 data',()=>fixture(async dir=>{
 const source=await sourceFixture(dir);await writeFile(join(source,'scripts/prepare.mjs'),"throw new Error('isolated preparation failure')");
 const target=join(dir,'fixed');await mkdir(join(target,'data'),{recursive:true});await writeFile(join(target,'package.json'),JSON.stringify({name:'ooo-bidpliot',type:'module'}));await writeFile(join(target,'data/app.db'),'preserved database');await writeFile(join(target,'original.mjs'),'preserved code');
 const result=await command(join(source,'scripts/delivery.mjs'),['update',source,target]);assert.equal(result.code,1);assert.match(result.output,/isolated preparation failure/);assert.equal(await readFile(join(target,'data/app.db'),'utf8'),'preserved database');assert.equal(await readFile(join(target,'original.mjs'),'utf8'),'preserved code');assert.ok((await readdir(dir)).every(name=>!name.startsWith('.ooo-bidpliot-next-')));
}));
test('运行宿主阻止目录更新，不能替换使用中的代码和数据',()=>fixture(async dir=>{
 const source=await sourceFixture(dir),target=join(dir,'fixed');await mkdir(join(target,'data/.hosts'),{recursive:true});await writeFile(join(target,'package.json'),JSON.stringify({name:'ooo-bidpliot'}));await writeFile(join(target,'data/.hosts/'+process.pid+'.json'),JSON.stringify({pid:process.pid}));
 const result=await command(join(source,'scripts/delivery.mjs'),['update',source,target]);assert.equal(result.code,1);assert.match(result.output,/目录仍由宿主或业务进程/);assert.ok((await readdir(dir)).every(name=>!name.startsWith('.ooo-bidpliot-next-')));
}));
test('目录已交换后验证失败，回滚恢复原代码和完整 data',()=>fixture(async dir=>{
 const source=await sourceFixture(dir);await writeFile(join(source,'scripts/prepare.mjs'),'// prepared failure fixture');await writeFile(join(source,'server/installation.mjs'),"export async function assertStopped(){}; export async function assertInstallation(){throw new Error('relocated environment rejected')}");
 const target=join(dir,'fixed');await mkdir(join(target,'data/workspace'),{recursive:true});await writeFile(join(target,'package.json'),JSON.stringify({name:'ooo-bidpliot'}));await writeFile(join(target,'original.mjs'),'original code');await writeFile(join(target,'data/app.db'),'original database');await writeFile(join(target,'data/workspace/document.md'),'original document');
 const result=await command(join(source,'scripts/delivery.mjs'),['update',source,target]);assert.equal(result.code,1);assert.match(result.output,/relocated environment rejected/);assert.equal(await readFile(join(target,'original.mjs'),'utf8'),'original code');assert.equal(await readFile(join(target,'data/app.db'),'utf8'),'original database');assert.equal(await readFile(join(target,'data/workspace/document.md'),'utf8'),'original document');assert.ok((await readdir(dir)).every(name=>!name.startsWith('.ooo-bidpliot-next-')&&!name.includes('.previous-')));
}));
test('回滚自身被文件系统拒绝时，保留唯一 data 和原代码以供恢复',{skip:process.platform==='win32'},()=>fixture(async dir=>{
 const source=await sourceFixture(dir);await writeFile(join(source,'scripts/prepare.mjs'),'// prepared failure fixture');await writeFile(join(source,'server/installation.mjs'),"import {readdir,chmod} from 'node:fs/promises'; import {dirname,join} from 'node:path'; export async function assertStopped(){}; export async function assertInstallation(target){const parent=dirname(target),backup=(await readdir(parent)).find(name=>name.startsWith('fixed.previous-')); await chmod(join(parent,backup),0o500); throw new Error('relocated environment rejected')}");
 const target=join(dir,'fixed');await mkdir(join(target,'data'),{recursive:true});await writeFile(join(target,'package.json'),JSON.stringify({name:'ooo-bidpliot'}));await writeFile(join(target,'original.mjs'),'original code');await writeFile(join(target,'data/app.db'),'only database');
 const result=await command(join(source,'scripts/delivery.mjs'),['update',source,target]);const names=await readdir(dir),backup=names.find(name=>name.startsWith('fixed.previous-')),stage=names.find(name=>name.startsWith('.ooo-bidpliot-next-'));
 try{assert.equal(result.code,1);assert.match(result.output,/更新回滚未完成.*已保留可恢复文件/);assert.ok(backup&&stage);assert.equal(await readFile(join(dir,backup,'original.mjs'),'utf8'),'original code');assert.equal(await readFile(join(dir,stage,'data/app.db'),'utf8'),'only database')}finally{if(backup)await chmod(join(dir,backup),0o700)}
}));
test('目录检查清楚拒绝不受支持的 dsh 版本和空环境',()=>fixture(async dir=>{
 const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 await writeFile(join(dir,'package.json'),JSON.stringify({name:'ooo-bidpliot',dsh:{bundle:{patch:'cordis.patch.yml'}},engines:manifest.engines}));
 await mkdir(join(dir,'node_modules'));await symlink(join(root,'node_modules/semver'),join(dir,'node_modules/semver'),process.platform==='win32'?'junction':'dir');
 const report=await checkInstallation(dir,{probePython:false,dshVersion:'0.3.0'});assert.equal(report.ok,false);assert.ok(report.errors.some(message=>message.includes('dsh 版本不匹配')));assert.ok(report.checks.some(check=>check.name==='Python环境'&&!check.ok));assert.ok(report.checks.some(check=>check.name==='dist/client.js'&&!check.ok));assert.equal(report.version,null);
}));

test('官方门禁与doctor一致接受同系列后续DSH，拒绝旧版和下一系列',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 for(const [version,supported] of [['0.2.1-rc.3',true],['0.2.1-rc.4',true],['0.2.1',true],['0.2.2',true],['0.2.1-rc.2',false],['0.3.0-rc.1',false],['0.3.0',false]]){
  const report=await checkInstallation(root,{probePython:false,dshVersion:version});
  assert.equal(report.checks.find(check=>check.name==='dsh版本').ok,supported,version+' doctor');
  assert.equal(evaluatePluginCompatibility(manifest,{},version)===undefined,supported,version+' official engines');
  const peersOnly={...manifest,engines:{node:manifest.engines.node}};
  assert.equal(evaluatePluginCompatibility(peersOnly,{},version)===undefined,supported,version+' official peers');
 }
});
