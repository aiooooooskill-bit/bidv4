import test from 'node:test';
import assert from 'node:assert/strict';
import {apply,chatToolNames} from '../server/agent.mjs';
test('原生Agent状态读取真实业务服务，隐藏内部编号且提供当前合册下载',async()=>{
 let filter,tool,presentation;const calls=[],listeners=new Map();
 apply({webServer:{port:3080},tools:{presentAs(value){presentation=value},register(value){tool=value}},agents:{list(){return[]}},on(event,listener){listeners.set(event,listener)},effect(){},bidBusiness:{toolNames:['docx_section_create'],
  async tasks(){calls.push('tasks');return {tasks:[{id:'t1',title:'REQ-01 项目',stage:'outlined'}]}},
  async state(id){calls.push('state:'+id);return {task:{stage:'outlined'},execution:{session_id:'native-session',state:'completed'},files:[{path:'analysis/评分标准.md'}],review:{status:'unreviewed',input_version:'review-v1',report:null},volume_states:[{artifact_id:'a1',status:'ready'}]}},
  async artifacts(id){calls.push('artifacts:'+id);return {artifacts:[{artifact_id:'a1',kind:'tender.volume',display_name:'TPL-01 技术标'}]}},
 }});
 await listeners.get('agent/created')({agent:{ctx:{inject(_services,install){install({systemPrompt:{context(){}},tools:{restrict(value){filter=value}}});return {dispose(){}}}}}});
 assert.equal(presentation,'native');assert.ok(chatToolNames.every(name=>filter.allow.includes(name)));assert.ok(filter.allow.includes('docx_section_create'));assert.ok(filter.allow.includes('read_image'));assert.ok(filter.allow.includes('task'));assert.equal(tool.name,'ooo_bidpliot_status');assert.ok(!(await tool.execute({})).includes('REQ-01'));
 const result=JSON.parse(await tool.execute({task_id:'t1'}));assert.equal(result.execution.state,'completed');assert.equal(result.outputs[0].name,'技术标');assert.equal(result.outputs[0].link,'http://127.0.0.1:3080/api/bidv4/artifacts/a1/file');assert.equal(result.documents[0].name,'评分标准.md');
 const documentLink=new URL(result.documents[0].link);assert.equal(documentLink.origin,'http://127.0.0.1:3080');assert.equal(documentLink.pathname,'/api/bidv4/workbench/raw');assert.equal(documentLink.searchParams.get('task_id'),'t1');assert.equal(documentLink.searchParams.get('path'),'analysis/评分标准.md');assert.deepEqual(calls,['tasks','state:t1','artifacts:t1']);
});
