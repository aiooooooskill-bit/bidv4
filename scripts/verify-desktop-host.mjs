import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile,readdir,readlink,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

// This verifier runs the installed application's real immutable ASAR runtime.
// Its profile, credentials directory, plugin installation and data are temporary.
const project=fileURLToPath(new URL('..',import.meta.url));
const argv=process.argv.slice(2),option=name=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1]};
for(const arg of argv.filter(arg=>arg.startsWith('--')))assert.ok(['--app','--workdir','--report','--package','--keep'].includes(arg),'Unknown option: '+arg);
const packagePath=option('--package')?await realpath(resolve(option('--package'))):undefined;
const app=resolve(option('--app')??'/Applications/DeepSeek Harness.app');
const electron=join(app,'Contents/MacOS/DeepSeek Harness'),resources=join(app,'Contents/Resources');
const archive=join(resources,'app.asar'),runtime=join(archive,'dsh'),support=join(resources,'runtime');
const desktopHost=join(runtime,'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js');
const desktopCli=join(runtime,'node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
const workspace=option('--workdir')?resolve(option('--workdir')):await mkdtemp(join(tmpdir(),'ooo-bidpliot-desktop-'));
await mkdir(workspace,{recursive:true});assert.deepEqual(await readdir(workspace),[],'Desktop verifier requires an empty workspace');
const home=join(workspace,'dsh-home'),profile=join(home,'profiles/desktop');
const installation=packagePath?join(profile,'node_modules/ooo-bidpliot'):join(workspace,'fixed-install');
const reportPath=resolve(option('--report')??join(project,'docs/evidence/deepseek-021-desktop-'+(packagePath?'package':'host')+'-20261019.json'));
const environment=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^NODE_PATH$|^DSH_|^ELECTRON_/i.test(name)));
Object.assign(environment,{DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_CLIENT_VERSION:'0.2.1-rc.2'});
const electronEnvironment={...environment,ELECTRON_RUN_AS_NODE:'1',DSH_DESKTOP_NODE_EXECUTABLE:electron};
const redact=value=>String(value).replace(/([?&]token=)[^\s)"']+/g,'$1[redacted]').replace(/(dsh_session=)[^;\s]+/g,'$1[redacted]');
const report={releaseVersion:JSON.parse(await readFile(join(project,'package.json'),'utf8')).version,installMode:packagePath?'package':'link',...packagePath?{packagePath}:{},startedAt:new Date().toISOString(),workspace,installation,home,app,hostEntry:desktopHost,stages:[],passed:false};
let host;
async function save(){await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')}
async function stage(name,operation){
 console.log('桌面宿主验收：'+name);const started=Date.now();
 try{const evidence=await operation();report.stages.push({name,passed:true,milliseconds:Date.now()-started,evidence});await save();return evidence}
 catch(error){report.stages.push({name,passed:false,milliseconds:Date.now()-started,error:redact(error.stack??error.message)});await save();throw error}
}
async function run(command,args,{cwd=workspace,env=environment,timeout=300000}={}){
 const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});let output='';
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-64000)});
 const code=await new Promise((fulfil,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Command timed out: '+command))},timeout);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);fulfil(code)})});
 assert.equal(code,0,redact(output));return redact(output);
}
async function startHost(){
 const args=['--expose-internals',desktopHost,runtime,profile,join(support,'primary-runtime'),join(support,'primary-runtime/dependencies/pnpm/bin/pnpm.mjs'),join(support,'bin')];
 const child=spawn(electron,args,{cwd:profile,env:electronEnvironment,stdio:['ignore','pipe','pipe','ipc']});let output='',ready,shutdownComplete=false;
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-64000)});
 const exited=new Promise(fulfil=>child.once('close',(code,signal)=>fulfil({code,signal})));
 const received=new Promise((fulfil,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Desktop host startup timed out\n'+redact(output)))},60000);
  child.on('message',message=>{if(message.type==='ready'){ready=message;clearTimeout(timer);fulfil(message)}else if(message.type==='fatal'){clearTimeout(timer);reject(Error(redact(message.message+'\n'+message.diagnostic)))}else if(message.type==='shutdown-complete')shutdownComplete=true});
  child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);if(!ready)reject(Error('Desktop host exited '+code+'\n'+redact(output)))})
 });
 const instance={child,exited,output:()=>redact(output),async close(){
  if(child.exitCode===null&&child.signalCode===null){child.send({type:'shutdown'});const timer=setTimeout(()=>child.kill('SIGKILL'),20000);const result=await exited;clearTimeout(timer);assert.equal(result.code,0,redact(output));assert.ok(shutdownComplete,'Desktop host must acknowledge a complete shutdown')}
  return {shutdownComplete,diagnostics:redact(output).slice(-8000)};
 }};
 host=instance;instance.ready=await received;return instance;
}
const inspectSource=String.raw`
import {createRequire} from 'node:module';
import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const name='desktop-verification-observer';
export const inject=['webServer','connection','agentPresets','pluginPackages','loader'];
export function apply(ctx){
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/desktop-verification',async handler(req,res){
  const admission=ctx.connection.admit(req);if('rejection'in admission){res.writeHead(admission.rejection);res.end();return}
  try{
   const installation=await realpath(process.env.BID_DESKTOP_INSTALL),manifest=JSON.parse(await readFile(join(installation,'package.json'),'utf8'));
   const require=createRequire(join(installation,'package.json')),parent=pathToFileURL(join(installation,'server/plugin.mjs')).href;
   const {checkInstallation}=await import(pathToFileURL(join(installation,'server/installation.mjs')).href);
   const doctor=await checkInstallation(installation),compositions=await ctx.agentPresets.compositionInventory();
   const sources=Object.fromEntries(Object.keys(manifest.peerDependencies).filter(name=>name.startsWith('@deepseek-ai/')).map(name=>[name,{package:ctx.pluginPackages.packageOf(name,parent)?.manifestPath,entry:require.resolve(name==='@deepseek-ai/dsh'?name+'/package.json':name)}]));
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({node:process.versions.node,electron:process.versions.electron,doctor,compositions,sources}));
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.stack}))}
 }}),'temporary desktop acceptance diagnostics');
}
`;

