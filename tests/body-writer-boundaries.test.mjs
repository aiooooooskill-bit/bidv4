import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {dataRoot} from '../server/native/business.mjs';
import {BodyTaskSlots,reserveBodyAssignment,bodyAssignment} from '../server/native/body-assignments.mjs';
import {installExecutionGuard} from '../server/native/execution-guard.mjs';
import {apply} from '../server/native/tools.mjs';

const title='并发正文写手按持久章节分配隔离，重复派发及排队后停止均不能越权写入';
if(process.env.BIDV4_BODY_BOUNDARY_FIXTURE!=='1')test(title,()=>runIsolatedTest('body-writer-boundaries.test.mjs','BIDV4_BODY_BOUNDARY_FIXTURE',new RegExp(title)));
else test(title,async()=>{
 const tid='body-boundaries',cwd=join(dataRoot,'workspace',tid),actions=join(dataRoot,'actions',tid);
 await mkdir(join(cwd,'work/body'),{recursive:true});await mkdir(actions,{recursive:true});
 const record={kind:'build',action_id:'build-one',session_id:'parent',section_paths:['body/A.docx','body/B.docx']};
 const parent={id:'parent',session:{id:'parent',header:{cwd}}};
 const child=id=>({id,session:{id,header:{cwd,origin:'subagent',parentSession:'parent'}}});
 const state={bidder:{confirmed:true,stale:false},build_preparation:{guide:'ready',promises:'ready'},body_sections:record.section_paths.map(path=>({path})),body_files:record.section_paths};
 const definitions=new Map();
 const ctx={agents:new Map([['parent',parent]]),on(){return()=>{}},effect(){},tools:{register(definition){definitions.set(definition.name,definition)}},
  subprocess:{spawn(){let request;return {stdin:{on(){},end(text){request=JSON.parse(text)}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:JSON.stringify({result:request.operation==='schemas'?[]:state})})}},terminate(){},waitForExit(){}}}},
  fs:{async resolve(path){return {targetKey:resolve(path)}}}};
 await apply(ctx);
 const safe=definitions.get('task').isConcurrencySafe;
 assert.equal(safe({subagent_type:'tender-body-writer',description:'A'}),true);
 assert.equal(safe({subagent_type:'tender-outline-writer',description:'A'}),false);
 let guard;ctx.on=(name,fn)=>{if(name==='tools/execute')guard=fn;return()=>{}};
 installExecutionGuard(ctx,()=>{});
 const nativeSignal=new AbortController().signal;let unexpectedEarlyWrite=false;
 for(const [name,args]of [['docx_comment_add',{path:'body/A.docx',text:'不应保存'}],['validate_body',{section:'body/A.docx'}]])await assert.rejects(guard({agent:parent,name,arguments:args,signal:nativeSignal},async()=>{unexpectedEarlyWrite=true}),/须先用ooo_bidpliot_run/);
 assert.equal(unexpectedEarlyWrite,false);
 await writeFile(join(actions,'latest.json'),JSON.stringify({...record,kind:'analyse'}));
 await assert.rejects(guard({agent:parent,name:'docx_comment_add',arguments:{path:'body/A.docx',text:'不应保存'},signal:nativeSignal},async()=>{unexpectedEarlyWrite=true}),/须先用ooo_bidpliot_run/);
 assert.equal(unexpectedEarlyWrite,false);
 await writeFile(join(actions,'latest.json'),JSON.stringify(record));
 const releaseA=await reserveBodyAssignment(ctx,tid,'child-a','parent',['body/A.docx']);
 const releaseB=await reserveBodyAssignment(ctx,tid,'child-b','parent',['body/B.docx']);
 await assert.rejects(reserveBodyAssignment(ctx,tid,'overlap','parent',['body/A.docx']),/已有写手/);
 await assert.rejects(reserveBodyAssignment(ctx,tid,'foreign','parent',['body/C.docx']),/范围/);
 const original=Buffer.from('B original');await writeFile(join(cwd,'work/body/B.docx'),original);
 const signal=new AbortController().signal;
 let calls=0;
 const run=(agent,name,args,next=async()=>{calls++;return {content:[]}})=>guard({agent,name,arguments:args,signal},next);
 // Fresh Agent objects use the durable assignment, rather than a volatile scope map.
 await run(child('child-a'),'docx_section_create',{path:'body/A.docx'});
 for(const [name,args]of [
  ['docx_section_revise',{path:'body/B.docx'}],['docx_material_inject',{dest:'body/B.docx'}],
  ['validate_body',{section:'body/B.docx'}],['docx_section_create',{path:'../body/B.docx'}],
  ['write',{file_path:join(cwd,'work/body/写作指引.md')}],['validate_body',{section:'body'}],['docx_assemble_volume',{}],
 ])await assert.rejects(run(child('child-a'),name,args));
 assert.deepEqual(await readFile(join(cwd,'work/body/B.docx')),original);
 await assert.rejects(run(child('unassigned'),'docx_section_create',{path:'body/A.docx'}),/没有本轮有效章节分配/);
 assert.equal(calls,1);
 // Keep the project mutex; a queued call rechecks the action after acquiring it.
 const entered=Promise.withResolvers(),blocked=Promise.withResolvers();
 const first=run(child('child-a'),'docx_section_create',{path:'body/A.docx'},async()=>{entered.resolve();await blocked.promise;return {content:[]}});
 await entered.promise;
 const queued=run(child('child-b'),'docx_section_create',{path:'body/B.docx'});
 await new Promise(resolve=>setTimeout(resolve,25));
 await writeFile(join(actions,'latest.json'),JSON.stringify({...record,stopped_at:1}));
 blocked.resolve();await first;
 await assert.rejects(queued,/变化或停止/);assert.equal(calls,1);
 await releaseA();await releaseB();assert.equal((await bodyAssignment(tid,'child-a')).status,'released');
 // Explicit inspection is a durable capability, not a keyword classifier.
 await writeFile(join(actions,'latest.json'),JSON.stringify({...record,kind:'revise',action_id:'readonly',read_only:true}));
 const releaseRead=await reserveBodyAssignment(ctx,tid,'readonly-child','parent',['body/A.docx']);
 assert.equal((await bodyAssignment(tid,'readonly-child')).read_only,true);
 const countBefore=calls;
 for(const owner of [parent,child('readonly-child')])for(const [name,args]of [
  ['docx_section_revise',{path:'body/A.docx'}],['docx_section_create',{path:'body/A.docx'}],
  ['docx_material_inject',{dest:'body/A.docx'}],['docx_source_inject',{dest:'body/A.docx'}],
  ['docx_image_insert',{dest:'body/A.docx'}],['docx_comment_add',{path:'body/A.docx'}],
  ['docx_diagram_insert',{dest:'body/A.docx'}],['docx_html_figure',{dest:'body/A.docx'}],
  ['write',{file_path:join(cwd,'work/body/A.docx')}],['edit',{file_path:join(cwd,'work/body/A.docx')}],
  ['docx_assemble_volume',{}],['docx_section_repartition',{path:'body/A.docx'}],
 ])await assert.rejects(run(owner,name,args),/只读|已分配章节/);
 await assert.rejects(run(parent,'task',{subagent_type:'tender-outline-writer',response_file:'V',description:'V'}),/只读/);
 let delegated=0;await run(parent,'task',{subagent_type:'tender-body-writer',description:'A'},async()=>{delegated++;return {content:[]}});assert.equal(delegated,1);
 assert.equal(calls,countBefore,'write bodies never execute');
 await run(parent,'validate_body',{section:'body/A.docx'});await run(child('readonly-child'),'validate_body',{section:'body/A.docx'});
 assert.equal(calls,countBefore+2);assert.deepEqual(await readFile(join(cwd,'work/body/B.docx')),original);await releaseRead();

});

