import {pythonExecutable} from '../server/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {root,dataRoot,business} from '../server/native/business.mjs';
import {installExecutionGuard} from '../server/native/execution-guard.mjs';

const title='实际指引写入绑定证据快照，局部修改与无变化写入不重新解释旧引用';
if(process.env.BIDV4_GUIDE_EVIDENCE_FIXTURE!=='1')test(title,()=>runIsolatedTest('guide-evidence-guard.test.mjs','BIDV4_GUIDE_EVIDENCE_FIXTURE',new RegExp(title)));
else test(title,async()=>{
 const python=source=>JSON.parse(execFileSync(pythonExecutable(root),['-X','utf8','-c',`import os,sys,asyncio,json
sys.path.insert(0,${JSON.stringify(join(root,'business/python'))});os.environ['DATA_DIR']=${JSON.stringify(dataRoot)}
from app import db,artifact_store,publish
from app.services import company_library as lib,bidder,build_state
db.init_db()
${source}`],{encoding:'utf8'}));
 const {tid}=python(`company=asyncio.run(lib.save_company(lib.CompanyBody(name='证据隔离测试公司',profile={'legal_name':'法人'})))
task=db.create_task('医疗设备采购');tid=task['id'];artifact_store.ensure_task_skeleton(tid)
asyncio.run(bidder.save_bidder(tid,bidder.BidderBody(company_id=company['id'],signer_id='legal',sign_date='2026-10-13')))
content={'response_documents':[{'name':'响应文件','directory':[{'目录名称':'交付方案'}]}],'registry':{'REQ-01':{'type':'需求','text':'旧设备要求','出处':'设备要求.pdf L12-L14'}}}
publish.publish_artifact('tender.directory/tender-response-docs@1',content,task_id=tid)
print(json.dumps({'tid':tid}))`);
 const cwd=join(dataRoot,'workspace',tid),path=join(cwd,'work/body/写作指引.md'),action=join(dataRoot,'actions',tid);
 await mkdir(action,{recursive:true});await writeFile(join(action,'latest.json'),JSON.stringify({kind:'guide',session_id:'evidence-session'}));
 const subprocess={spawn(options){const child=spawn(options.argv[0],options.argv.slice(1),{cwd:options.cwd,stdio:'pipe'});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',exitCode=>resolve({exitCode}))});return {stdin:child.stdin,done,collected:{stdout:{readFrom:()=>({text:stdout})},stderr:{readFrom:()=>({text:stderr})}},terminate(){if(child.exitCode===null)child.kill()},waitForExit(){return done}}}};
 let handler;const ctx={subprocess,on(name,fn){if(name==='tools/execute')handler=fn;return ()=>{}},fs:{async resolve(path){return {targetKey:resolve(path),displayPath:resolve(path)}}}};
 installExecutionGuard(ctx,()=>{});
 const agent={session:{id:'evidence-session',header:{cwd}}},signal=new AbortController().signal;
 const write=async(name,content)=>handler({name,agent,arguments:{file_path:path,content,old_string:'无',new_string:'补充'},signal},async()=>{await writeFile(path,content);return {content:[{type:'text',text:'写入完成'}]}});
 const currentGuide=async()=> (await business(ctx,'state',{task_id:tid})).files.find(file=>file.path==='body/写作指引.md');
 const first='| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 交付方案 | 推理撰写 | REQ-01 | — | 无 |\n';
 await write('write',first);
 assert.equal((await currentGuide()).registry['REQ-01'].text,'旧设备要求');
 python(`content={'response_documents':[{'name':'响应文件','directory':[{'目录名称':'交付方案'}]}],'registry':{'REQ-01':{'type':'需求','text':'重排后另一设备要求','出处':'设备补充.pdf L24-L26'}}}
publish.publish_artifact('tender.directory/tender-response-docs@1',content,task_id=${JSON.stringify(tid)})
print('{}')`);
 const partial=first.replace('无','补充用户说明');
 await write('edit',partial);
 assert.equal((await currentGuide()).registry['REQ-01'].text,'旧设备要求');
 await write('write',partial);
 assert.equal((await currentGuide()).registry['REQ-01'].text,'旧设备要求');
 await write('write',partial+'\n本次重新生成的指引\n');
 assert.equal((await currentGuide()).registry['REQ-01'].text,'重排后另一设备要求');
 python(`state=build_state.read(${JSON.stringify(tid)});state.pop('guide_evidence');build_state.save(${JSON.stringify(tid)},state);print('{}')`);
 await write('edit',(await readFile(path,'utf8'))+'\n局部说明\n');
 assert.equal((await currentGuide()).registry,undefined);
 await handler({name:'write',agent,arguments:{file_path:path,content:'未成功写入'},signal},async()=>({isError:true}));
 assert.equal((await currentGuide()).registry,undefined);
});