try{
 await stage('已安装客户端版本与真实启动入口',async()=>{
  await access(electron);const code='const f=require("node:fs");const a=JSON.parse(f.readFileSync(process.argv[1],"utf8"));const c=JSON.parse(f.readFileSync(process.argv[2],"utf8"));const l=JSON.parse(f.readFileSync(process.argv[3],"utf8"));console.log(JSON.stringify({dsh:a.version,cordis:c.version,loader:l.version,node:process.versions.node,electron:process.versions.electron}))';
  const versions=JSON.parse(await run(electron,['--expose-internals','-e',code,join(runtime,'node_modules/@deepseek-ai/dsh/package.json'),join(runtime,'node_modules/@deepseek-ai/cordis/package.json'),join(runtime,'node_modules/@deepseek-ai/cordis-plugin-loader/package.json')],{env:electronEnvironment}));
  assert.deepEqual({dsh:versions.dsh,cordis:versions.cordis,loader:versions.loader},{dsh:'0.2.1-rc.2',cordis:'4.0.5',loader:'1.0.6'});report.versions=versions;return versions;
 });
 await stage(packagePath?'干净发行包不含用户数据及旧核心':'干净交付目录仅安装业务依赖和独立Python',async()=>{
  if(packagePath){
   const bytes=await readFile(packagePath),files=(await run('tar',['-tzf',packagePath])).trim().split('\n');
   assert.ok(files.length>100);assert.ok(!files.some(path=>/(^|\/)(?:node_modules|data|backups|\.venv|\.git)(?:\/|$)/.test(path)),'Release archive must contain source and built assets without user data or runtime environments');
   const manifestPath=files.find(path=>path.split('/').filter(Boolean).length===2&&path.endsWith('/package.json'));assert.ok(manifestPath);
   const manifest=JSON.parse(await run('tar',['-xOf',packagePath,manifestPath]));assert.equal(manifest.name,'ooo-bidpliot');assert.equal(manifest.version,report.releaseVersion);assert.equal(manifest.engines.dsh,'0.2.1-rc.2');assert.ok(!Object.keys(manifest.dependencies).some(name=>name.startsWith('@deepseek-ai/')));
   return {packagePath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),files:files.length,version:manifest.version,containsUserData:false,containsLocalOfficialPackages:false};
  }
  const exported=await run(process.execPath,[join(project,'scripts/delivery.mjs'),'export',installation]);
  const npm=await run('npm',['ci','--omit=dev','--omit=peer','--ignore-scripts','--no-audit','--no-fund'],{cwd:installation});
  const python=await run('uv',['sync','--locked','--project',join(installation,'business/python')]);
  let official=[];try{official=await readdir(join(installation,'node_modules/@deepseek-ai'))}catch(error){if(error.code!=='ENOENT')throw error}
  assert.deepEqual(official,[],'Clean runtime must not carry any development DSH package');
  await assert.rejects(stat(join(installation,'data')),{code:'ENOENT'});
  return {exported,dependencyInstall:npm.slice(-4000),pythonInstall:python.slice(-4000),localOfficialPackages:official,containsUserData:false};
 });
 await stage('App官方CLI安装到独立桌面profile',async()=>{
  // Desktop's own createPluginProfile delegates to this exact public initializer.
  const initialize='const {initProfile,PROFILE_TEMPLATES}=await import('+JSON.stringify(pathToFileURL(join(runtime,'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')).href)+');initProfile('+JSON.stringify(profile)+',PROFILE_TEMPLATES.web.bundles);';
  await run(electron,['--expose-internals','--input-type=module','-e',initialize],{env:electronEnvironment});
  let allowBuilds;
  if(packagePath){
   // Only this disposable profile trusts the plugin's declared Python postinstall.
   const path=join(profile,'pnpm-workspace.yaml'),workspaceConfig=await readFile(path,'utf8');assert.doesNotMatch(workspaceConfig,/^allowBuilds:/m);
   // pnpm 11 requires the exact file locator for local tarballs; a package-name
   // approval applies only when the registry package identity can be trusted.
   allowBuilds={['ooo-bidpliot@file:'+relative(await realpath(profile),packagePath).split('\\').join('/')]:true};
   await writeFile(path,workspaceConfig+'\nallowBuilds:\n'+Object.entries(allowBuilds).map(([key,value])=>'  '+JSON.stringify(key)+': '+value).join('\n')+'\n');
  }
  const spec=packagePath??'link:'+installation;
  const output=await run(electron,['--expose-internals',desktopCli,'plugin','--profile','desktop','add',spec],{env:electronEnvironment,timeout:180000});
  const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));assert.ok(manifest.dsh.profile.bundles.includes('ooo-bidpliot'));
  if(!packagePath){assert.equal(manifest.dependencies['ooo-bidpliot'],'link:'+installation);const link=await readlink(join(profile,'node_modules/ooo-bidpliot'));assert.equal(resolve(join(profile,'node_modules'),link),installation)}
  const profileOfficial=await readdir(join(profile,'node_modules/@deepseek-ai')).catch(error=>{if(error.code==='ENOENT')return [];throw error});assert.deepEqual(profileOfficial,[],'Profile must not install another copy of the official core');
  const installedManifest=JSON.parse(await readFile(join(installation,'package.json'),'utf8'));assert.equal(installedManifest.version,report.releaseVersion);
  await access(join(installation,'business/python/.venv/bin/python'));await assert.rejects(stat(join(installation,'data')),{code:'ENOENT'});
  return {output,dependencies:manifest.dependencies,bundles:manifest.dsh.profile.bundles,installation,profileOfficialPackages:profileOfficial,...packagePath?{allowBuilds,pythonPreparedBy:'package postinstall'}:{linkTarget:installation}};
 });
 await stage('仅隔离profile附加只读运行观测',async()=>{
  const observer=join(profile,'desktop-observer.mjs');await writeFile(observer,inspectSource);
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'session-title-llm',disabled:true},{id:'product-analytics',config:{enabled:false}},{insert:[{id:'desktop-verification-observer',name:pathToFileURL(observer).href}]}],null,2)+'\n');
  environment.BID_DESKTOP_INSTALL=installation;electronEnvironment.BID_DESKTOP_INSTALL=installation;
  return {observer,externalModelConfigured:false,credentialsInherited:false};
 });
 await stage('真正desktop-host启动及Web鉴权',async()=>{
  const instance=await startHost(),login=await fetch(instance.ready.url,{redirect:'manual'});
  instance.base=new URL(instance.ready.url).origin;instance.cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');await login.body?.cancel();assert.ok(instance.cookie);
  const boot=instance.ready.injections.find(value=>value.name==='__DSH_BOOT__')?.value;assert.ok(boot);
  instance.clientModule=boot.entries.find(value=>value.id==='ooo-bidpliot');assert.ok(instance.clientModule,'Plugin must appear in the real Desktop client module graph');
  return {authenticatedUrl:redact(instance.ready.url),loginStatus:login.status,ipcReady:true,release:boot.release,pluginClientModule:instance.clientModule};
 });
 async function get(path){const response=await fetch(host.base+path,{headers:{Cookie:host.cookie,Origin:host.base}});assert.equal(response.status,200,path+'\n'+(response.status===200?'':await response.text()));return response}
 async function rpc(method,args={}){const rpcId=randomUUID();const response=await fetch(host.base+'/api/'+method,{method:'POST',headers:{Cookie:host.cookie,Origin:host.base,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}})});assert.equal(response.status,200,method);const envelope=await response.json();assert.equal(envelope.type,'server-response');assert.equal(envelope.rpcId,rpcId);assert.equal(envelope.result.ok,true,JSON.stringify(envelope));return envelope.result.value}
 await stage('欢迎页account/getState与真实业务列表',async()=>{
  const account=await rpc('account/getState'),tasks=await(await get('/api/bidv4/tasks')).json();assert.equal(account.status,'signed-out');assert.deepEqual(tasks.tasks,[]);
  return {accountState:account,tasks,accountRpcSucceeded:true};
 });
 await stage('唯一插件公开预设及全部动态组件启动',async()=>{
  const presets=await rpc('agentPresets/list'),own=presets.presets.filter(preset=>preset.id.startsWith('ooo-bidpliot'));assert.deepEqual(own.map(preset=>preset.id),['ooo-bidpliot']);assert.equal(own[0].broken,undefined,own[0].broken);
  const diagnostics=await(await get('/desktop-verification')).json();assert.equal(diagnostics.doctor.ok,true,JSON.stringify(diagnostics.doctor.errors));
  const composition=diagnostics.compositions.find(value=>value.id==='ooo-bidpliot');assert.ok(composition);assert.equal(composition.broken,undefined,composition.broken);assert.ok(composition.rows.length>=10);
  for(const row of composition.rows.filter(row=>row.enabled))assert.equal(row.fiberState,2,'Dynamic component not active: '+JSON.stringify(row));
  for(const source of Object.values(diagnostics.sources)){assert.ok(source.package?.startsWith(archive+'/'),'Official package did not resolve from App: '+JSON.stringify(source));assert.ok(source.entry.startsWith(archive+'/'),'Official entry did not resolve from App: '+JSON.stringify(source))}
  return {publicPresets:presets.presets,doctor:diagnostics.doctor,composition,officialPackageSources:diagnostics.sources,node:diagnostics.node,electron:diagnostics.electron};
 });
 await stage('关键前端资源实际可访问',async()=>{
  const registeredClientPath=new URL(host.clientModule.url,host.base+'/').pathname+new URL(host.clientModule.url,host.base+'/').search;
  const paths=['/',registeredClientPath,'/api/bidv4/assets/client.js','/api/bidv4/assets/renderer/figureRenderer.js','/api/bidv4/assets/pdfjs/pdf.worker.min.mjs'];
  const assets=[];for(const path of paths){const response=await get(path),body=Buffer.from(await response.arrayBuffer());assert.ok(body.length>100);if(path===registeredClientPath){assert.match(body.toString(),/window\.__ModuleLoader__\.load\(/);assert.match(body.toString(),/id:\s*['"]ooo-bidpliot['"]/)}assets.push({path,status:response.status,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')})}return assets;
 });
 await stage('真实桌面宿主完整关闭',()=>host.close());host=undefined;
 report.passed=true;report.completedAt=new Date().toISOString();await save();console.log('桌面宿主验收通过：'+reportPath);
 if(!argv.includes('--keep'))await rm(workspace,{recursive:true,force:true});
}catch(error){report.passed=false;report.completedAt=new Date().toISOString();report.error=redact(error.stack??error.message);if(host)report.hostDiagnostics=host.output();await save();console.error(report.error);if(host)console.error(host.output().slice(-10000));process.exitCode=1}
finally{if(host)try{await host.close()}catch(error){console.error(redact(error.stack??error.message));process.exitCode=1}}
