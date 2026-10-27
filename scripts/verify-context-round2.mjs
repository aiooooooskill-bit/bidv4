// Package 3 real-history boundary replay; not a new full tender production run.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {root,dataRoot,business,taskPathContext} from '../server/native/business.mjs';

assert.equal(process.env.BID_ROUND2_ISOLATED,'1','Run only in an explicitly isolated source/data copy');
assert.ok((await realpath(process.env.DSH_HOME)).startsWith(root));
assert.ok(process.env.BID_ROUND2_API_KEY);
const tid='t_495941b0e6464d73bfa0a74f80a6d306',variant=process.env.BID_ROUND2_VARIANT;
const output=process.env.BID_ROUND2_OUTPUT;await mkdir(output,{recursive:true});
const profile=join(process.env.DSH_HOME,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});
for(const [name,target]of [['ooo-bidpliot',root],['@deepseek-ai',join(root,'node_modules/@deepseek-ai')]])await symlink(target,join(profile,'node_modules',name),'dir').catch(e=>{if(e.code!=='EEXIST')throw e});
await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
 {id:'agent-default-model',config:{provider:'round2',model:'deepseek-flash'}},
 {id:'llm-pi-ai',config:{providers:{round2:{api:'openai-completions',apiKeyEnv:'BID_ROUND2_API_KEY',baseURL:'https://api.deepseek.com',models:[{id:'deepseek-flash',name:'DeepSeek Flash',contextWindow:1000000,maxTokens:4096}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
 {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
 {id:'session-title-llm',disabled:true},
]));
const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
let ctx;const handles=[],results=[];
try{
 ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
 const runtime=ctx.bidBusiness;
 const original=JSON.parse(await readFile(process.env.BID_ROUND2_SEED,'utf8'));
 for(const [name,cut]of [['analysis-to-outline',203],['outline-to-build',1114]]){
  const seed=original.filter(e=>e.seq<=cut),id='round2-'+variant+'-'+name;
  const paths=join(dataRoot,'workspace',tid);
  const h=await ctx.agents.create({sessionId:id,meta:{cwd:paths,agentPreset:'ooo-bidpliot'},seed,agentOptions:{provider:'round2',model:'deepseek-flash',maxTokens:4096},setup:async c=>{
   await ctx.agentPresets.mount(c,'ooo-bidpliot');c.tools.restrict({allow:['read','read_artifact','validate_analysis','check_outline']});
  }});handles.push(h);
  const beforeSeq=h.agent.session.seq,acceptedSeed=h.agent.session.snapshotEvents(),initialUserMessages=h.agent.session.deriveMessages().filter(m=>m.role==='user'&&['user','user-question-reply','compact-checkpoint'].includes(m.source?.kind));
  // Exercise the same runtime hook and persisted action state used by a page action.
  await runtime.bindConversation(tid,h.agent);
  const dir=join(dataRoot,'actions',tid);await mkdir(dir,{recursive:true});
  const record={action_id:name,task_id:tid,session_id:id,kind:'build',history_before_seq:beforeSeq,start_seq:beforeSeq,model:{provider:'round2',model:'deepseek-flash'},created_at:Date.now()};
  await writeFile(join(dir,'latest.json'),JSON.stringify(record));await writeFile(join(dir,name+'.json'),JSON.stringify(record));
  const state=await business(ctx,'state',{task_id:tid});
  const prompt='跨阶段交接验收。本次仅投包3，这是用户已经确认的范围，不再询问、不改变。历史中的执行任务已结束。现在只执行以下只读核验，不制作正文、不发布、不改写文件：1) validate_analysis验证当前八份解读；2) read读取当前work/analysis/clarifications.md；3) read_artifact默认索引读取contract=tender.directory/tender-response-docs@1、view=index、artifact_id='+state.directory.artifact_id+'，然后read_artifact(section)读取第一个section（显式传view=section、content_seq、volume和section_path，按索引返回值）；4) check_outline。共5次工具调用即可；不要读旧草稿或重复读完整目录。通过后输出JSON：{scope:"包3",analysis_ok:true,outline_ok:true,clarification_text:"当前澄清表原文（全部）",section_title:"实际读取的节点标题",evidence_source_ids:["该section全部真实依据ID"]}。如失败原样报告，不谎称通过。\n'+taskPathContext(tid)+'\n阶段交接：用户消息、问答和结论保留；被归档执行记录只在需用证据时回读，当前版本文件及工具校验结果是本次依据。';
  h.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:prompt}]}));
  await Promise.race([h.agent.whenIdle(),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Flash replay timed out')),480000);t.unref()})]);
  await ctx.sessions.flush(h.agent.session);
  const added=h.agent.session.snapshotEvents().filter(e=>e.seq>=beforeSeq);
  const end=added.findLast(e=>e.type==='turn/end');
  await writeFile(join(output,name+'-events.json'),JSON.stringify(added,null,2));
  assert.equal(end?.data.reason.kind,'completed',JSON.stringify(end));
  const messages=added.filter(e=>e.type==='assistant/message');
  const calls=added.filter(e=>e.type==='tool/call').map(e=>({name:e.data.toolName??e.data.name,...e.data}));
  const final=messages.at(-1).data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('');
  const context=JSON.parse(await readFile(join(dir,'latest.json'),'utf8')).stage_context;
  for(const archive of context?.archives??[]){const bytes=await readFile(archive.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),archive.sha256);const saved=JSON.parse(bytes);assert.deepEqual(saved.events,saved.source_seqs.map(seq=>acceptedSeed.find(e=>e.seq===seq)))}
  const oldSurfaceUser=h.agent.session.deriveMessages().filter(m=>m.role==='user');
  // Every initially active real confirmation/checkpoint must remain byte-identical.
  const allLog=h.agent.session.snapshotEvents();assert.deepEqual(allLog.slice(0,acceptedSeed.length),acceptedSeed,'Original event history changed');
  for(const u of initialUserMessages)assert.ok(oldSurfaceUser.some(m=>JSON.stringify(m)===JSON.stringify(u)),'User confirmation/checkpoint missing');
  assert.ok(messages.every(e=>e.data.message.source.model==='deepseek-flash'&&e.data.message.source.provider==='round2'));
  let answer;
  for(let i=0;i<final.length;i++)if(final[i]==='{'){try{const tail=final.slice(i),end=tail.lastIndexOf('}');const value=JSON.parse(tail.slice(0,end+1));if(value.scope){answer=value;break}}catch{}}
  const receiptTexts=added.filter(e=>e.type==='tool/result').flatMap(e=>e.data.message.content.filter(b=>b.type==='text').map(b=>b.text));
  assert.ok(receiptTexts.some(text=>text.includes('[校验通过] analysis/ 共 8 件')&&text.includes('167 条')),'Must execute the existing analysis validation');
  assert.ok(receiptTexts.some(text=>{try{const value=JSON.parse(text);return value.ok===true&&value.phase==='classification_frozen'}catch{return false}}),'Must execute the existing outline freeze check');
  const clarifications=await readFile(join(paths,'work/analysis/clarifications.md'),'utf8');
  assert.equal(answer?.scope,'包3');assert.equal(answer.analysis_ok,true);assert.equal(answer.outline_ok,true);assert.equal(answer.clarification_text.trim(),clarifications.trim());assert.equal(answer.section_title,'封面');assert.deepEqual(answer.evidence_source_ids,['MAND-01','TPL-01']);
  const result={name,variant,model:'deepseek-flash',requests:messages.length,input_tokens:messages.reduce((n,e)=>n+(e.data.usage.totalTokens-e.data.usage.outputTokens),0),uncached_input_tokens:messages.reduce((n,e)=>n+e.data.usage.inputTokens,0),output_tokens:messages.reduce((n,e)=>n+(e.data.usage?.outputTokens??0),0),cache_tokens:messages.reduce((n,e)=>n+(e.data.usage?.cacheReadTokens??0),0),usages:messages.map(e=>e.data.usage),tool_calls:calls.length,calls:calls.map(c=>({name:c.name,arguments:c.arguments})),archives:context?.archives??[],final,tool_errors:added.filter(e=>e.type==='tool/result'&&e.data.message.isError).map(e=>e.data),original_log_identical:true,quality:{scope_preserved:true,clarifications_exact:true,analysis_files:8,validated_citations:167,section_evidence_ids:answer.evidence_source_ids,user_messages_retained:initialUserMessages.length,archive_events_exact:true},recoverable_tool_errors:added.filter(e=>e.type==='tool/result'&&e.data.message.content.some(b=>b.type==='text'&&b.text.startsWith('[读取失败]'))).length};
  results.push(result);await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({name,variant,input_tokens:result.input_tokens,requests:result.requests,tool_calls:result.tool_calls,archive_count:result.archives.length,final}));
  await h.dispose();handles.splice(handles.indexOf(h),1);
  // Each experiment has its own conversation binding, but the same frozen case.
  const {unlink}=await import('node:fs/promises');await unlink(join(dataRoot,'conversations',tid+'.json'));
 }
}finally{for(const h of handles.reverse())await h.dispose();await ctx?.fiber.dispose()}
