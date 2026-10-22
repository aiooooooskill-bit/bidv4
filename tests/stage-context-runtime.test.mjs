import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Llm,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import DefaultModel from '@deepseek-ai/dsh-agent-default-model';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createBusinessScope} from './helpers/runtime-host.mjs';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {business,dataRoot} from '../server/native/business.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
const name='阶段归档：完整证据、确认问答、同轮审核与冷恢复';
const user=text=>createUserMessage({source:{kind:'human'},content:[{type:'text',text}]});
const requests=[];let evidence,archiveReadPath;
class Adapter extends LlmAdapter{
 providerInfo(id){return {id,name:'Deterministic engineering fixture'}}
 async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:4096,inputModalities:['text']}}
 async *stream(options){
  requests.push(options);const last=options.messages.findLast(m=>m.role==='tool'||['human','user','user-question-reply'].includes(m.source?.kind)),text=last?.content.filter(b=>b.type==='text').map(b=>b.text).join('')??'';
  const block=last?.role==='user'&&text==='fixture-archive'?{type:'tool-call',id:'archive-read',name:'read',arguments:JSON.stringify({file_path:archiveReadPath,limit:1000})}:last?.role==='user'&&text==='fixture-read'?{type:'tool-call',id:'evidence-read',name:'read',arguments:JSON.stringify({file_path:evidence,limit:1000})}:last?.role==='user'&&text==='fixture-question'?{type:'tool-call',id:'confirm-term',name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'term',question:'三年是否包含准备期？',options:[{label:'包含',description:'三年包括准备期'},{label:'不包含',description:'三年不包括准备期'}]}]})}:{type:'text',text:'fixture completed'};
  yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
 }
}
async function ready(ctx,names){await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Missing services')),8000);ctx.inject(names,c=>{clearTimeout(t);resolve(c)})})}
if(process.env.BIDV4_STAGE_CONTEXT_FIXTURE!=='1')test(name,{timeout:60000},()=>runIsolatedTest('stage-context-runtime.test.mjs','BIDV4_STAGE_CONTEXT_FIXTURE',new RegExp(name),55000));
else test(name,{timeout:45000},async()=>{
 const host=new Context();let scope,runtime,h;
 try{
  host.plugin(Loader,{baseUrl:new URL('../package.json',import.meta.url).href});host.plugin(Llm);host.plugin(Subprocess);host.plugin(DefaultModel,{provider:'fixture',model:'fixture'});await ready(host,['llm','subprocess','agentDefaultModel','loader']);host.llm.registerAdapter(['fixture'],new Adapter());await host.plugin(Attachments,{dshHome:join(dataRoot,'host')});await ready(host,['attachments']);
  scope=await createBusinessScope(host,join(dataRoot,'scope'));runtime=new BusinessRuntime(scope.ctx);await runtime.init();scope.ctx.reflect.provide('bidBusiness',runtime);scope.ctx.reflect.provide('webServer',{port:0});
  const task=await business(scope.ctx,'create_task',{title:'阶段隔离工程测试',request_id:'495941b0-e646-4d73-bfa0-a74f80a6d306'}),tid=task.task.id;
  h=await runtime.conversation(tid);const id=h.agent.id;
  evidence=join(dataRoot,'workspace',tid,'work','evidence.txt');const bytes='本条款在适用包3且另有书面约定时生效。'.repeat(1000);await writeFile(evidence,bytes);
  for(const text of ['用户确认：只投包3，服务期三年。','fixture-read','fixture-question']){h.agent.followup(user(text));await h.agent.whenIdle()}
  assert.ok(scope.ctx.userQuestions.answer(h.agent,'confirm-term',{answers:[{id:'term',selected:['包含']}]}));await h.agent.whenIdle();
  const before=h.agent.session.snapshotEvents(),beforeSeq=h.agent.session.seq;
  const confirmations=h.agent.session.deriveMessages().filter(m=>m.role==='user');
  const dir=join(dataRoot,'actions',tid);await mkdir(dir,{recursive:true});const record={action_id:'review-stage',session_id:id,task_id:tid,kind:'review',start_seq:beforeSeq,history_before_seq:beforeSeq,model:{provider:'fixture',model:'fixture'}};
  for(const file of ['latest.json','review-stage.json'])await writeFile(join(dir,file),JSON.stringify(record));
  h.agent.followup(user('开始审核阶段'));await h.agent.whenIdle();
  const saved=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));assert.equal(saved.stage_context.archives.length,1);
  const after=h.agent.session.deriveMessages();for(const message of confirmations)assert.ok(after.some(m=>JSON.stringify(m)===JSON.stringify(message)),'用户确认原文不可丢失');
  assert.ok(after.some(m=>m.content.some(b=>b.type==='tool-call'&&b.name==='ask_user_question')),'保留问题本身及答复的完整工具单元');
  assert.deepEqual(h.agent.session.snapshotEvents().slice(0,before.length),before);
  const archive=saved.stage_context.archives[0],raw=await readFile(archive.path);assert.equal(createHash('sha256').update(raw).digest('hex'),archive.sha256);assert.ok(raw.toString().includes('本条款在适用包3且另有书面约定时生效。'));
  assert.equal(await readFile(evidence,'utf8'),bytes);assert.equal(requests.at(-1).messages.some(m=>m.role==='tool'&&JSON.stringify(m).includes('本条款在适用包3')),false);
  archiveReadPath=archive.path;h.agent.followup(user('fixture-archive'));await h.agent.whenIdle();assert.ok(h.agent.session.snapshotEvents().some(e=>e.type==='tool/result'&&e.data.message.toolCallId==='archive-read'&&JSON.stringify(e.data.message).includes('本条款在适用包3且另有书面约定时生效。')),'审核需要旧证据时可回读完整归档');
  const count=h.agent.session.snapshotEvents().filter(e=>e.type==='compaction/summary').length;
  h.agent.followup(user('继续本轮审核下一批并更正第一批'));await h.agent.whenIdle();assert.equal(h.agent.session.snapshotEvents().filter(e=>e.type==='compaction/summary').length,count,'同轮审核不再归档');
  await scope.ctx.sessions.flush(h.agent.session);await runtime.close();await scope.close();
  scope=await createBusinessScope(host,join(dataRoot,'scope'));runtime=new BusinessRuntime(scope.ctx);await runtime.init();scope.ctx.reflect.provide('bidBusiness',runtime);scope.ctx.reflect.provide('webServer',{port:0});h=await runtime.handle(saved);
  h.agent.followup(user('恢复本轮审核'));await h.agent.whenIdle();assert.equal(h.agent.session.snapshotEvents().filter(e=>e.type==='compaction/summary').length,count);assert.ok(h.agent.session.deriveMessages().some(m=>m.source?.kind==='user-question-reply'));
 }finally{await runtime?.close();await scope?.close();await host.fiber.dispose()}
});
