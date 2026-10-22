import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Llm,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import DefaultModel from '@deepseek-ai/dsh-agent-default-model';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBusinessScope} from './helpers/runtime-host.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {business,dataRoot} from '../server/native/business.mjs';

const title='特殊册名沿用派发路径回传、主Agent读取合并并发布完整目录';
if(process.env.BIDV4_OUTLINE_PATHS_FIXTURE!=='1')test(title,{timeout:90000},()=>runIsolatedTest('outline-fragment-paths.test.mjs','BIDV4_OUTLINE_PATHS_FIXTURE',new RegExp(title),80000));
else test(title,{timeout:70000},async()=>{
 const names=['商务册','技术/资格册','技术:资格册','超长技术响应册'.repeat(12)];
 const preamble='## 项目信息\n- 项目名称：特殊册名路径验收\n- 全局说明：合并必须保留原册序和本说明。\n\n';
 const fragment=name=>'# 响应文件：'+name+'\n本册负责本分册响应内容。\n\n## 目录\n- 封面\n- 目录\n- 实施方案\n\n## 来源标注\n\n## 目录说明\n- 实施方案 :: 交付形态=正文编写 | 归位理由=保留本册实施说明 | 理由来源= | 概述=基线说明\n';
 const text=message=>message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
 const numberedText=message=>[...text(message).matchAll(/^\d+: (.*)$/gm)].map(match=>match[1]).join('\n');
 const assigned=new Map(),receipts=new Map(),readPaths=[];
 let work;
 class Adapter extends LlmAdapter{
  providerInfo(id){return {id,name:'Outline path integration fixture'}}
  async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:131072},defaultMaxTokens:16384,inputModalities:['text','image']}}
  async *stream(options){
   const tools=options.messages.filter(message=>message.role==='tool');
   for(const result of tools)assert.equal(result.isError,false,text(result));
   const prompt=options.messages.filter(message=>message.role==='user').map(text).join('\n');
   const child=prompt.includes('outline-path-child');
   let calls=[],content='';
   if(child){
    const assignment=JSON.parse(prompt.match(/本轮目录依据与原结构约束：([^\n]+)/)[1]);
    const name=assignment.volume.name;
    assert.ok(names.includes(name));
    assigned.set(name,assignment.fragment_path);
    if(!tools.length)calls=[{id:'child-write',name:'write',args:{file_path:assignment.fragment_path,content:fragment(name).replace('概述=基线说明','概述=基线说明；本册已完成核对')}}];
    else content='本册目录已完成，保留原章节与说明。';
   }else{
    switch(tools.length){
     case 0:calls=[{id:'plan-begin',name:'outline_plan',args:{operation:'begin'}}];break;
     case 1:
      // Dispatch in reverse order so merge order must come from response_file.
      calls=[...names].reverse().map((name,index)=>({id:'dispatch-'+index,name:'task',args:{subagent_type:'tender-outline-writer',response_file:name,description:'outline-path-child\n仅写入程序派发的本册fragment，摘要不提供文件路径。'}}));
      break;
     case 5:
      for(const result of tools.slice(1)){
       const receipt=JSON.parse(text(result));
       assert.ok(names.includes(receipt.response_file));
       assert.equal(receipt.fragment_path,assigned.get(receipt.response_file));
       assert.ok(isAbsolute(receipt.fragment_path));
       assert.equal(receipt.summary,'本册目录已完成，保留原章节与说明。');
       assert.equal(receipts.has(receipt.response_file),false);
       receipts.set(receipt.response_file,receipt);
      }
      assert.equal(receipts.size,names.length);
      calls=names.map((name,index)=>{
       const file_path=receipts.get(name).fragment_path;
       readPaths.push(file_path);
       return {id:'read-'+index,name:'read',args:{file_path,offset:1,limit:200}};
      });
      break;
     case 9:{
      const parts=names.map((name,index)=>{
       const part=numberedText(tools.find(result=>result.toolCallId==='read-'+index));
       assert.ok(part.startsWith('# 响应文件：'+name+'\n'));
       assert.ok(part.includes('本册已完成核对'));
       return part;
      });
      calls=[{id:'merge',name:'write',args:{file_path:join(work,'outline/tender-response-docs.md'),content:preamble+parts.join('\n\n')}}];
      break;
     }
     case 10:calls=[{id:'freeze',name:'outline_plan',args:{operation:'complete'}}];break;
     case 11:calls=[{id:'check',name:'check_outline',args:{}}];break;
     case 12:calls=[{id:'publish',name:'assemble_tender',args:{}}];break;
     case 13:
      assert.match(text(tools.at(-1)),/^\[组装发布成功\]/);
      calls=[{id:'read-published',name:'read_artifact',args:{contract:'tender.directory/tender-response-docs@1',view:'full'}}];
      break;
     case 14:{
      const published=JSON.parse(text(tools.at(-1)));
      assert.deepEqual(published.response_documents.map(doc=>doc.name),names);
      for(const doc of published.response_documents)assert.ok(doc.directory.find(node=>node.目录名称==='实施方案').节点概述.includes('本册已完成核对'));
      content='已按回执的实际路径合并并发布全部分册。';
      break;
     }
     default:assert.fail('Unexpected parent step: '+tools.length);
    }
   }
   for(const [index,call] of calls.entries()){
    const block={type:'tool-call',id:call.id,name:call.name,arguments:JSON.stringify(call.args)};
    yield {type:'block-start',index,blockType:block.type};yield {type:'block-end',index,block};
   }
   if(!calls.length){yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:content}}}
   yield {type:'finish',reason:{kind:calls.length?'tool-calls':'stop'}};
  }
 }
 const host=new Context();let scope,runtime,handle;
 try{
  host.plugin(Loader,{baseUrl:new URL('../package.json',import.meta.url).href});host.plugin(Llm);host.plugin(Subprocess);host.plugin(DefaultModel,{provider:'fixture',model:'fixture'});host.plugin(Attachments,{dshHome:join(dataRoot,'host')});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Host unavailable')),8000);host.inject(['llm','subprocess','agentDefaultModel','attachments','loader'],()=>{clearTimeout(timer);resolve()})});
  host.llm.registerAdapter(['fixture'],new Adapter());
  scope=await createBusinessScope(host,join(dataRoot,'runtime'));runtime=new BusinessRuntime(scope.ctx);await runtime.init();scope.ctx.reflect.provide('bidBusiness',runtime);scope.ctx.reflect.provide('webServer',{port:0});
  const {task}=await business(scope.ctx,'create_task',{title:'特殊册名端到端验证',request_id:randomUUID()});
  const cwd=join(dataRoot,'workspace',task.id);work=join(cwd,'work');
  for(const name of ['requirements-format.md','requirements-business.md','evaluation.md'])await writeFile(join(work,'analysis',name),'本工程夹具无额外招标条目。');
  await writeFile(join(work,'outline/tender-response-docs.md'),preamble+names.map(fragment).join('\n'));
  const actionId='outline-paths';
  await business(scope.ctx,'outline_begin',{task_id:task.id,action_id:actionId});
  handle=await runtime.conversation(task.id,{provider:'fixture',model:'fixture'});
  await mkdir(join(dataRoot,'actions',task.id),{recursive:true});
  await writeFile(join(dataRoot,'actions',task.id,'latest.json'),JSON.stringify({task_id:task.id,session_id:handle.agent.id,kind:'outline',action_id:actionId}));
  await runtime.applyStageTools(handle.agent,'outline');
  handle.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'outline-path-parent\n按原册序合并回执指向的全部分册，并保留项目信息后发布。'}]}));
  await handle.agent.whenIdle();
  const reason=handle.agent.session.snapshotEvents().findLast(event=>event.type==='turn/end').data.reason;
  assert.equal(reason.kind,'completed',JSON.stringify(reason));
  assert.equal(assigned.size,names.length);assert.equal(receipts.size,names.length);
  assert.deepEqual(readPaths,names.map(name=>assigned.get(name)));
  assert.equal(new Set(readPaths).size,names.length,'清洗后同名的两册必须保留为不同文件');
  assert.equal(receipts.get(names[0]).fragment_path,join(work,'outline/fragments',names[0]+'.md'));
  for(const name of names.slice(1))assert.notEqual(receipts.get(name).fragment_path,join(work,'outline/fragments',name+'.md'));
  assert.equal((await readdir(join(work,'outline/fragments'))).filter(name=>name.endsWith('.md')).length,names.length);
  const combined=await readFile(join(work,'outline/tender-response-docs.md'),'utf8');assert.ok(combined.startsWith(preamble));
  const state=await business(scope.ctx,'state',{task_id:task.id});
  assert.deepEqual(state.directory.content.response_documents.map(doc=>doc.name),names);
  assert.equal((await business(scope.ctx,'outline_status',{task_id:task.id,action_id:actionId})).ok,true);
 }finally{await runtime?.close();await scope?.close();await host.fiber.dispose()}
});
