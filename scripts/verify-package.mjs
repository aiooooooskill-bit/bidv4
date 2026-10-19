import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {pythonExecutable} from '../server/platform.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const temporary=await mkdtemp(join(tmpdir(),'bid Windows 中文 '));
const target=join(temporary,pkg.name+'-'+pkg.version);
const run=(program,args,{cwd=root,input}={})=>new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd,stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>{if(code===0){if(error)process.stderr.write(error);resolve(output)}else reject(new Error(error+output))});child.stdin.end(input)});
try{
 await run(pythonExecutable(root),['-X','utf8','-c','import sys,tarfile;tarfile.open(sys.argv[1]).extractall(sys.argv[2],filter="data")',join(root,'deliveries',pkg.name+'-'+pkg.version+'.tgz'),temporary]);
 await run(process.execPath,[join(target,'scripts/prepare.mjs')]);
 const {checkInstallation}=await import(new URL('../server/installation.mjs',import.meta.url));
 const doctor=await checkInstallation(target);assert.equal(doctor.ok,true,JSON.stringify(doctor.errors));
 const request={operation:'create_task',data_root:join(target,'data'),args:{title:'Windows 中文路径安装验收',request_id:'f5d621ca-1d86-438e-91b1-82c22c4925f8'}};
 const invoke=async value=>JSON.parse(await run(pythonExecutable(target),['-X','utf8',join(target,'business/python/runner.py')],{cwd:target,input:JSON.stringify(value)}));
 const created=await invoke(request);assert.equal(created.result.task.title,request.args.title);
 const schemas=await invoke({...request,operation:'schemas',args:{}});assert.ok(schemas.result.some(s=>s.name==='docx_section_create'));
 const report={passed:true,platform:process.platform,version:pkg.version,unicodeAndSpaceInstallationPath:true,python:doctor.python,createdTask:created.result.task.title,toolCount:schemas.result.length};
 await mkdir(join(root,'docs/evidence'),{recursive:true});await writeFile(join(root,`docs/evidence/release-${pkg.version}-package-installation.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await rm(temporary,{recursive:true,force:true})}
