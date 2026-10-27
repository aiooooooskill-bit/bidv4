import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,stat,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {json as readJson} from 'node:stream/consumers';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pythonExecutable} from '../server/platform.mjs';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {root,dataRoot} from '../server/native/business.mjs';

const name='完整插件关闭保存失败：原错误可见、资源仍释放、宿主存活与同进程重新启用';
const flag='BIDV4_UNLOAD_FAILURE_FIXTURE';
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bounded=async(promise,label)=>{
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),10000)})])}finally{clearTimeout(timer)}
};
function errorMessages(value,seen=new Set()){
 if(value===null||value===undefined||seen.has(value))return [];
 if(typeof value!=='object')return [String(value)];
 seen.add(value);
 if(Array.isArray(value))return value.flatMap(item=>errorMessages(item,seen));
 return [...('message'in value?[String(value.message)]:[]),...errorMessages(value.errors,seen),...errorMessages(value.cause,seen)];
}
function databaseSnapshot(path){
 return JSON.parse(execFileSync(pythonExecutable(root),['-X','utf8','-c',`import json,sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
def cell(value):
 return {'blob_hex':value.hex()} if isinstance(value,bytes) else value
schema=list(c.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))
tables={}
for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
 rows=[[cell(value) for value in row] for row in c.execute('SELECT * FROM \"'+name.replace('\"','\"\"')+'\"')]
 tables[name]=sorted(rows,key=lambda row:json.dumps(row,ensure_ascii=True,sort_keys=True,separators=(',',':')))
print(json.dumps({'schema':schema,'user_version':c.execute('PRAGMA user_version').fetchone()[0],'tables':tables},ensure_ascii=False))
c.close()
`,path],{encoding:'utf8'}));
}
async function observe(ctx,id){
 const observation=await ctx.sessionQuery.observeSession(id,{projectionMode:'none'});
 try{return observation.events}finally{observation[Symbol.dispose]()}
}