test('8个正文写手槽位有界排队，取消排队不泄漏槽位',async()=>{
 const slots=new BodyTaskSlots(()=>8),signal=new AbortController().signal;
 const releases=await Promise.all(Array.from({length:8},()=>slots.acquire(signal)));
 assert.equal(slots.active,8);
 const cancellation=new AbortController(),cancelled=slots.acquire(cancellation.signal);
 let admitted=false;const waiting=slots.acquire(signal).then(release=>{admitted=true;return release});
 assert.equal(slots.queue.length,2);assert.equal(admitted,false);
 cancellation.abort(new Error('cancel waiting'));
 await assert.rejects(cancelled,/cancel waiting/);assert.equal(slots.queue.length,1);
 releases[0]();const releaseNinth=await waiting;
 assert.equal(slots.active,8);assert.equal(admitted,true);
 for(const release of releases.slice(1))release();releaseNinth();releaseNinth();
 assert.equal(slots.active,0);assert.equal(slots.queue.length,0);
});

test('写手队列跟随DSH容量升降，降容后不超额放行，扩容不受旧8槽限制',{timeout:1000},async()=>{
 let capacity=4;const slots=new BodyTaskSlots(()=>capacity),signal=new AbortController().signal;
 const releases=await Promise.all(Array.from({length:4},()=>slots.acquire(signal)));
 capacity=2;let admitted=false;
 const queued=slots.acquire(signal).then(release=>{admitted=true;return release});
 releases[0]();releases[1]();await Promise.resolve();
 assert.equal(admitted,false);assert.equal(slots.active,2);
 releases[2]();const releaseQueued=await queued;assert.equal(slots.active,2);
 releases[3]();releaseQueued();assert.equal(slots.active,0);
 capacity=10;
 const expanded=await Promise.all(Array.from({length:10},()=>slots.acquire(signal)));
 assert.equal(slots.active,10);
 for(const release of expanded)release();
 assert.equal(slots.active,0);assert.equal(slots.queue.length,0);
});
