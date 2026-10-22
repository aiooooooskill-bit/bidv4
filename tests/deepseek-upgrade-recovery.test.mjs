import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pythonExecutable} from '../server/platform.mjs';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {root,dataRoot} from '../server/native/business.mjs';

const name='历史只读保留及当前版本强制退出恢复、成果复用与主会话保留';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const state=async(host,taskId)=>(await host.api('/page-flow/'+taskId)).json();
async function answer(host,taskId,current){
 const questions=current.execution.questions;
 const response=await host.api('/page-flow/'+taskId+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:current.session_id,call_ids:questions.map(q=>q.callId),batches:questions.map(q=>({call_id:q.callId,answers:q.questions.map(question=>({id:question.id,selected:['三年']}))}))})});
 assert.equal(response.status,200,await response.text());
}
async function fileHashes(taskId){
 const work=join(dataRoot,'workspace',taskId,'work'),result={};
 for(const name of await readdir(work,{recursive:true}))if(name.startsWith('analysis/')&&name.endsWith('.md')||['body/写作指引.md','body/关键事实与承诺.md','body/交付验收章节.docx'].includes(name))result[name]=hash(await readFile(join(work,name)));
 return result;
}
if(process.env.BIDV4_UPGRADE_FIXTURE!=='1')test(name,{timeout:180000},()=>runIsolatedTest('deepseek-upgrade-recovery.test.mjs','BIDV4_UPGRADE_FIXTURE',new RegExp(name),170000));
else test(name,{timeout:160000},async()=>{
 const fixture=join(root,'tests/fixtures/deepseek-020'),manifest=await json(join(fixture,'manifest.json'));
 const archive=join(fixture,manifest.archive);assert.equal(hash(await readFile(archive)),manifest.archiveSha256);
 const source=await mkdtemp(join(tmpdir(),'bidv4-legacy-fixture-'));
 execFileSync(pythonExecutable(root),['-X','utf8','-c','import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,source],{stdio:'pipe'});
 assert.equal(manifest.sourceVersion,'0.2.0-rc.2');
 // These are original compressed official 0.2.0 sessions from a synthetic task.
 // Copy their bytes; do not rewrite events or synthesize a successful outcome.
 for(const [name,expected]of Object.entries(manifest.files))assert.equal(hash(await readFile(join(source,name))),expected,name);
 await cp(join(source,'data'),dataRoot,{recursive:true});
 const home=await mkdtemp(join(tmpdir(),'bidv4-upgrade-home-'));
 for(const directory of ['sessions','attachments'])await cp(join(source,directory),join(home,directory),{recursive:true});
 let host;
 try{
  host=await analysisFixture(home);
  const previous=await host.command('nativeEvidence',{sessionId:manifest.sessionId});
  assert.equal(previous.modelRequests,0,'Opening old task history must not dispatch a model');
  assert.ok(previous.events.some(e=>e.type==='tool/call'&&e.data.name==='ask_user_question'));
  const oldState=await state(host,manifest.taskId);
  assert.equal(oldState.session_id,manifest.sessionId);assert.equal(oldState.execution.state,'needs_input');assert.equal(oldState.build_preparation.guide,'stale','旧准备依据过期不能自动变为当前就绪');
  assert.equal(await host.command('modelCount'),0,'读取旧历史不自动续跑或迁移');
  // Now interrupt a fresh official 0.2.1 child after its DOCX side effect has
  // been durably recorded, before validation or parent tool settlement.
  const fresh=await host.command('fullWorkflow',{include_review:true}),taskId=fresh.taskId,sessionId=fresh.state.session_id;
  await host.command('crashAfterBody');await answer(host,taskId,fresh.state);
  const checkpoint=await host.command('crashCheckpoint',{taskId});
  assert.equal(checkpoint.state.execution.state,'running');assert.equal(checkpoint.state.body_sections[0].status,'draft');
  const saved=await fileHashes(taskId);assert.equal(saved['body/交付验收章节.docx'],checkpoint.bodyHash);
  await host.kill();await host.close(true);host=await analysisFixture(home);
  assert.equal(await host.command('modelCount'),0,'Restart must wait for an explicit continuation');
  const interrupted=await state(host,taskId);assert.equal(interrupted.session_id,sessionId);assert.equal(interrupted.workflow.state,'interrupted');assert.notEqual(interrupted.execution.state,'completed');
  const restored=await host.command('nativeEvidence',{sessionId});
  assert.deepEqual(restored.events.slice(0,checkpoint.events.length),checkpoint.events,'SIGKILL recovery retains the complete durable parent prefix');
  assert.deepEqual(await fileHashes(taskId),saved,'Opening a crashed task cannot overwrite its existing files');
  await host.command('resumeExistingBuild');
  const resume=await host.api('/page-flow/'+taskId+'/workflow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resume:true})});assert.equal(resume.status,202,await resume.text());
  const final=await host.command('waitWorkflow',{taskId});
  assert.equal(final.workflow.state,'completed',JSON.stringify({workflow:final.workflow,errors:final.fixture_errors}));assert.equal(final.session_id,sessionId);assert.equal(final.review.status,'reviewed');assert.equal(final.volume_states[0].status,'ready');
  const retained=await fileHashes(taskId);for(const [path,digest]of Object.entries(saved))assert.equal(retained[path],digest,'Resume validates and reuses '+path);
  const evidence=await host.command('projectEvidence',{taskId});
  assert.deepEqual([...new Set(evidence.records.map(r=>r.session_id))],[sessionId],'Continuation must not fork the main conversation');
  assert.equal(evidence.records.filter(r=>r.kind==='analyse').length,1);assert.equal(evidence.records.filter(r=>r.kind==='outline').length,1,'Completed upstream phases must not rerun');
  assert.equal(final.body_sections[0].status,'ready');assert.deepEqual(await readdir(join(dataRoot,'locks')),[]);
  const artifacts=await(await host.api('/artifacts?task_id='+taskId)).json(),volume=artifacts.artifacts.find(a=>a.kind==='tender.volume');assert.ok(volume);
  const download=await host.api('/artifacts/'+volume.artifact_id+'/file');assert.equal(download.status,200);assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0,2).toString(),'PK');
 }finally{await host?.close();await rm(home,{recursive:true,force:true});await rm(source,{recursive:true,force:true})}
});
