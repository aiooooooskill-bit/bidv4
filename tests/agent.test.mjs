import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../server/agent.mjs';
test('展示Agent只查询业务服务与dsh状态，隐藏内部编号且提供合册下载',async()=>{
 let filter,tool;const calls=[],listeners=new Map();
 apply({webServer:{port:3080},tools:{register(value){tool=value}},agents:{list(){return[]}},on(event,listener){listeners.set(event,listener)},effect(){},bidBusiness:{
  async tasks(){calls.push('tasks');return {tasks:[{id:'t1',title:'REQ-01 项目',stage:'outlined'}]}},
  async state(id){calls.push('state:'+id);return {task:{stage:'outlined'},execution:{session_id:'native-session',state:'completed'},files:[{path:'analysis/评分标准.md'}]}},
  async artifacts(id){calls.push('artifacts:'+id);return {artifacts:[{artifact_id:'a1',kind:'tender.volume',display_name:'TPL-01 技术标'}]}},
 }});
 await listeners.get('agent/created')({agent:{ctx:{inject(_services,install){install({tools:{restrict(value){filter=value}}});return {dispose(){}}}}}});
 assert.deepEqual(filter,{allow:['ooo_bidpliot_status']});assert.equal(tool.name,'ooo_bidpliot_status');assert.ok(!(await tool.execute({})).includes('REQ-01'));
 const result=JSON.parse(await tool.execute({task_id:'t1'}));assert.equal(result.execution.state,'completed');assert.equal(result.outputs[0].name,'技术标');assert.equal(result.outputs[0].link,'http://127.0.0.1:3080/api/bidv4/artifacts/a1/file');assert.equal(result.documents[0].name,'评分标准.md');
 const documentLink=new URL(result.documents[0].link);assert.equal(documentLink.origin,'http://127.0.0.1:3080');assert.equal(documentLink.pathname,'/api/bidv4/workbench/content');assert.equal(documentLink.searchParams.get('task_id'),'t1');assert.equal(documentLink.searchParams.get('path'),'analysis/评分标准.md');assert.deepEqual(calls,['tasks','state:t1','artifacts:t1']);
});
