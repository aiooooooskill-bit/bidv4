import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

// Copy application code so its fixed dataRoot resolves inside the fixture.
// Dependencies, assets and Python tools are reused without copying user data.
export async function runIsolatedTest(filename,flag,expected,timeout=60000){
 const root=fileURLToPath(new URL('../..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'bidv4-app-test-'));
 let child;
 try{
  for(const dir of ['server','shared','tests'])await cp(join(root,dir),join(temporary,dir),{recursive:true});
  for(const file of ['package.json','package-lock.json','cordis.patch.yml'])await cp(join(root,file),join(temporary,file));
  for(const dir of ['node_modules','business','dist','src'])await symlink(join(root,dir),join(temporary,dir),'dir');
  await mkdir(join(temporary,'dsh-home'),{recursive:true});
  const env={...process.env,[flag]:'1',DSH_HOME:join(temporary,'dsh-home'),DSH_TELEMETRY_DISABLED:'1'};
  delete env.NODE_TEST_CONTEXT;delete env.DSH_TOOLS_MODE;
  const result=await new Promise((resolve,reject)=>{
   child=spawn(process.execPath,['--test',join(temporary,'tests',filename)],{cwd:temporary,env,stdio:['ignore','pipe','pipe']});let output='';
   child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{output+=b});child.on('error',reject);
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Isolated application fixture timed out'))},timeout);
   child.on('close',code=>{clearTimeout(timer);resolve({code,output})});
  });
  assert.equal(result.code,0,result.output.replace(/([?&]token=)[^\s)]+/g,'$1[redacted]'));
  assert.doesNotMatch(result.output,/flush on a closed handle|best-effort final session flush failed|session-persistence: final drain[^\n]*failed/,'Session teardown must not hide persistence failures in successful fixture output');
  assert.match(result.output,expected);
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve))}
  await rm(temporary,{recursive:true,force:true});
 }
}