if(process.env[flag]!=='1')test(name,{timeout:60000},()=>runIsolatedTest('plugin-unload-failure.test.mjs',flag,new RegExp(name),55000));
else test(name,{timeout:50000},async()=>{
 let ctx,oldScope,removeFault,primaryError;
 const teardownErrors=[],requests=[],logs=[];
 const endpoint=createServer(async(req,res)=>{
  try{
   const request=await readJson(req);requests.push(request);
   const instruction=request.messages.findLast(message=>message.role==='user'&&String(message.content).includes('页面输入：'))?.content??'';
   const cwd=instruction.match(/当前任务绝对路径：([^；\r\n]+)/)?.[1];
   const anchor=request.messages.findLastIndex(message=>message.role==='user'&&String(message.content).includes('页面输入：'));
   const alreadyWrote=anchor>=0&&request.messages.slice(anchor).some(message=>message.role==='assistant'&&message.tool_calls?.length);
   const calls=cwd&&!alreadyWrote?analysis.map(key=>({index:analysis.indexOf(key),id:'write-'+key,type:'function',function:{name:'write',arguments:JSON.stringify({file_path:join(cwd,'work/analysis',key+'.md'),content:'# 关闭失败隔离夹具 '+key+'\n合成内容：验证正常成果持久化与插件关闭后的保留。'})}})):[];
   const delta=calls.length?{tool_calls:calls}:{content:'正常执行已完成，原有成果保留。'};
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'unload-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
   res.end('data: [DONE]\n\n');
  }catch(error){res.destroy(error)}
 });
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 try{
  const profile=join(process.env.DSH_HOME,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});
  await symlink(root,join(profile,'node_modules/ooo-bidpliot'),process.platform==='win32'?'junction':'dir');
  await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
   {id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},
   {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BIDV4_UNLOAD_FAILURE_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'Local unload failure fixture',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
   {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
   {id:'session-title-llm',disabled:true},
  ]));
  process.env.BIDV4_UNLOAD_FAILURE_KEY='local-test-only';
  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
  ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
  ctx.logger.exporter({levels:{default:4},export:entry=>logs.push(entry)});
  const runtime=ctx.get('bidBusiness');assert.ok(runtime);
  oldScope=runtime.ctx.fiber;const startedScope={uid:oldScope.uid,state:oldScope.state};assert.ok(startedScope.uid>0);assert.equal(startedScope.state,2);
  const entry=[...ctx.loader.entries()].find(item=>item.options.id==='ooo-bidpliot');assert.ok(entry?.fiber);
  const base='http://127.0.0.1:'+ctx.webServer.port,login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');assert.ok(cookie);
  async function api(path,body){
   const response=await fetch(base+'/api/bidv4'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
   const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
  }
  const {task}=await api('/tasks',{title:'完整插件关闭保存失败验收',request_id:randomUUID()});
  const source=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64'),upload=new FormData();upload.set('file',new Blob([source],{type:'image/png'}),'隔离原件.png');await api('/files?task_id='+task.id,upload);
  const initial=await api('/page-flow/'+task.id),admitted=await api('/page-flow/'+task.id+'/action',{kind:'analyse',request_id:randomUUID(),input_version:initial.input_versions.analyse,main_file:'隔离原件.png',supplements:[]});
  const handle=runtime.handles.get(admitted.session_id);assert.ok(handle);await bounded(handle.agent.whenIdle(),'normal agent turn');await runtime.settling.get(task.id);await ctx.sessions.flush(handle.agent.session);
  const complete=await api('/page-flow/'+task.id);assert.equal(complete.execution.state,'completed');assert.equal(complete.files.filter(file=>file.path.startsWith('analysis/')).length,8);
  const originalEvents=await observe(ctx,admitted.session_id);assert.equal(originalEvents.findLast(event=>event.type==='turn/end').data.reason.kind,'completed');assert.ok(originalEvents.some(event=>event.type==='tool/result'));
  const retainedPaths=[join(dataRoot,'app.db'),join(dataRoot,'workspace',task.id,'sources/隔离原件.png'),...analysis.map(key=>join(dataRoot,'workspace',task.id,'work/analysis',key+'.md'))];
  const originalFiles=new Map(await Promise.all(retainedPaths.map(async path=>[path,sha(await readFile(path))])));
  const originalDatabase=databaseSnapshot(join(dataRoot,'app.db'));
  const sessionRoot=join(process.env.DSH_HOME,'sessions'),sessionFiles=(await readdir(sessionRoot,{recursive:true})).filter(path=>path.includes(admitted.session_id)&&/\.jsonl(?:\.zstd)?$/.test(path));assert.ok(sessionFiles.length);
  assert.equal(runtime.handles.size,1);assert.deepEqual(await readdir(join(dataRoot,'locks')),[]);assert.equal((await readdir(join(dataRoot,'.hosts'))).length,1);

  // Inject after successful persistence. Only the explicit close-time flush of
  // this business Agent fails; the host and subsequent cleanup remain usable.
  const injected=new Error('BIDV4_FIXTURE_SHUTDOWN_FLUSH_REJECTED');let faultHits=0,closing=false;
  removeFault=ctx.on('session/flush',session=>{if(closing&&session.id===admitted.session_id&&faultHits===0){faultHits++;throw injected}},{global:true});
  closing=true;const directErrors=[];
  try{await entry.update({disabled:true})}catch(error){directErrors.push(error)}
  await bounded(ctx.loader.await(),'plugin disable');
  assert.equal(faultHits,1,'The complete plugin must attempt its final business-session flush');
  const observedErrors=[...directErrors,...logs.flatMap(entry=>entry.args)];
  assert.ok(observedErrors.flatMap(value=>errorMessages(value)).includes(injected.message),'The original close-time save error must remain observable in the loader result or host diagnostics');
  const unloaded={scopeUid:oldScope.uid,scopeState:oldScope.state,hostClaims:await readdir(join(dataRoot,'.hosts')),locks:await readdir(join(dataRoot,'locks')),agentPresent:!!ctx.agents.get(admitted.session_id),handles:runtime.handles.size,settling:runtime.settling.size,pendingHandles:runtime.pendingHandles.size,businessProvided:!!ctx.get('bidBusiness'),pageStatus:(await fetch(base+'/api/bidv4/tasks',{headers:{Cookie:cookie}})).status};
  assert.deepEqual(unloaded,{scopeUid:null,scopeState:4,hostClaims:[],locks:[],agentPresent:false,handles:0,settling:0,pendingHandles:0,businessProvided:false,pageStatus:404},'A rejected save must still finish every complete-plugin resource release');
  for(const [path,digest]of originalFiles)assert.equal(sha(await readFile(path)),digest,'Unload must preserve '+path);
  for(const path of sessionFiles)assert.ok((await stat(join(sessionRoot,path))).size>0,'Original official session file remains present');
  assert.deepEqual((await observe(ctx,admitted.session_id)).slice(0,originalEvents.length),originalEvents,'The persisted native event prefix remains unchanged');
  removeFault();removeFault=undefined;

  const host=await ctx.agents.create({sessionId:'host-after-rejected-save',meta:{cwd:root},agentOptions:{provider:'fixture',model:'fixture'}});
  try{host.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Host model remains usable after a plugin save failure.'}]}));await bounded(host.agent.whenIdle(),'host after unload');assert.equal(host.agent.session.snapshotEvents().findLast(event=>event.type==='turn/end').data.reason.kind,'completed')}finally{await host.dispose()}
  const beforeRestart=requests.length;
  await entry.update({disabled:false});await bounded(ctx.loader.await(),'plugin re-enable');
  const reloaded=ctx.get('bidBusiness');assert.ok(reloaded,'The same host must load the plugin again after removing the fault');assert.notEqual(reloaded,runtime);assert.notEqual(reloaded.ctx.fiber.uid,startedScope.uid);
  assert.equal((await api('/tasks')).tasks[0].id,task.id);const restored=await api('/page-flow/'+task.id);assert.equal(restored.session_id,admitted.session_id);assert.equal(restored.execution.state,'completed');assert.equal(restored.files.filter(file=>file.path.startsWith('analysis/')).length,8);assert.equal(requests.length,beforeRestart,'Reloading and reading retained data must not dispatch a model');
  // SQLite may rewrite its physical header during a normal reopen. Compare
  // every schema entry and every typed table value, including BLOB bytes.
  assert.deepEqual(databaseSnapshot(join(dataRoot,'app.db')),originalDatabase,'Re-enable must preserve the database schema, version and every table row');
  for(const [path,digest]of originalFiles)if(path!==join(dataRoot,'app.db'))assert.equal(sha(await readFile(path)),digest,'Re-enable must preserve '+path);
  assert.deepEqual((await observe(ctx,admitted.session_id)).slice(0,originalEvents.length),originalEvents);assert.equal((await readdir(join(dataRoot,'.hosts'))).length,1);
 }catch(error){primaryError=error}
 finally{
  removeFault?.();
  // Explicit test cleanup follows the assertions so a production scope leak
  // cannot turn into a passing test, or leave the failed fixture process alive.
  if(oldScope?.uid!==null&&oldScope?.uid!==undefined)try{await oldScope.dispose();while(oldScope.inertia)await oldScope.inertia}catch(error){teardownErrors.push(error)}
  try{await ctx?.fiber.dispose()}catch(error){teardownErrors.push(error)}
  endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));
 }
 if(primaryError)throw primaryError;
 assert.deepEqual(teardownErrors,[]);
});
