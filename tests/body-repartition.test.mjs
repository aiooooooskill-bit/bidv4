import {pythonExecutable} from '../server/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Llm,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import DefaultModel from '@deepseek-ai/dsh-agent-default-model';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import {join} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createBusinessScope} from './helpers/runtime-host.mjs';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {business,root,dataRoot} from '../server/native/business.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';

const title='既有正文归集仅限完整制作主线程，输出逐节校验后实际合册，原其他章节和共享准备保留';
if(process.env.BIDV4_BODY_REPARTITION!=='1')test(title,{timeout:60000},()=>runIsolatedTest('body-repartition.test.mjs','BIDV4_BODY_REPARTITION',new RegExp(title)));
else test(title,{timeout:45000},async()=>{
 const python=source=>JSON.parse(execFileSync(pythonExecutable(root),['-B','-c',`import sys,os,json,asyncio,hashlib
sys.path.insert(0,${JSON.stringify(join(root,'business/python'))});os.environ['DATA_DIR']=${JSON.stringify(dataRoot)}
from app import db,artifact_store,publish
from app.services import bidder,company_library as lib,build_state
from docx import Document
db.init_db()
${source}`],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 const {tid,sha}=python(`c=asyncio.run(lib.save_company(lib.CompanyBody(name='正文保全验收主体',profile={'legal_name':'验收代表'})))
t=db.create_task('正文归集工具链回归');tid=t['id'];artifact_store.ensure_task_skeleton(tid)
asyncio.run(bidder.save_bidder(tid,bidder.BidderBody(company_id=c['id'],signer_id='legal',sign_date='2026-10-16')))
publish.publish_artifact('tender.directory/tender-response-docs@1',{'response_documents':[{'name':'技术标','directory':[{'目录名称':'实施方案','children':[{'目录名称':'接口对接'},{'目录名称':'故障处置'}]},{'目录名称':'其他章节'}]}]},task_id=tid)
r=artifact_store.work_dir(tid)
(r/'body/写作指引.md').write_text('# 写作指引\\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\\n|---|---|---|---|---|\\n'+''.join('| '+name+' | 推理撰写 | — | — | 无 |\\n' for name in ['实施方案','接口对接','故障处置','其他章节']))
(r/'body/关键事实与承诺.md').write_text('| 事项 | 值 |\\n|---|---|\\n| 服务期 | 三年 |')
d=Document();d.add_heading('实施方案',1);d.add_paragraph('原有总说明，服务期三年。');d.add_heading('接口对接',2);d.add_paragraph('原有接口正文。');d.add_heading('故障处置',2);d.add_paragraph('原有故障正文。');d.save(r/'body/实施方案.docx')
e=Document();e.add_heading('其他章节',1);e.add_paragraph('既有其他章节，不在归集范围。');e.save(r/'body/其他章节.docx')
build_state.record_preparation(tid,'guide');build_state.record_preparation(tid,'promises')
for p in ['body/实施方案.docx','body/其他章节.docx']:build_state.record_section(tid,p)
print(json.dumps({'tid':tid,'sha':hashlib.sha256((r/'body/实施方案.docx').read_bytes()).hexdigest()}))`);
 const cwd=join(dataRoot,'workspace',tid),source=join(cwd,'work/body/实施方案.docx');
 const original=await readFile(source),other=await readFile(join(cwd,'work/body/其他章节.docx'));
 const shared=await Promise.all(['写作指引.md','关键事实与承诺.md'].map(n=>readFile(join(cwd,'work/body',n))));
 const args={path:'body/实施方案.docx',expected_sha256:sha,assignments_json:JSON.stringify([{title:'实施方案',ranges:[[1,2]]},{title:'接口对接',ranges:[[3,4]]},{title:'故障处置',ranges:[[5,6]]}])};
 let phase='',step=0,blocked=false;
 class Adapter extends LlmAdapter{
  providerInfo(id){return {id,name:'Body repartition policy regression'}}
  async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:131072},defaultMaxTokens:16384,inputModalities:['text','image']}}
  async *stream(options){
   const user=options.messages.findLast(m=>m.role==='user'),mode=JSON.stringify(user).includes('完整制作')?'build':'body';
   if(phase!==mode){phase=mode;step=0}
   const last=options.messages.findLast(m=>m.role==='tool');
   if(step>0){if(mode==='body'){assert.equal(last.isError,true);blocked=true}else{assert.ok(!last.isError,JSON.stringify(last));if(step>=2&&step<=4)assert.ok(last.content.some(x=>x.text?.startsWith('[校验通过]')),JSON.stringify(last))}}
   const calls=mode==='body'?[['docx_section_repartition',args]]:[['docx_section_repartition',args],...['实施方案','接口对接','故障处置'].map(n=>['validate_body',{section:'body/'+n+'.docx'}]),['docx_assemble_volume',{}]];
   const call=calls[step++];const block=call?{type:'tool-call',id:mode+'-'+step,name:call[0],arguments:JSON.stringify(call[1])}:{type:'text',text:'保全工具链验证完成。'};
   yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:call?'tool-calls':'stop'}};
  }
 }
 const id='body-repartition-main',host=new Context();let scope,runtime,handle;
 try{
  host.plugin(Loader,{baseUrl:new URL('../package.json',import.meta.url).href});host.plugin(Llm);host.plugin(Subprocess);host.plugin(DefaultModel,{provider:'fixture',model:'fixture'});host.plugin(Attachments,{dshHome:join(dataRoot,'attachments')});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Host unavailable')),8000);host.inject(['llm','subprocess','agentDefaultModel','attachments','loader'],()=>{clearTimeout(timer);resolve()})});host.llm.registerAdapter(['fixture'],new Adapter());
  scope=await createBusinessScope(host,join(dataRoot,'runtime'));runtime=new BusinessRuntime(scope.ctx);await runtime.init();scope.ctx.reflect.provide('bidBusiness',runtime);scope.ctx.reflect.provide('webServer',{port:0});await runtime.skillsLink(cwd);
  handle=await scope.ctx.agents.create({sessionId:id,meta:{cwd,agentPreset:'ooo-bidpliot'},agentOptions:{provider:'fixture',model:'fixture'},setup:async c=>{await scope.ctx.agentPresets.mount(c,'ooo-bidpliot')}});
  const folder=join(dataRoot,'actions',tid);await mkdir(folder,{recursive:true});
  const record={kind:'body',session_id:id,section_paths:['body/接口对接.docx','body/故障处置.docx']};await writeFile(join(folder,'latest.json'),JSON.stringify(record));
  handle.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'单章阶段归集限制验证'}]}));await handle.agent.whenIdle();assert.ok(blocked);assert.ok((await readFile(source)).equals(original));
  await writeFile(join(folder,'latest.json'),JSON.stringify({...record,kind:'build'}));
  handle.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'完整制作归集并逐节校验与合册'}]}));await handle.agent.whenIdle();
  assert.equal(handle.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'completed');
  const state=await business(scope.ctx,'state',{task_id:tid});assert.equal(state.body_sections.length,4);assert.ok(state.body_sections.every(s=>s.status==='ready'));assert.deepEqual(state.orphan_body_files,[]);assert.equal(state.volume_states[0].status,'ready');
  assert.ok((await readFile(join(cwd,'work/body/其他章节.docx'))).equals(other));
  for(const [i,n] of ['写作指引.md','关键事实与承诺.md'].entries())assert.ok((await readFile(join(cwd,'work/body',n))).equals(shared[i]));
  const facts=python(`from docx.oxml.ns import qn
r=artifact_store.work_dir(${JSON.stringify(tid)});d=Document(r/'body/整本-技术标.docx');text='\\n'.join(p.text for p in d.paragraphs);print(json.dumps({'count':[text.count(s) for s in ['原有总说明，服务期三年。','原有接口正文。','原有故障正文。','既有其他章节，不在归集范围。']],'published':len([x for x in db.list_artifact_index(task_id=${JSON.stringify(tid)}) if x['kind']=='tender.volume'])}))`);
  assert.deepEqual(facts.count,[1,1,1,1]);assert.equal(facts.published,1);
 }finally{await handle?.dispose();await runtime?.close();await scope?.close();await host.fiber.dispose()}
});
