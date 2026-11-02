import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {fixture,find} from './helpers/component-fixture.mjs';
import {dataRoot,root} from '../server/native/business.mjs';
import {pythonExecutable} from '../server/platform.mjs';

const name='真实HTTP：完整旧项目的目录、产物、审核报告和自动流程不串入同文件新项目';
if(process.env.BIDV4_UPLOAD_ISOLATION!=='1')test(name,{timeout:220000},()=>runIsolatedTest('project-upload-isolation.test.mjs','BIDV4_UPLOAD_ISOLATION',/ISOLATION_VERIFIED/,215000));
else test(name,{timeout:210000},async()=>{
 const host=await analysisFixture();let f,view;
 const api=async(path,body,method)=>{
  const r=await host.api(path,body instanceof FormData?{method:'POST',body}:body?{method:method??'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{method:method??'GET'});
  const value=await r.json();assert.ok(r.ok,JSON.stringify({path,status:r.status,value}));return value;
 };
 try{
  const full=await host.command('fullWorkflow',{include_review:true});
  const completed=await host.command('nativeAnswer',{taskId:full.taskId});
  assert.equal(completed.workflow.state,'completed');assert.deepEqual(completed.workflow.completed,['analyse','outline','build','review']);
  assert.ok(completed.directory?.content.response_documents.length);assert.equal(completed.review.status,'reviewed');assert.ok(completed.review.report.report.requirements.length);
  const started={taskId:full.taskId,sessionId:completed.session_id},old=started.taskId;
  const synthetic=join(dataRoot,'same-document.docx');
  execFileSync(pythonExecutable(root),['-c',"from docx import Document;import sys;d=Document();d.add_heading('相同文档隔离验证',0);d.add_paragraph('项目以独立身份保存全部成果。');d.save(sys.argv[1])",synthetic]);
  const bytes=await readFile(synthetic),file=new File([bytes],'同一份.docx',{lastModified:1});
  const upload=async(tid,content=file,query='')=>{const form=new FormData();form.append('file',content);return api('/files?task_id='+tid+query,form)};
  await upload(old);
  await upload(old,new File([bytes],'旧项目受审投标.docx'),'&purpose=bid');
  const selected=await api('/page-flow/'+old);
  await api('/page-flow/'+old+'/review-input',{bids:['旧项目受审投标.docx'],input_version:selected.input_versions.review},'PUT');
  const oldFlow=await api('/page-flow/'+old),oldArtifacts=(await api('/artifacts?task_id='+old)).artifacts;
  assert.equal(oldFlow.files.filter(f=>f.path.startsWith('analysis/')).length,8);assert.equal(oldFlow.bidder.confirmed,true);assert.ok(oldFlow.body_files.length);assert.equal(oldFlow.execution.state,'completed');
  assert.ok(oldFlow.directory.content.response_documents.length);assert.ok(oldFlow.review.report.report.requirements.length);assert.deepEqual(oldFlow.review.bids,['旧项目受审投标.docx']);assert.equal(oldFlow.workflow.state,'completed');
  assert.ok(oldArtifacts.some(a=>a.kind==='tender.directory'));assert.ok(oldArtifacts.some(a=>a.kind==='tender.volume'));
  const oldGuide=oldFlow.files.find(f=>f.path==='body/写作指引.md').content;
  const nativeFetch=globalThis.fetch,login=await nativeFetch(host.state.loginUrl,{redirect:'manual'}),auth=await nativeFetch(login.headers.get('location'),{redirect:'manual'}),cookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
  f=await fixture((url,options={})=>nativeFetch(new URL(url,host.state.base),{...options,headers:{Cookie:cookie,Origin:host.state.base,...options.headers}}));
  const opened=[];const mount=()=>f.mount('TenderList',{mode:'analysis',onOpen:id=>opened.push(id)});
  view=mount();await view.settle();
  const pick=async()=>{await find(view,n=>n.props.onPick).props.onPick(file);await view.settle();return opened.at(-1)};
  const clean=async tid=>{
   const s=await api('/page-flow/'+tid);assert.notEqual(tid,old);assert.deepEqual(s.files,[]);assert.deepEqual(s.body_files,[]);assert.equal(s.directory,null);assert.equal(s.bidder.confirmed,false);assert.equal(s.bidder.snapshot,null);assert.equal(s.session_id,null);assert.equal(s.execution,null);assert.equal(s.workflow,null);assert.equal(s.review.report,null);assert.deepEqual(s.review.bids,[]);assert.ok(s.analysis_progress.every(p=>p.done===0));
   assert.deepEqual((await api('/artifacts?task_id='+tid)).artifacts,[]);assert.deepEqual((await api('/workbench?task_id='+tid)).files.map(f=>f.path),[]);
   assert.deepEqual(s.source_selection,{main:file.name,supplements:[],excluded:[]});return s;
  };
  const first=await pick();await clean(first);
  const second=await pick();assert.notEqual(first,second);await clean(second);
  await host.command('reload');await clean(first);await clean(second);
  const retained=await api('/page-flow/'+old);assert.deepEqual(retained.directory,oldFlow.directory);assert.deepEqual(retained.review.report,oldFlow.review.report);assert.deepEqual(retained.workflow,oldFlow.workflow);assert.deepEqual((await api('/artifacts?task_id='+old)).artifacts,oldArtifacts);
  const png=Buffer.from(await (await host.api('/files/'+encodeURIComponent('交付验收原件.png')+'/raw?task_id='+old)).arrayBuffer());
  assert.equal((await api('/tasks',{title:oldFlow.task.title,request_id:old.slice(2)})).task.id,old,'归档前同一请求仍应正常对账');
  await api('/tasks/'+old,undefined,'DELETE');
  assert.equal((await host.api('/page-flow/'+old)).status,404);
  assert.equal(await readFile(join(dataRoot,'workspace/archive',old,'work/body/写作指引.md'),'utf8'),oldGuide);
  const archivedReplay=await host.api('/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:oldFlow.task.title,request_id:old.slice(2)})});
  const replayBody=await archivedReplay.json();
  if(archivedReplay.ok){const restored=await api('/page-flow/'+old);console.log('ARCHIVED_REPLAY_BUG '+JSON.stringify({status:archivedReplay.status,task_id:replayBody.task.id,session:restored.session_id,execution:restored.execution?.state}));}
  assert.equal(archivedReplay.status,409,'归档后的旧创建请求不能复活原项目并接回旧会话');assert.match(replayBody.detail,/已归档/);assert.ok(!(await api('/tasks')).tasks.some(t=>t.id===old));
  const third=await pick();assert.ok(![old,first,second].includes(third));await clean(third);
  await upload(third,new File([png],'交付验收原件.png'));
  let s=await api('/page-flow/'+third);
  const run=await api('/page-flow/'+third+'/action',{kind:'analyse',request_id:crypto.randomUUID(),input_version:s.input_versions.analyse,main_file:file.name,supplements:['交付验收原件.png']});
  assert.notEqual(run.session_id,started.sessionId);
  s=(await host.command('settleProject',{taskId:third})).state;assert.equal(s.execution.state,'completed');assert.equal(s.analysis_current,true);assert.equal(s.bidder.confirmed,false);assert.equal(s.files.filter(f=>f.path.startsWith('analysis/')).length,8);
  const evidence=await host.command('nativeEvidence',{sessionId:run.session_id});assert.ok(!JSON.stringify(evidence.events).includes(old));assert.ok(!s.files.some(f=>f.content.includes('旧项目专属')));
  const version=s.input_versions.analyse;
  await upload(third,new File([bytes],'补充说明.docx'));
  s=await api('/page-flow/'+third);assert.equal(s.analysis_current,false);assert.notEqual(s.input_versions.analyse,version);
  const before=await api('/page-flow/'+second);await upload(third,new File([bytes,Buffer.from('新版本')],file.name));
  assert.deepEqual(await api('/page-flow/'+second),before);await clean(second);
  const replaced=Buffer.from(await (await host.api('/files/'+encodeURIComponent(file.name)+'/raw?task_id='+second)).arrayBuffer());assert.deepEqual(replaced,bytes);
  await host.command('reload');await clean(second);
  console.log('ISOLATION_VERIFIED '+JSON.stringify({old,duplicates:[first,second],afterArchive:third,oldSession:started.sessionId,newSession:run.session_id,oldDirectory:oldFlow.directory.artifact_id,oldReportRequirements:oldFlow.review.report.report.requirements.length,oldWorkflow:oldFlow.workflow.id,oldArtifactCount:oldArtifacts.length,checks:['analysis','body','directory','artifacts','bidder','review','conversation','execution','workflow','progress','replacement','reload']}));
 }finally{view?.unmount();f?.close();await host.close()}
});
