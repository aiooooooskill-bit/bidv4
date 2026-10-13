import assert from 'node:assert/strict';
import {spawn,fork} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,readdir,lstat,readlink,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

// Destructive lifecycle operations only target this verifier's empty workspace.
// Official local `link:` installs point to a directory outside the host profile.
const project=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2),keepOpen=args.includes('--keep-open');
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
for(const arg of args.filter(a=>a.startsWith('--')))assert.ok(['--keep-open','--workdir','--report'].includes(arg),'Unknown option: '+arg);
const workspace=option('--workdir')?resolve(option('--workdir')):await mkdtemp(join(tmpdir(),'ooo-bidpliot-delivery-'));
await mkdir(workspace,{recursive:true});assert.deepEqual(await readdir(workspace),[],'Delivery verifier requires an empty workspace');
const installation=join(workspace,'fixed-install'),source=join(workspace,'clean-source'),home=join(workspace,'dsh-home');
const reportPath=resolve(option('--report')??join(project,'docs/evidence/plugin-delivery-validation-20261013.json'));
const environment={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',BID_DELIVERY_INSTALL:installation};
delete environment.DSH_TOOLS_MODE;delete environment.NODE_TEST_CONTEXT;
const report={name:'ooo-bidpliot',releaseVersion:null,startedAt:new Date().toISOString(),workspace,installation,hostHome:home,system:{platform:process.platform,arch:process.arch,node:process.version,dsh:'0.2.0-rc.2'},stages:[],passed:false};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const redact=text=>String(text).replace(/([?&]token=)[^\s)"']+/g,'$1[redacted]');
let active;
async function save(){await mkdir(resolve(reportPath,'..'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
async function stage(name,operation){
 console.log('交付验收：'+name);const started=Date.now();
 try{const evidence=await operation();report.stages.push({name,passed:true,milliseconds:Date.now()-started,evidence});await save();return evidence;}
 catch(error){report.stages.push({name,passed:false,milliseconds:Date.now()-started,error:redact(error.stack??error.message)});await save();throw error;}
}
async function run(command,argv,{cwd=project,allowFailure=false,env=environment,timeout=600000}={}){
 const child=spawn(command,argv,{cwd,env,stdio:['ignore','pipe','pipe']});let output='';
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;if(output.length>64000)output=output.slice(-64000)});
 const result=await new Promise((fulfil,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Command timed out: '+command+' '+argv.join(' ')))},timeout);
  child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',code=>{clearTimeout(timer);fulfil({code,output:redact(output)})});
 });
 if(!allowFailure)assert.equal(result.code,0,result.output);return result;
}
const script=(name,argv=[],options)=>run(process.execPath,[join(project,'scripts',name+'.mjs'),...argv],options);
const official=argv=>run(process.execPath,[join(installation,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'plugin','--profile','web',...argv],{cwd:workspace,timeout:180000});
async function startHost({expectFailure=false}={}){
 const child=fork(join(project,'tests/helpers/delivery-host.mjs'),[],{cwd:installation,env:environment,stdio:['ignore','pipe','pipe','ipc']});
 let output='',ready=false;const requests=new Map();
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;if(output.length>64000)output=output.slice(-64000)});
 const readyPromise=new Promise((fulfil,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Delivery host startup timed out\n'+redact(output)))},45000);
  child.on('message',message=>{
   if(message.ready){ready=true;clearTimeout(timer);fulfil(message.result)}
   else if(requests.has(message.id)){const r=requests.get(message.id);requests.delete(message.id);clearTimeout(r.timer);message.error?r.reject(Error(message.error.message+'\n'+message.error.stack)):r.fulfil(message.result)}
  });
  child.on('error',error=>{clearTimeout(timer);reject(error)});
  child.on('exit',code=>{clearTimeout(timer);if(!ready)reject(Error('Delivery host rejected activation ('+code+')\n'+redact(output)));for(const r of requests.values()){clearTimeout(r.timer);r.reject(Error('Delivery host exited ('+code+')\n'+redact(output)))}requests.clear()});
 });
 const host={child,readyPromise,output:()=>redact(output),command:(command,args)=>new Promise((fulfil,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{requests.delete(id);reject(Error('Delivery host command timed out: '+command+'\n'+redact(output)))},180000);requests.set(id,{fulfil,reject,timer});child.send({id,command,args});}),close:async()=>{
  let closeError;
  if(child.exitCode===null){try{await host.command('close')}catch(error){closeError=error;child.kill('SIGTERM')}await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const t=setTimeout(()=>{child.kill('SIGKILL');resolve()},10000);child.once('exit',()=>{clearTimeout(t);resolve()})});}
  if(closeError)throw closeError;
  const diagnostics=host.output();assert.doesNotMatch(diagnostics,/flush on a closed handle|SessionHandleClosedError|unhandled rejection/i,'Host lifecycle must not drop the session tail');return {closed:true,diagnostics:diagnostics.slice(-5000)};
 }};
 if(expectFailure){
  let state;
  try{state=await readyPromise}catch(error){if(child.exitCode===null)child.kill('SIGKILL');return {rejected:true,hostStarted:false,diagnostic:redact(error.message).slice(-6000)}}
  const route=await host.command('route',{path:'/api/bidv4/tasks'}),diagnostics=await host.command('diagnostics');await host.close();
  assert.equal(state.active,false,'Incomplete plugin business runtime must not activate');assert.equal(route.status,404,'Incomplete plugin API must not be registered');
  return {rejected:true,hostStarted:true,businessRuntimeAbsent:true,authenticatedApiStatus:route.status,diagnostic:JSON.stringify(diagnostics).slice(-6000)};
 }
 host.state=await readyPromise;active=host;return host;
}
async function snapshotDirectory(directory){
 const files={};
 async function walk(path,prefix=''){
  let names;try{names=await readdir(path)}catch(error){if(error.code==='ENOENT')return;throw error}
  for(const name of names.sort()){
   const full=join(path,name),relative=prefix+name,info=await lstat(full);
   if(info.isSymbolicLink())files[relative]={link:await readlink(full)};
   else if(info.isDirectory())await walk(full,relative+'/');
   else if(info.isFile()&&!name.endsWith('-wal')&&!name.endsWith('-shm'))files[relative]={bytes:info.size,sha256:sha(await readFile(full))};
  }
 }
 await walk(directory);return {files,fileCount:Object.keys(files).length,sha256:sha(JSON.stringify(files))};
}
async function snapshot(){
 const data=await snapshotDirectory(join(installation,'data'));
 delete data.files['app.db'];data.sha256=sha(JSON.stringify(data.files));data.fileCount=Object.keys(data.files).length;
 const db=await run(join(installation,'business/python/.venv/bin/python'),['-c',`import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nprint(json.dumps({'user_version':c.execute('pragma user_version').fetchone()[0],'dump':list(c.iterdump())},ensure_ascii=False))\n`,join(installation,'data/app.db')]);
 const database=JSON.parse(db.output),sessions=await snapshotDirectory(join(home,'sessions')),attachments=await snapshotDirectory(join(home,'attachments'));
 return {data,database:{sha256:sha(JSON.stringify(database)),userVersion:database.user_version,statements:database.dump.length},sessions,attachments};
}
async function exactRetention(before,label){const after=await snapshot();assert.deepEqual(after,before,label+' changed data or host session/attachment files');return {data:after.data.sha256,database:after.database,sessions:after.sessions.sha256,attachments:after.attachments.sha256,fileCount:after.data.fileCount};}
async function negativeCase(name,path,expected){
 const moved=path+'.delivery-missing';await rename(path,moved);
 try{
  const doctor=await script('doctor',[installation,'--json'],{allowFailure:true});assert.notEqual(doctor.code,0);assert.match(doctor.output,expected);
  const boot=await startHost({expectFailure:true});assert.match(boot.diagnostic,expected);
  return {doctor:{rejected:true,exitCode:doctor.code,diagnostic:doctor.output.slice(-4500)},activation:boot};
 }finally{await rename(moved,path)}
}
try{
 let host,before;
 await stage('干净白名单目录与空环境',async()=>{
  const exported=await script('delivery',['export',installation]);
  for(const name of ['node_modules','business/python/.venv','data','backups'])await assert.rejects(stat(join(installation,name)),{code:'ENOENT'});
  assert.equal(JSON.parse(await readFile(join(installation,'package.json'),'utf8')).version,undefined);
  return {exportOutput:exported.output,emptyNodeEnvironment:true,emptyPythonEnvironment:true,containsUserData:false,releaseVersion:null};
 });
 await stage('全新Node与Python依赖准备及构建',async()=>{
  const result=await script('prepare',[installation]);
  for(const path of ['node_modules','business/python/.venv','dist'])assert.equal((await lstat(join(installation,path))).isSymbolicLink(),false,path+' must not reuse a development symlink');
  const doctor=await script('doctor',[installation,'--json']);return {prepareOutput:result.output.slice(-12000),doctor:JSON.parse(doctor.output),developmentEnvironmentReused:false};
 });
 await stage('官方CLI本地link安装',async()=>{
  const result=await official(['add','link:'+installation]);
  const manifest=JSON.parse(await readFile(join(home,'profiles/web/package.json'),'utf8'));
  assert.equal(manifest.dependencies['ooo-bidpliot'],'link:'+installation);assert.ok(manifest.dsh.profile.bundles.includes('ooo-bidpliot'));
  const target=await readlink(join(home,'profiles/web/node_modules/ooo-bidpliot'));assert.equal(resolve(join(home,'profiles/web/node_modules'),target),installation);
  return {cli:result.output,dependency:manifest.dependencies['ooo-bidpliot'],bundle:manifest.dsh.profile.bundles,independentTarget:installation};
 });
 host=await startHost();
 await stage('公开/私有Agent预设与页面实际业务全流程',async()=>{assert.ok(host.state.active);const business=await host.command('business');report.business=business;return business;});
 await stage('宿主其他Agent工具与聊天不受影响',()=>host.command('host'));
 await script('delivery',['export',source]);
 const beforeCodeHash=sha(await readFile(join(installation,'server/agent.mjs')));
 const candidateCode=await readFile(join(source,'server/agent.mjs'),'utf8');await writeFile(join(source,'server/agent.mjs'),candidateCode+'\n// Isolated directory update acceptance marker; no release version is assigned.\n');
 const candidateCodeHash=sha(await readFile(join(source,'server/agent.mjs')));assert.notEqual(candidateCodeHash,beforeCodeHash);
 await stage('活宿主拒绝原位更新',async()=>{
  const result=await script('delivery',['update',source,installation],{allowFailure:true});assert.notEqual(result.code,0);assert.match(result.output,/宿主|host|运行|活跃|停止/i);return {rejected:true,diagnostic:result.output.slice(-4500)};
 });
 await stage('首次完整关闭与会话尾事件',()=>host.close());active=undefined;
 before=await snapshot();report.baseline=before;
 await stage('更新准备失败保留完整原目录与数据',async()=>{
  const path=join(source,'src/plugin.tsx'),original=await readFile(path,'utf8');
  try{
   await writeFile(path,original+'\nconst = ; // isolated failed preparation fixture\n');
   const result=await script('delivery',['update',source,installation],{allowFailure:true});assert.notEqual(result.code,0);assert.match(result.output,/TS\d+|准备失败|更新准备失败/);
   assert.equal(sha(await readFile(join(installation,'server/agent.mjs'))),beforeCodeHash);
   return {rejected:true,diagnostic:result.output.slice(-4500),retained:await exactRetention(before,'Failed candidate preparation')};
  }finally{await writeFile(path,original)}
 });
 await stage('固定目录原位更新及全部数据保留',async()=>{
  const result=await script('delivery',['update',source,installation]);const retained=await exactRetention(before,'Original directory update');
  assert.equal(sha(await readFile(join(installation,'server/agent.mjs'))),candidateCodeHash);
  assert.equal(JSON.parse(await readFile(join(installation,'package.json'),'utf8')).version,undefined);return {updateOutput:result.output.slice(-12000),changedCode:{previousSha256:beforeCodeHash,updatedSha256:candidateCodeHash},retained};
 });
 host=await startHost();await stage('更新后重启页面与独立Agent冷恢复',()=>host.command('retained',report.business));
 await stage('更新后宿主其他Agent正常',()=>host.command('host'));
 await host.close();active=undefined;before=await snapshot();
 await stage('官方CLI真正卸载保留固定目录数据',async()=>{
  const result=await official(['remove','ooo-bidpliot']);
  const manifest=JSON.parse(await readFile(join(home,'profiles/web/package.json'),'utf8'));assert.equal(manifest.dependencies?.['ooo-bidpliot'],undefined);assert.ok(!manifest.dsh.profile.bundles.includes('ooo-bidpliot'));
  let residualLink;try{residualLink=await readlink(join(home,'profiles/web/node_modules/ooo-bidpliot'))}catch(error){if(error.code!=='ENOENT')throw error}
  return {cli:result.output,retained:await exactRetention(before,'Official remove'),targetExists:(await stat(installation)).isDirectory(),packageManagerRetainedLink:residualLink??null};
 });
 host=await startHost();await stage('卸载后页面404、公开Agent移除、宿主正常',async()=>{
  assert.equal(host.state.active,false);assert.ok(!host.state.publicPresets.some(p=>p.id==='ooo-bidpliot'));assert.equal((await host.command('route',{path:'/api/bidv4/tasks'})).status,404);return {authenticatedPageStatus:404,presetAbsent:true,host:await host.command('host')};
 });
 await host.close();active=undefined;before=await snapshot();
 await stage('官方CLI本地目录重装且完整数据保留',async()=>{const result=await official(['add','link:'+installation]);return {cli:result.output,retained:await exactRetention(before,'Official reinstall')};});
 host=await startHost();await stage('重装后页面成果、下载与独立Agent冷恢复',()=>host.command('retained',report.business));
 await host.close();active=undefined;before=await snapshot();
 await stage('缺完整dist明确拒绝激活',()=>negativeCase('dist',join(installation,'dist'),/dist|client|资源|构建/i));
 await stage('缺Node依赖明确拒绝激活',()=>negativeCase('node',join(installation,'node_modules/busboy'),/busboy|依赖|Node|MODULE_NOT_FOUND/i));
 await stage('缺Python环境明确拒绝激活',()=>negativeCase('python',join(installation,'business/python/.venv'),/Python|python|环境|venv/i));
 const pythonLibrary=(await run(join(installation,'business/python/.venv/bin/python'),['-c','import sysconfig; print(sysconfig.get_path("purelib"))'])).output.trim();
 await stage('缺Python运行依赖明确拒绝激活',()=>negativeCase('pythonModule',join(pythonLibrary,'docx'),/docx|Python|python|依赖/i));
 await stage('不支持的宿主版本明确拒绝',async()=>{const result=await script('doctor',[installation,'--json','--dsh-version','0.1.0'],{allowFailure:true});assert.notEqual(result.code,0);assert.match(result.output,/0\.1\.0|dsh|宿主/i);return {rejected:true,diagnostic:result.output.slice(-4500)};});
 await stage('全部拒绝检查结束后原件数据库会话完整',()=>exactRetention(before,'Rejected incomplete installations'));
 host=await startHost();await stage('最终重启验证页面与独立Agent',()=>host.command('retained',report.business));
 await stage('页面任务停止会取消子Agent并清理锁',()=>host.command('cancel',report.business));
 report.passed=true;report.completedAt=new Date().toISOString();report.browser={base:host.state.base,loginUrl:host.state.loginUrl};await save();
 console.log('交付验收全部通过；发行版本继续留空。');console.log('证据：'+reportPath);
 if(keepOpen){console.log('BID_DELIVERY_BROWSER='+host.state.loginUrl);console.log('BID_DELIVERY_WORKSPACE='+workspace);await writeFile(join(workspace,'browser.json'),JSON.stringify(report.browser,null,2)+'\n');await new Promise(resolve=>process.once('SIGTERM',resolve));await host.close();active=undefined;}
 else{await host.close();active=undefined;await rm(workspace,{recursive:true,force:true});}
}catch(error){report.passed=false;report.completedAt=new Date().toISOString();report.error=redact(error.stack??error.message);await save();console.error(redact(error.stack??error.message));process.exitCode=1;}
finally{if(active)try{await active.close()}catch(error){console.error(redact(error.message));process.exitCode=1}}
