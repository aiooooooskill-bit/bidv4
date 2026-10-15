// Exercise the production implementation in a disposable application copy.
import {cp,mkdtemp,mkdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url));
const candidate=process.argv[2]??'auto';
if(!['auto','real'].includes(candidate))throw new Error('Use auto or real');
const temporary=await mkdtemp(join(tmpdir(),'bidv4-preparation-'));
let activeChild;
process.once('SIGINT',()=>activeChild?.kill('SIGTERM'));
try{
 for(const dir of ['server','shared','tests'])await cp(join(root,dir),join(temporary,dir),{recursive:true});
 for(const file of ['package.json','package-lock.json','cordis.patch.yml'])await cp(join(root,file),join(temporary,file));
 for(const dir of ['node_modules','dist'])await symlink(join(root,dir),join(temporary,dir),process.platform==='win32'?'junction':'dir');
 await mkdir(join(temporary,'business/python'),{recursive:true});
 await cp(join(root,'business/python/app'),join(temporary,'business/python/app'),{recursive:true});
 await cp(join(root,'business/python/runner.py'),join(temporary,'business/python/runner.py'));
 await symlink(join(root,'business/python/.venv'),join(temporary,'business/python/.venv'),process.platform==='win32'?'junction':'dir');
 const env={...process.env,DSH_HOME:join(temporary,'dsh-home'),DSH_TELEMETRY_DISABLED:'1',PREPARATION_CANDIDATE:candidate,PREPARATION_REPORT:join(root,'docs/evidence/preparation-fixed-'+candidate+'.json')};
 delete env.NODE_TEST_CONTEXT;delete env.DSH_TOOLS_MODE;
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--test','tests/experiments/preparation-flow.mjs'],{cwd:temporary,env,stdio:'inherit'});
  activeChild=child;
  const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),3000).unref()},candidate==='real'?1920000:150000);
  child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',code=>{clearTimeout(timer);resolve(code??1)});
 });
 process.exitCode=code;
}finally{await rm(temporary,{recursive:true,force:true})}
