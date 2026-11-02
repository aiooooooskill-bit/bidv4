import {registerChatTools} from '../server/native/chat-tools.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {apply,chatToolNames} from '../server/agent.mjs';
import {join} from 'node:path';
import {root,dataRoot} from '../server/native/business.mjs';
import {conversationTasks} from '../server/native/conversations.mjs';
test('原生Agent状态读取真实业务服务，隐藏内部编号且提供当前合册下载',async()=>{
 let filter,tool,presentation;const calls=[],listeners=new Map();
 apply({webServer:{port:3080},tools:{presentAs(value){presentation=value},register(value){tool=value}},agents:{list(){return[]}},on(event,listener){listeners.set(event,listener)},effect(){},bidBusiness:{toolNames:['docx_section_create'],
  async tasks(){calls.push('tasks');return {tasks:[{id:'t1',title:'REQ-01 项目',stage:'outlined'}]}},
  async state(id){calls.push('state:'+id);return {task:{stage:'outlined'},execution:{session_id:'native-session',state:'completed'},files:[{path:'analysis/评分标准.md'}],body_sections:[{volume:'响应文件',title:'售后服务要求',path:'body/售后服务要求.docx',status:'ready'}],review:{status:'unreviewed',input_version:'review-v1',report:null},volume_states:[{artifact_id:'a1',status:'ready'}]}},
  async artifacts(id){calls.push('artifacts:'+id);return {artifacts:[{artifact_id:'a1',kind:'tender.volume',display_name:'TPL-01 技术标'}]}},
 }});
 await listeners.get('agent/created')({agent:{ctx:{inject(_services,install){install({systemPrompt:{context(){}},tools:{restrict(value){filter=value}}});return {dispose(){}}}}}});
 assert.equal(presentation,'native');assert.ok(chatToolNames.every(name=>filter.allow.includes(name)));assert.ok(filter.allow.includes('docx_section_create'));assert.ok(filter.allow.includes('read_image'));assert.ok(filter.allow.includes('task'));assert.equal(tool.name,'ooo_bidpliot_status');assert.ok(!(await tool.execute({})).includes('REQ-01'));
 const result=JSON.parse(await tool.execute({task_id:'t1'}));assert.deepEqual(result.body_sections,[{volume:'响应文件',title:'售后服务要求',path:'body/售后服务要求.docx',status:'ready'}]);assert.equal(result.execution.state,'completed');assert.equal(result.outputs[0].name,'技术标');assert.equal(result.outputs[0].link,'http://127.0.0.1:3080/api/bidv4/artifacts/a1/file');assert.equal(result.documents[0].name,'评分标准.md');
 const documentLink=new URL(result.documents[0].link);assert.equal(documentLink.origin,'http://127.0.0.1:3080');assert.equal(documentLink.pathname,'/api/bidv4/workbench/raw');assert.equal(documentLink.searchParams.get('task_id'),'t1');assert.equal(documentLink.searchParams.get('path'),'analysis/评分标准.md');assert.deepEqual(calls,['tasks','state:t1','artifacts:t1']);
});

test('主子Agent获得实际任务路径，正文派发容量跟随DSH当前配置而非固定两任务',async()=>{
 const listeners=new Map(),prompts=new Map(),agents=new Map();
 let childCapacity=8,toolCapacity=10,writingToolsAvailable=true;
 apply({webServer:{port:3080},tools:{presentAs(){},register(){}},bidBusiness:{toolNames:[]},agents:{list(){return[]}},on(event,listener){listeners.set(event,listener)},effect(){}});
 const create=(id,parentSession)=>{
  const agent={id,session:{header:{cwd:join(root,'unrelated-host-directory'),parentSession}},ctx:{
   agents:{get:id=>agents.get(id)},
   inject(_services,install){
    install({systemPrompt:{context(value){prompts.set(id,value.text)}},tools:{restrict(){},get(name){return writingToolsAvailable&&name==='docx_section_revise'?{}:undefined}},subagents:{config:{maxActiveSubagents:{get:()=>childCapacity}}},agentLoop:{config:{maxParallelToolCalls:{get:()=>toolCapacity}}}});
    return {dispose(){}};
   },
  }};
  agents.set(id,agent);return agent;
 };
 const parent=create('path-parent'),child=create('path-child',parent.id),tid='t_path_context';
 try{
  await listeners.get('agent/created')({agent:parent});
  assert.equal(prompts.get(parent.id)(),'');
  conversationTasks.set(parent.id,tid);
  await listeners.get('agent/created')({agent:child});
  for(const id of [parent.id,child.id]){
   const prompt=prompts.get(id)();
   assert.ok(prompt.includes('当前任务绝对路径：'+join(dataRoot,'workspace',tid)));
   assert.ok(prompt.includes('全局工作区绝对路径：'+join(dataRoot,'workspace')));
   assert.ok(prompt.includes('业务技能绝对路径：'+join(root,'business/python/app/skills')));
   assert.ok(!prompt.includes('unrelated-host-directory'));
   assert.match(prompt,/普通文件工具使用绝对路径/);
   assert.match(prompt,/validate_body.section.*相对任务 work\//);
   assert.match(prompt,/DSH 正文派发容量：8 个独立任务\/波/);
  }
  toolCapacity=4;
  assert.match(prompts.get(parent.id)(),/DSH 正文派发容量：4 个独立任务\/波/);
  childCapacity=3;toolCapacity=10;
  for(const id of [parent.id,child.id])assert.match(prompts.get(id)(),/DSH 正文派发容量：3 个独立任务\/波/);
  writingToolsAvailable=false;
  for(const id of [parent.id,child.id]){
   assert.doesNotMatch(prompts.get(id)(),/DSH 正文派发容量/,'审查与目录阶段不注入正文派发指令');
   assert.match(prompts.get(id)(),/当前任务绝对路径/);
  }
 }finally{conversationTasks.delete(parent.id)}
});


test('阶段工具只声明可执行阶段，停止沿用原生能力',()=>{
 const tools=new Map();registerChatTools({tools:{register:tool=>tools.set(tool.name,tool)}},{webBase:()=>''});
 const run=tools.get('ooo_bidpliot_run');
 assert.deepEqual(run.parameters.properties.kind.enum,['analyse','outline','guide','promises','build','body','revise','review','full']);
});


test('聊天阶段参数使用官方校验，在绑定会话或启动动作前拒绝缺失册名和错误只读类型',async()=>{
 const definitions=new Map();let effects=0;
 registerChatTools({tools:{register(tool){definitions.set(tool.name,tool)}},bidBusiness:{async bindConversation(){effects++},async state(){effects++},async action(){effects++}}},path=>path);
 const run=definitions.get('ooo_bidpliot_run');
 for(const args of [
  {task_id:'t1',kind:'revise',read_only:true,sections:[{title:'售后服务要求'}],instruction:'只读'},
  {task_id:'t1',kind:'revise',read_only:'true',sections:[{volume:'准确册名',title:'售后服务要求'}],instruction:'只读'},
  {task_id:'t1',kind:'invalid'},
  {task_id:'t1',kind:'revise',sections:[{volume:'册',title:'节',extra:1}],instruction:'只读'},
 ])await assert.rejects(run.execute(args,{agent:{id:'parent'},callId:'schema-check'}),/invalid arguments/);
 assert.equal(effects,0);
});
