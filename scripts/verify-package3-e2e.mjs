// Real fresh Package 3 pipeline; run only in disposable code + data copies.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rename,symlink,realpath,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {business,dataRoot,root} from '../server/native/business.mjs';
assert.equal(process.env.BID_E2E_ISOLATED,'1');
assert.ok((await realpath(process.env.DSH_HOME)).startsWith(root));
assert.ok(process.env.BID_E2E_API_KEY);
const variant=process.env.BID_E2E_VARIANT,output=process.env.BID_E2E_OUTPUT;
const maxOutputTokens=Number(process.env.BID_E2E_MAX_TOKENS??16384);
assert.ok(Number.isInteger(maxOutputTokens)&&maxOutputTokens>=16384&&maxOutputTokens<=65536);
const tid='t_495941b0e6464d73bfa0a74f80a6d306',main='（定稿）2026-2027年外部数据采购项目-单一来源数据项采购项.docx';
await mkdir(output,{recursive:true});
const facts='本次仅投采购包3（基金商城数据包），使用当前已确认的杭州同花顺数据开发有限公司主体、余婉贞签字代表及2026-10-21签署日期快照。原资料库中的泉州银行2025年响应写作材料可按本项目适用范围复用，但不得使用其他主体资质或沿用历史项目承诺。用户已明确选择：尚未确认的报价、项目承诺或证明材料，缺失处保留Word批注并继续完整流程；未知具体值保持未提供，不虚构、不替用户新作承诺。缺失处在正文使用Word批注，不能把【待补】占位混入正文。审核如实保留相关证据不足、未响应及待确认；生成报告完成不表示投标合规。必须完整执行当前阶段所有现有质量校验。';
const run={variant,model:'deepseek-flash',max_output_tokens:maxOutputTokens,api_base:'https://api.deepseek.com',task_id:tid,started_at:new Date().toISOString(),root,confirmed_facts:facts,stages:[],requests:[],llm_calls:[],tools:[],errors:[]};
let stage='setup',ctx,activeHandle,done=false,writeQueue=Promise.resolve();
const pendingCaptures=new Set(),originalFetch=globalThis.fetch;
async function persist(){const text=JSON.stringify({...run,current_stage:stage,updated_at:new Date().toISOString()},null,2);writeQueue=writeQueue.then(async()=>{const p=join(output,'progress.json');await writeFile(p+'.tmp',text);await rename(p+'.tmp',p)});return writeQueue}
function saveSoon(){void persist().catch(e=>console.error('Evidence write failed: '+e.message))}
function safe(text){return String(text).replaceAll(process.env.BID_E2E_API_KEY,'[redacted]')}
globalThis.fetch=async function(input,init){
 const url=String(typeof input==='string'||input instanceof URL?input:input.url);
 if(!url.startsWith('https://api.deepseek.com/'))return originalFetch(input,init);
 if(!url.includes('/chat/completions'))return originalFetch(input,init);
 const body=JSON.parse(init?.body??await input.clone().text());assert.equal(body.model,'deepseek-flash');
 if(run.requests.length>=650)throw new Error('650-request runaway guard reached; stop and inspect before continuing');
 const item={request:run.requests.length+1,stage,started_at:new Date().toISOString(),model:body.model,url:'https://api.deepseek.com/chat/completions',message_count:body.messages?.length,prompt_chars:JSON.stringify(body.messages).length,tool_schema_count:body.tools?.length??0,max_tokens:body.max_completion_tokens??body.max_tokens};run.requests.push(item);saveSoon();
 let response;try{response=await originalFetch(input,init)}catch(error){item.error=safe(error.message);item.finished_at=new Date().toISOString();saveSoon();throw error}
 item.status=response.status;
 const capture=response.clone().text().then(text=>{
  for(const line of text.split('\n'))if(line.startsWith('data: {')){const value=JSON.parse(line.slice(6));if(value.usage)item.usage=value.usage;if(value.model)item.response_model=value.model;for(const choice of value.choices??[])if(choice.finish_reason)item.finish_reason=choice.finish_reason}
  if(!body.stream){try{const value=JSON.parse(text);item.usage=value.usage;item.response_model=value.model;item.finish_reason=value.choices?.[0]?.finish_reason}catch{}}
  if(!response.ok)item.error=safe(text.slice(0,1200));
  item.finished_at=new Date().toISOString();saveSoon();
 }).catch(error=>{item.capture_error=safe(error.message);saveSoon()}).finally(()=>pendingCaptures.delete(capture));pendingCaptures.add(capture);return response;
};
const profile=join(process.env.DSH_HOME,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});
for(const [name,target]of [['ooo-bidpliot',root],['@deepseek-ai',join(root,'node_modules/@deepseek-ai')]])await symlink(target,join(profile,'node_modules',name),'dir').catch(e=>{if(e.code!=='EEXIST')throw e});
await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
 {id:'agent-default-model',config:{provider:'flash-e2e',model:'deepseek-flash'}},
 {id:'llm-pi-ai',config:{providers:{'flash-e2e':{api:'openai-completions',apiKeyEnv:'BID_E2E_API_KEY',baseURL:'https://api.deepseek.com',models:[{id:'deepseek-flash',name:'DeepSeek Flash',contextWindow:1000000,maxTokens:maxOutputTokens,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:2}}}}},
 {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
 {id:'session-title-llm',disabled:true},
]));
const heartbeat=setInterval(()=>{saveSoon()},15000);heartbeat.unref();
async function waitForIdle(handle){
 activeHandle=handle;await handle.agent.whenIdle();await ctx.bidBusiness.settling.get(tid);await Promise.all([...pendingCaptures]);
}
async function answerPending(state){
 const body={call_ids:state.execution.questions.map(q=>q.callId),batches:state.execution.questions.map(q=>({call_id:q.callId,answers:q.questions.map(item=>({id:item.id,selected:[],custom:'用户已经确认：缺失处保留批注并继续全流程；尚未提供的具体值、报价和材料不能自行填写或推定。已确认范围为包3、当前主体快照和签字日期；已有值从当前资料读取，其他未提供事实保持缺口，正文加Word批注、审核列证据不足。'}))}))};
 await appendFile(join(output,'questions.jsonl'),JSON.stringify({stage,questions:state.execution.questions,answer:body,source:'Explicit human reply: 缺失处保留批注并继续全流程（推荐）'})+'\n');
 await ctx.bidBusiness.answer(tid,state.execution.session_id,body);await waitForIdle(ctx.bidBusiness.handles.get(state.execution.session_id));
}
try{
 const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
 ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
 ctx.on('llm/stream',function(options,next){
  assert.equal(options.provider,'flash-e2e');assert.equal(options.model,'deepseek-flash');
  run.llm_calls.push({stage,provider:options.provider,model:options.model,started_at:new Date().toISOString(),message_count:options.messages.length,prompt_chars:JSON.stringify(options.messages).length});saveSoon();return next();
 },{global:true});
 const toolNames=new Map();
 ctx.on('session/event',(session,event)=>{
  if(event.type==='tool/call'){toolNames.set(event.data.callId,event.data.toolName??event.data.name);run.tools.push({stage,session_id:session.id,seq:event.seq,...event.data});saveSoon()}
  if(event.type==='tool/result'){
   const call=run.tools.findLast(c=>c.session_id===session.id&&c.callId===event.data.message.toolCallId);if(call){const text=event.data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('');call.result_chars=text.length;call.is_error=event.data.message.isError||/^\[(?:.*失败|校验未通过)\]/.test(text)||/^Error:/.test(text);if(call.is_error)call.error_text=safe(text.slice(0,2500));}saveSoon();
  }
  if(event.type==='assistant/message'){run.last_assistant={stage,session_id:session.id,usage:event.data.usage,text:event.data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('').slice(-1000)};saveSoon()}
  if(event.type==='turn/end'&&event.data.reason.kind==='error'){run.errors.push({stage,session_id:session.id,error:event.data.reason});saveSoon()}
 },{global:true});
 const runtime=ctx.bidBusiness;
 await business(ctx,'sources',{task_id:tid,main_file:main,supplements:[]});
 for(const kind of ['analyse','outline','build','review']){
  stage=kind;const result={kind,started_at:new Date().toISOString(),request_start:run.requests.length,tool_start:run.tools.length,attempts:[]};run.stages.push(result);await persist();
  let completed=false;
  for(let attempt=0;attempt<4&&!completed;attempt++){
   let state=await runtime.state(tid);const instruction=facts+(attempt?' 上次执行尚未完成，读取现有成果及程序错误，修复缺项并继续本阶段，不绕过校验、不重复已完成正文。上次错误：'+JSON.stringify(result.attempts.at(-1)?.execution):'');
   const payload={kind,request_id:randomUUID(),input_version:state.input_versions[kind],instruction,...(kind==='analyse'?{main_file:main,supplements:[]}:{}),...(kind==='outline'?{page_target:null,numbering:'decimal'}:{}),...(kind==='build'?{sections:[]}:{} )};
   const admitted=await runtime.action(tid,payload);const handle=runtime.handles.get(admitted.session_id);await waitForIdle(handle);state=await runtime.state(tid);
   let questionTurns=0;
   while(state.execution.state==='needs_input'){
    if(++questionTurns>10)throw new Error('Repeated questions despite explicit missing-data policy; inspect');
    await answerPending(state);state=await runtime.state(tid);
   }
   if(kind==='review'){
    let accepted=-1;
    while(state.execution.state==='failed'){
     const progress=await runtime.reviewProgress(tid,admitted.session_id);if(progress.accepted<=accepted||progress.accepted===0)break;accepted=progress.accepted;await runtime.continueReview(tid,admitted.action_id);await waitForIdle(handle);state=await runtime.state(tid);
    }
   }
   let analysisCheck;
   if(kind==='analyse'&&state.execution.state==='completed')analysisCheck=await business(ctx,'tool',{name:'validate_analysis',parameters:{}},{taskId:tid,sessionId:admitted.session_id,callId:'independent-existing-validator'});
   completed=state.execution.state==='completed'&&(kind!=='analyse'||String(analysisCheck).startsWith('[校验通过]'));
   result.attempts.push({attempt:attempt+1,...admitted,execution:state.execution,analysis_check:analysisCheck,body_statuses:state.body_sections.map(s=>({title:s.title,path:s.path,status:s.status})),volume_states:state.volume_states,review:state.review});
   await writeFile(join(output,kind+'-state.json'),JSON.stringify(state,null,2));await persist();
   console.log(JSON.stringify({variant,stage:kind,attempt:attempt+1,state:state.execution.state,completed,model_requests:run.requests.length,tool_calls:run.tools.length,error:state.execution.error}));
  }
  result.completed=completed;result.finished_at=new Date().toISOString();result.request_end=run.requests.length;result.tool_end=run.tools.length;await persist();
  if(!completed)throw new Error(kind+' did not satisfy existing gates after four attempts');
 }
 done=true;run.completed=true;run.finished_at=new Date().toISOString();
}catch(error){run.completed=false;run.failure={stage,message:safe(error.stack??error.message)};console.error(safe(error.stack??error));process.exitCode=1}
finally{
 clearInterval(heartbeat);await ctx?.bidBusiness?.close();await ctx?.fiber.dispose();await Promise.all([...pendingCaptures]);
 run.finished_at??=new Date().toISOString();run.totals={http_requests:run.requests.length,llm_stream_calls:run.llm_calls.length,tool_calls:run.tools.length,input_tokens:run.requests.reduce((n,r)=>n+(r.usage?.prompt_tokens??0),0),output_tokens:run.requests.reduce((n,r)=>n+(r.usage?.completion_tokens??0),0),cached_tokens:run.requests.reduce((n,r)=>n+(r.usage?.prompt_cache_hit_tokens??r.usage?.prompt_tokens_details?.cached_tokens??0),0),http_errors:run.requests.filter(r=>r.status!==200).length};
 await persist();await writeFile(join(output,'result.json'),JSON.stringify(run,null,2));globalThis.fetch=originalFetch;
 console.log(JSON.stringify({variant,completed:done,totals:run.totals}));
}
