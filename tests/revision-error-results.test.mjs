import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {apply} from '../server/native/tools.mjs';
import {dataRoot} from '../server/native/business.mjs';
import {createHash} from 'node:crypto';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
if(process.env.BIDV4_REVISION_ERROR_FIXTURE!=='1')test('修订回执及原生参数边界',()=>runIsolatedTest('revision-error-results.test.mjs','BIDV4_REVISION_ERROR_FIXTURE',/修订失败按官方工具错误返回/));
else {
const title='修订失败按官方工具错误返回，回执重放不重写也不伪报成功';
test(title,async()=>{
 const definitions=new Map();let writes=0;
 const ctx={on(){return()=>{}},effect(){},subagents:{config:{maxActiveSubagents:{get:()=>8}}},tools:{register(d){definitions.set(d.name,d)}},subprocess:{spawn(){let request;return {stdin:{on(){},end(text){request=JSON.parse(text)}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:JSON.stringify({result:request.operation==='schemas'?[{name:'docx_section_revise',description:'test',parameters:{type:'object'}}]:(writes++,'[修订失败] P2原文不匹配；本批未保存\n[P2]真实原文')})})}},terminate(){},waitForExit(){}}}}};
 await apply(ctx);const agent={session:{id:'revision-parent',header:{cwd:join(dataRoot,'workspace','revision-errors')}}};const exec={agent,callId:'failed-call',signal:new AbortController().signal};
 const args={path:'body/A.docx',edits:[{para:2,action:'replace',find:'错误',text:'新文'}]};
 await assert.rejects(definitions.get('docx_section_revise').execute(args,exec),/修订失败.*P2/);
 await assert.rejects(definitions.get('docx_section_revise').execute(args,exec),/修订失败.*P2/);
 assert.equal(writes,1);
 const key=createHash('sha256').update('revision-parent:failed-call').digest('hex');const receipt=JSON.parse(await readFile(join(dataRoot,'tool-receipts/revision-errors',key+'.json'),'utf8'));assert.match(receipt.result,/本批未保存/);
});


for(const toolName of ['docx_section_revise','docx_source_inject','docx_assemble_volume'])for(const status of [422,500]){
 const label=`${toolName}${status}错误回执区分事务拒绝与未知结果`;
 test(label,async()=>{
  const definitions=new Map();let writes=0;
  const ctx={on(){return()=>{}},effect(){},subagents:{config:{maxActiveSubagents:{get:()=>8}}},tools:{register(d){definitions.set(d.name,d)}},subprocess:{spawn(){let request;return {stdin:{on(){},end(text){request=JSON.parse(text)}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:JSON.stringify(request.operation==='schemas'?{result:[{name:toolName,description:'test',parameters:{type:'object'}}]}:(writes++,{error:'injected rejection',status}))})}},terminate(){},waitForExit(){}}}}};
  await apply(ctx);const agent={session:{id:toolName+'-parent-'+status,header:{cwd:join(dataRoot,'workspace',toolName+'-receipt-'+status)}}};const exec={agent,callId:'same-call',signal:new AbortController().signal},args={path:'body/A.docx',edits:'invalid-array'};
  await assert.rejects(definitions.get(toolName).execute(args,exec),/injected rejection/);
  await assert.rejects(definitions.get(toolName).execute(args,exec),status===422&&toolName!=='docx_assemble_volume'?/失败.*injected rejection/:/上次结果不确定/);
  assert.equal(writes,1);
 });
}

const validation='手工声明的task和解析工具复用官方执行前校验，坏参数不进入业务进程';
test(validation,async()=>{
 const definitions=new Map();let calls=0;
 const ctx={on(){return()=>{}},effect(){},subagents:{config:{maxActiveSubagents:{get:()=>8}}},tools:{register(d){definitions.set(d.name,d)}},subprocess:{spawn(){calls++;return {stdin:{on(){},end(){}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:'{"result":[]}'})}},terminate(){},waitForExit(){}}}}};
 await apply(ctx);const before=calls,exec={agent:{session:{header:{cwd:join(dataRoot,'workspace','validation')}}},signal:new AbortController().signal};
 for(const args of [{subagent_type:'unknown',description:'x'},{subagent_type:'tender-body-writer'},{subagent_type:'tender-body-writer',description:'x',extra:1}])await assert.rejects(definitions.get('task').execute(args,exec),/invalid arguments/);
 await assert.rejects(definitions.get('parse_document').execute({file_name:123},exec),/invalid arguments/);
 assert.equal(calls,before);assert.equal(definitions.get('task').isConcurrencySafe({subagent_type:'tender-body-writer'}),false);
});

for(const [name,prefix] of Object.entries({docx_section_create:'创建',docx_material_inject:'注入',docx_source_inject:'注入',docx_image_insert:'插图',docx_comment_add:'批注',docx_diagram_insert:'图示',docx_html_figure:'原型',docx_assemble_volume:'合册',assemble_tender:'组装',publish_artifact:'发布',update_task_progress:'更新'})){
 test(name+'失败首调和回执重放均为官方错误，且只执行一次',async()=>{
  const definitions=new Map();let writes=0;
  const ctx={on(){return()=>{}},effect(){},subagents:{config:{maxActiveSubagents:{get:()=>8}}},tools:{register(d){definitions.set(d.name,d)}},subprocess:{spawn(){let request;return {stdin:{on(){},end(text){request=JSON.parse(text)}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:JSON.stringify({result:request.operation==='schemas'?[{name,description:'test',parameters:{type:'object'}}]:(writes++,'['+prefix+'失败] 工程确定负例')})})}},terminate(){},waitForExit(){}}}}};
  await apply(ctx);const exec={agent:{session:{id:name,header:{cwd:join(dataRoot,'workspace','all-errors')}}},callId:name,signal:new AbortController().signal};
  for(let i=0;i<2;i++)await assert.rejects(definitions.get(name).execute({},exec),new RegExp(prefix+'失败'));
  assert.equal(writes,1);
 });
}

test('渲染失败走错误通道，质量未通过与待办提示保留原语义',async()=>{
 const definitions=new Map();let returned;
 const ctx={on(){return()=>{}},effect(){},subagents:{config:{maxActiveSubagents:{get:()=>8}}},tools:{register(d){definitions.set(d.name,d)}},subprocess:{spawn(){let request;return {stdin:{on(){},end(text){request=JSON.parse(text)}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:JSON.stringify({result:request.operation==='schemas'?['docx_diagram_insert','docx_html_figure','validate_body'].map(name=>({name,description:'fixture',parameters:{type:'object'}})):returned})})}},terminate(){},waitForExit(){}}}}};
 await apply(ctx);const exec={agent:{session:{id:'render-parent',header:{cwd:join(dataRoot,'workspace','render-errors')}}},signal:new AbortController().signal};
 for(const [name,message]of [['docx_diagram_insert','[图示渲染失败] 未插入'],['docx_html_figure','[原型渲染失败] 未插入'],['validate_body','[校验失败] 文件不存在']]){returned=message;await assert.rejects(definitions.get(name).execute({}, {...exec,callId:name}),/失败/);}
 for(const message of ['[校验未通过] 质量问题','[校验通过] 含待办批注']){returned=message;assert.equal(await definitions.get('validate_body').execute({}, {...exec,callId:message}),message);}
});

}
