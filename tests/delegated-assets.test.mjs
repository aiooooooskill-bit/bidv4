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
import {createBusinessScope} from '../server/native/scope.mjs';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {business,root,dataRoot} from '../server/native/business.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';

const title='正式task派发在子Agent执行前传入父线程资料，并在返回后传回子线程资料';
if(process.env.BIDV4_DELEGATED_ASSETS!=='1')test(title,{timeout:60000},()=>runIsolatedTest('delegated-assets.test.mjs','BIDV4_DELEGATED_ASSETS',new RegExp(title)));
else test(title,{timeout:45000},async()=>{
 const python=source=>JSON.parse(execFileSync(join(root,'business/python/.venv/bin/python'),['-c',`import sys,os,json,asyncio
sys.path.insert(0,${JSON.stringify(join(root,'business/python'))});os.environ['DATA_DIR']=${JSON.stringify(dataRoot)}
from app import db,artifact_store,company_store as cs,publish
from app.services import bidder,company_library as lib,build_state
from app.knowledge import ingest,store
db.init_db()
${source}`],{encoding:'utf8'}));
 const {tid,a,b}=python(`c=asyncio.run(lib.save_company(lib.CompanyBody(name='派发验收公司',profile={'legal_name':'法人'})))
t=db.create_task('派发回归');tid=t['id'];artifact_store.ensure_task_skeleton(tid)
asyncio.run(bidder.save_bidder(tid,bidder.BidderBody(company_id=c['id'],signer_id='legal',sign_date='2026-10-13')))
ids=[]
for key in ('A','B'):
 i=db.kb_insert_item(file_name=key+'.png',file_hash=key,title=key,ext='.png');cs.attach_asset(i['id'],c['id'])
 ingest.finish(i['id'],{'doc_type':'qualification_certificate','extra':{'证号':{'value':'DELEGATE'+key}}});ids.append(i['id'])
publish.publish_artifact('tender.directory/tender-response-docs@1',{'response_documents':[{'name':'技术标','directory':[{'目录名称':'实施方案'},{'目录名称':'服务保障'}]}]},task_id=tid)
r=artifact_store.work_dir(tid)
(r/'body/写作指引.md').write_text('# 写作指引\\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\\n|---|---|---|---|---|\\n| 实施方案 | 推理撰写 | — | — | 无 |\\n| 服务保障 | 推理撰写 | — | — | 无 |')
(r/'body/关键事实与承诺.md').write_text('| 事项 | 值 |\\n|---|---|\\n| 维护 | 三年 |')
build_state.record_preparation(tid,'guide');build_state.record_preparation(tid,'promises')
print(json.dumps({'tid':tid,'a':ids[0],'b':ids[1]}))`);
 let childId,seedChecked=false;
 class Adapter extends LlmAdapter{
  providerInfo(id){return {id,name:'Delegated asset regression'}}
  async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:131072},defaultMaxTokens:16384,inputModalities:['text','image']}}
  async *stream(options){
   const tools=options.messages.filter(m=>m.role==='tool'),last=tools.at(-1),prompt=JSON.stringify(options.messages.filter(m=>m.role==='user'));
   const child=prompt.includes('公司材料与缺口')||prompt.includes('〔系统附');
   let call;
   if(child){
    if(!tools.length){
     const ledger=JSON.parse(await readFile(join(dataRoot,'workspace',tid,'work/body/.build-state.json'),'utf8'));
     const entry=Object.entries(ledger.asset_reads).find(([id])=>id!==parentId);assert.ok(entry);childId=entry[0];assert.ok(entry[1].assets[a]);seedChecked=true;
     call=['read_company_asset',{item_id:b}];
    }else if(tools.length===1)call=['docx_section_create',{path:'body/实施方案.docx',title:'实施方案',paragraphs:'采用父线程证件DELEGATEA和本线程证件DELEGATEB。'}];
    else if(tools.length===2)call=['validate_body',{section:'body/实施方案.docx'}];
   }else{
    if(!tools.length)call=['read_company_asset',{item_id:a}];
    else if(tools.length===1)call=['task',{subagent_type:'tender-body-writer',description:'实施方案\n采用已读取的证号DELEGATEA，直接写入正文，不重复查询A。'}];
    else if(tools.length===2){
     const ledger=JSON.parse(await readFile(join(dataRoot,'workspace',tid,'work/body/.build-state.json'),'utf8'));assert.ok(ledger.asset_reads[parentId].assets[b]);
     call=['docx_section_create',{path:'body/服务保障.docx',title:'服务保障',paragraphs:'采用写手返回的证件事实DELEGATEB。'}];
    }else if(tools.length===3)call=['validate_body',{section:'body/服务保障.docx'}];
   }
   if(last)assert.ok(!last.isError,JSON.stringify(last));
   if(last?.content?.some(x=>x.type==='text'&&x.text.startsWith('[校验')))assert.ok(last.content.some(x=>x.text?.startsWith('[校验通过]')),JSON.stringify(last));
   const block=call?{type:'tool-call',id:'step-'+tools.length,name:call[0],arguments:JSON.stringify(call[1])}:{type:'text',text:'采用DELEGATEA、DELEGATEB，章节校验完成。'};
   yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:call?'tool-calls':'stop'}};
  }
 }
 const parentId='delegating-parent',host=new Context();let scope,runtime,handle;
 try{
  host.plugin(Loader,{baseUrl:new URL('../package.json',import.meta.url).href});host.plugin(Llm);host.plugin(Subprocess);host.plugin(DefaultModel,{provider:'fixture',model:'fixture'});host.plugin(Attachments,{dshHome:join(dataRoot,'attachments')});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Host unavailable')),8000);host.inject(['llm','subprocess','agentDefaultModel','attachments','loader'],()=>{clearTimeout(timer);resolve()})});host.llm.registerAdapter(['fixture'],new Adapter());
  scope=await createBusinessScope(host,join(dataRoot,'runtime'));runtime=new BusinessRuntime(scope.ctx);await runtime.init();
  const cwd=join(dataRoot,'workspace',tid);await runtime.skillsLink(cwd);
  handle=await scope.ctx.agents.create({sessionId:parentId,meta:{cwd,agentPreset:'ooo-bidpliot-execution'},agentOptions:{provider:'fixture',model:'fixture'},setup:async c=>{await scope.ctx.agentPresets.mount(c,'ooo-bidpliot-execution')}});
  await mkdir(join(dataRoot,'actions',tid),{recursive:true});await writeFile(join(dataRoot,'actions',tid,'latest.json'),JSON.stringify({kind:'body',session_id:parentId,section_paths:['body/实施方案.docx','body/服务保障.docx']}));
  handle.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'执行资料派发回归'}]}));await handle.agent.whenIdle();
  const reason=handle.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason;
  assert.equal(reason.kind,'completed',JSON.stringify(reason));assert.ok(seedChecked);
  const ledger=JSON.parse(await readFile(join(cwd,'work/body/.build-state.json'),'utf8'));
  for(const path of ['body/实施方案.docx','body/服务保障.docx'])assert.deepEqual(Object.keys(ledger.asset_dependencies[path].assets).sort(),[a,b].sort());
  assert.ok(ledger.asset_reads[childId].assets[a]);
  let state=await business(scope.ctx,'state',{task_id:tid});assert.ok(state.body_sections.every(s=>s.status==='ready'));
  python(`cs.attach_asset(${JSON.stringify(a)},cs.asset_state(${JSON.stringify(a)})['company_id']);print('{}')`);
  state=await business(scope.ctx,'state',{task_id:tid});assert.ok(state.body_sections.every(s=>s.status==='stale'));assert.equal(state.bidder.stale,true);
 }finally{await handle?.dispose();await runtime?.close();await scope?.close();await host.fiber.dispose()}
});
