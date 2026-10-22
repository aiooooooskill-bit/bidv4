import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessRuntime} from '../server/native/runtime.mjs';
for(const kind of ['body','revise','build'])test(kind+'结束验收必须有当前动作的逐节校验依据',async()=>{
 const runtime=new BusinessRuntime({});runtime.handle=async()=>({agent:{}});
 const record={kind,task_id:'proof-fixture',action_id:'current',session_id:'parent',created_at:10,section_paths:['body/A.docx'],sections:[{volume:'V',title:'A'}],outcome:{state:'completed'}};
 const state={directory:{content:{}},files:[],body_files:['body/A.docx'],body_sections:[{path:'body/A.docx',volume:'V',title:'A',status:'ready',modified_at:20}],build_preparation:{guide:'ready',promises:'ready'},volume_states:[{name:'V',status:'ready'}]};
 for(const proof of [undefined,[],['previous']]){state.body_sections[0].validated_action_ids=proof;const projected=await runtime.projection(record,state);assert.equal(projected.state,'failed');assert.equal(projected.resolved,false);}
 state.body_sections[0].validated_action_ids=['current'];assert.equal((await runtime.projection(record,state)).state,'completed');
 state.body_sections[0].validated_action_ids=['previous','current'];assert.equal((await runtime.projection(record,state)).state,'completed');
 state.body_sections[0].status='draft';assert.equal((await runtime.projection(record,state)).state,'failed');
});

test('只读权限通过既有DSH工具限制收窄主线程，普通修订继续可用',async()=>{
 const runtime=new BusinessRuntime({});let allowed,disposed=0;
 const agent={id:'readonly-tools',ctx:{inject(_services,install){install({tools:{restrict({allow}){allowed=allow}}});return {inertia:false,async dispose(){disposed++}}}}};
 await runtime.applyStageTools(agent,'revise',true);
 for(const name of ['ooo_bidpliot_run','docx_section_read','validate_body','task'])assert.ok(allowed.includes(name));
 for(const name of ['docx_section_revise','docx_section_create','docx_image_insert','write','edit','docx_assemble_volume'])assert.ok(!allowed.includes(name));
 await runtime.applyStageTools(agent,'revise',false);assert.equal(disposed,1);assert.equal(runtime.stageTools.get(agent.id).mode,'default');
});

test('只读标志拒绝坏类型和写作阶段混用，不从自然语言猜授权',async()=>{
 const runtime=new BusinessRuntime({});
 for(const payload of [{kind:'readonly'},{kind:'revise',read_only:'true'},{kind:'body',read_only:true},{kind:'build',read_only:true}])await assert.rejects(runtime.action('invalid-readonly',{request_id:'valid-request-id',...payload}),/read_only|操作参数无效/);
});
