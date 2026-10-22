import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Agent,get as httpGet} from 'node:http';

const root=fileURLToPath(new URL('..',import.meta.url));
test('Web运行配置：六个页面不占用常驻HTTP连接，宿主重启后原登录仍有效',{timeout:45000},async()=>{
 const home=await mkdtemp(join(tmpdir(),'bidv4-web-connection-')),profile=join(home,'profiles/web');let child;
 const stop=async()=>{if(!child||child.exitCode!==null)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited};
 const boot=async(port)=>{
  child=spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',join(root,'cordis.web.patch.yml'),'--no-open','--host','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  return await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Web启动超时')),15000);const collect=data=>{output+=data;const url=output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0];if(url){clearTimeout(timer);resolve(new URL(url))}};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Web启动失败：'+output.replace(/([?&]token=)[^\s]+/g,'$1[redacted]')))})});
 };
 try{
  await mkdir(join(profile,'node_modules'),{recursive:true});await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),'dir');
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'],patchReload:'manual'}}}));await writeFile(join(profile,'cordis.yml'),'[]\n');
  const login=await boot(0),base=login.origin;
  assert.equal((await fetch(base)).status,401,'未登录不能访问页面');
  const auth=await fetch(login,{redirect:'manual'});assert.equal(auth.status,303);const cookie=auth.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');assert.ok(cookie);
  const secretBefore=await readFile(join(home,'.credentials.yaml'));
  const agent=new Agent({keepAlive:true,maxSockets:6});
  const get=path=>new Promise((resolve,reject)=>{const req=httpGet(base+path,{agent,headers:{Cookie:cookie}},res=>{let bytes=0;res.on('data',data=>bytes+=data.length);res.once('end',()=>resolve({status:res.statusCode,bytes}))});req.setTimeout(3000,()=>req.destroy(Error('HTTP连接被占满')));req.once('error',reject)});
  try{
   assert.ok((await Promise.all(Array.from({length:6},()=>get('/plugins/events')))).every(r=>r.status===404),'运行配置不保留热更新SSE');
   assert.ok((await Promise.all(Array.from({length:8},()=>get('/')))).every(r=>r.status===200&&r.bytes>100),'六连接池仍可读页面');
  }finally{agent.destroy()}
  await stop();await boot(Number(login.port));
  const restored=await fetch(base,{headers:{Cookie:cookie},signal:AbortSignal.timeout(3000)});assert.equal(restored.status,200,'复用原Cookie，无需重新打开登录入口');await restored.text();
  assert.deepEqual(await readFile(join(home,'.credentials.yaml')),secretBefore,'重启不轮换已有认证密钥');
  assert.equal((await fetch(base,{signal:AbortSignal.timeout(3000)})).status,401,'重启后仍要求认证');
 }finally{await stop();await rm(home,{recursive:true,force:true})}
});
