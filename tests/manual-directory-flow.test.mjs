import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {fixture,find,nodes} from './helpers/component-fixture.mjs';
import {root} from '../server/native/business.mjs';
import {pythonExecutable} from '../server/platform.mjs';
import {manualDirectoryCurrent,actionSatisfied} from '../shared/delivery-status.js';

const name='人工目录保存立即生效：改名移动保全正文、清除误报、后续原生Agent读取当前目录';
if(process.env.BIDV4_DIRECTORY_FIXTURE!=='1')test(name,{timeout:180000},()=>runIsolatedTest('manual-directory-flow.test.mjs','BIDV4_DIRECTORY_FIXTURE',new RegExp(name),170000));
else test(name,{timeout:160000},async()=>{
 const host=await analysisFixture();let component,view;
 const nativeFetch=globalThis.fetch,login=await nativeFetch(host.state.loginUrl,{redirect:'manual'}),auth=await nativeFetch(login.headers.get('location'),{redirect:'manual'});
 const cookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
 const api=(path,options={})=>nativeFetch(host.state.base+'/api/bidv4'+path,{...options,headers:{Cookie:cookie,Origin:host.state.base,...options.headers}});
 const json=async(path,body,method='POST')=>{const response=await api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json()};
 const flow=async tid=>(await api('/page-flow/'+tid)).json();
 try{
  const {task}=await json('/tasks',{title:'人工目录回归（虚构）',request_id:randomUUID()}),tid=task.id;
  const form=new FormData();form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'交付验收原件.png');
  assert.ok((await api('/files?task_id='+tid,{method:'POST',body:form})).ok);
  const company=await json('/library/companies',{name:'人工目录回归公司',profile:{legal_name:'测试法人',legal_title:'总经理',address:'测试地址',phone:'123',email:'fixture@example.test',fax:'无'}});
  await json('/projects/'+tid+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-19',revision:0},'PUT');
  for(const kind of ['analyse','outline']){
   const state=await flow(tid);
   await json('/page-flow/'+tid+'/action',{kind,main_file:'交付验收原件.png',supplements:[],request_id:randomUUID(),input_version:state.input_versions[kind],...(kind==='outline'?{page_target:null,numbering:'decimal'}:{})});
   assert.equal((await host.command('settleProject',{taskId:tid})).state.execution.state,'completed');
  }
  const outlined=await flow(tid);
  await json('/page-flow/'+tid+'/action',{kind:'build',request_id:randomUUID(),input_version:outlined.input_versions.build,sections:[]});
  let built=(await host.command('settleProject',{taskId:tid})).state;
  assert.equal(built.execution.state,'needs_input');
  await json('/page-flow/'+tid+'/answer',{session_id:built.session_id,call_ids:built.execution.questions.map(q=>q.callId),batches:built.execution.questions.map(q=>({call_id:q.callId,answers:q.questions.map(question=>({id:question.id,selected:['三年']}))}))});
  built=(await host.command('settleProject',{taskId:tid})).state;
  assert.equal(built.execution.state,'completed',built.execution.error);
  const work=join(root,'data/workspace',tid,'work');
  await promisify(execFile)(pythonExecutable(root),['-c',`import sys,os
os.environ['DATA_DIR']=sys.argv[1]
from pathlib import Path
from docx import Document
from app.services import build_state
p=Path(sys.argv[2])/'body/交付验收章节.docx'
d=Document(); d.add_heading('交付验收章节',1); d.add_paragraph('人工填写的完整正文12345。'); d.add_table(rows=1,cols=1).cell(0,0).text='原表格98765';d.save(p)
build_state.record_section(sys.argv[3],'body/交付验收章节.docx')`,join(root,'data'),work,tid],{env:{...process.env,PYTHONPATH:join(root,'business/python')}});
  const original=await readFile(join(work,'body/交付验收章节.docx'));
  let current=await flow(tid);assert.equal(current.body_sections.find(s=>s.title==='交付验收章节').status,'ready');
  component=await fixture(async(url,options)=>api(String(url).replace('/api/bidv4',''),options));
  view=component.mount('DirectoryPanel',{tid,value:current.directory,statuses:current.body_sections,onSaved:async()=>{current=await flow(tid)},onSelect(){}});
  const click=label=>find(view,n=>n.type==='button'&&n.props.children===label).props.onClick();
  click('编辑目录');view.render();
  find(view,n=>n.props['aria-label']==='编辑标题：交付验收章节').props.onClick();view.render();
  find(view,n=>n.props['aria-label']==='章节标题').props.onChange({target:{value:'人工确认实施方案'}});view.render();click('确认');view.render();
  click('+ 添加一级目录');view.render();find(view,n=>n.props['aria-label']==='章节标题').props.onChange({target:{value:'技术响应'}});view.render();click('确认');view.render();
  find(view,n=>n.props['aria-label']==='更多操作：人工确认实施方案').props.onClick({currentTarget:{getBoundingClientRect:()=>({bottom:300,right:300})}});view.render();click('移动到其他父级');view.render();
  const select=find(view,n=>n.props['aria-label']==='目标父级'),parent=nodes(select).find(n=>n.type==='option'&&n.props.children==='技术响应');select.props.onChange({target:{value:parent.props.value}});view.render();click('确认');view.render();
  const previousSeq=current.directory.content_seq;click('保存目录');
  const deadline=Date.now()+15000;
  while(current.directory.content_seq===previousSeq&&Date.now()<deadline){await view.settle();await new Promise(resolve=>setTimeout(resolve,25))}
  assert.ok(current.directory.content_seq>previousSeq,'真实保存和状态刷新必须完成');
  assert.equal(current.execution.kind,'build');assert.equal(current.execution.state,'completed','已经验收成功的制作动作不能因后续人工目录调整而误报失败');
  assert.equal(current.directory.content.response_documents[0].directory.find(n=>n.目录名称==='技术响应').children[0].目录名称,'人工确认实施方案');
  const renamed=current.body_sections.find(s=>s.title==='人工确认实施方案');
  assert.ok(!current.body_sections.some(s=>s.title==='技术响应'),'新建分组父节点不应额外要求一份正文');
  assert.equal(renamed.status,'stale');assert.deepEqual(current.orphan_body_files,[]);
  assert.deepEqual(await readFile(join(work,renamed.path)),original);
  assert.ok(manualDirectoryCurrent(current,current.execution));
  assert.ok(actionSatisfied(current,{kind:'outline',created_at:current.execution.created_at}));
  // 后续动作须通过原生会话读取当前成果，不能把人工保存当成旧AI契约失败。
  const admission=await json('/page-flow/'+tid+'/action',{kind:'guide',request_id:randomUUID(),input_version:current.input_versions.guide});
  assert.match(admission.instructions,/当前有效投标目录/);assert.match(admission.instructions,new RegExp('"content_seq":'+current.directory.content_seq));
  current=(await host.command('settleProject',{taskId:tid})).state;
  assert.equal(current.execution.state,'completed',current.execution.error);assert.equal(current.build_preparation.guide,'ready');
  const guide=current.files.find(f=>f.path==='body/写作指引.md').content;
  assert.match(guide,/人工确认实施方案/);assert.doesNotMatch(guide,/交付验收章节/);
  assert.doesNotMatch(guide,/^\| 技术响应 \|/m,'指引只安排叶子正文，不额外派发分组父节点');
  const evidence=await host.command('projectEvidence',{taskId:tid});
  assert.ok(evidence.events.some(e=>e.type==='tool/call'&&e.data.name==='read_artifact'));
  assert.equal(evidence.records.find(r=>r.kind==='outline').projection.state,'completed');
  const completedBuild=evidence.records.find(r=>r.kind==='build');
  assert.ok(completedBuild.verified_completed_at);assert.equal(completedBuild.projection.state,'completed');
  const changed=structuredClone(current);changed.input_versions.outline='changed';assert.equal(manualDirectoryCurrent(changed),false);
  assert.equal(manualDirectoryCurrent(current,{created_at:current.directory.user_saved_at+1}),false);
  // 同名父节点只分组，不占正文文件名；真实 HTTP 保存后原正文仍逐字节保留。
  const content=structuredClone(current.directory.content),leaf=content.response_documents[0].directory.find(n=>n.目录名称==='技术响应').children[0];
  content.response_documents[0].directory=[
   ...content.response_documents[0].directory.filter(n=>['封面','目录'].includes(n.目录名称)),
   {目录名称:'开发服务',level:1,children:[{目录名称:'组织安排',level:2,children:[{...leaf,level:3}]}]},
   {目录名称:'运维服务',level:1,children:[{目录名称:'组织安排',level:2,children:[{目录名称:'维护方案',level:3}]}]}
  ];
  await json('/artifacts/'+current.directory.artifact_id+'/content',{content,base_content_seq:current.directory.content_seq},'PUT');
  current=await flow(tid);
  assert.ok(!current.body_sections.some(s=>s.title==='组织安排'));
  assert.deepEqual(current.orphan_body_files,[]);
  assert.deepEqual(await readFile(join(work,'body/人工确认实施方案.docx')),original);
  await promisify(execFile)(pythonExecutable(root),['-c',`from docx import Document
import sys
d=Document();d.add_heading('维护方案',1);d.add_paragraph('独立的运维正文不得覆盖开发正文45678。');d.save(sys.argv[1])`,join(work,'body/维护方案.docx')]);
  const maintenance=await readFile(join(work,'body/维护方案.docx'));
  const collision=structuredClone(current.directory.content),parents=collision.response_documents[0].directory;
  parents.find(n=>n.目录名称==='开发服务').children[0].children[0].目录名称='API方案';parents.find(n=>n.目录名称==='运维服务').children[0].children[0].目录名称='api方案';
  const volume=content.response_documents[0].name;
  const renames=[['人工确认实施方案','API方案'],['维护方案','api方案']].map(([from_title,to_title])=>({volume,from_title,to_title}));
  const rejected=await api('/artifacts/'+current.directory.artifact_id+'/content',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:collision,base_content_seq:current.directory.content_seq,renamed_sections:renames})});
  assert.equal(rejected.status,422);assert.match(await rejected.text(),/文件名重复/);
  assert.equal((await flow(tid)).directory.content_seq,current.directory.content_seq);
  assert.deepEqual(await readFile(join(work,'body/人工确认实施方案.docx')),original);
  assert.deepEqual(await readFile(join(work,'body/维护方案.docx')),maintenance);
  for(const title of ['API方案','api方案']){
   const edited=structuredClone(current.directory.content),node=edited.response_documents[0].directory.find(n=>n.目录名称==='开发服务').children[0].children[0];
   const from=node.目录名称;node.目录名称=title;
   await json('/artifacts/'+current.directory.artifact_id+'/content',{content:edited,base_content_seq:current.directory.content_seq,renamed_sections:[{volume,from_title:from,to_title:title}]},'PUT');
   current=await flow(tid);
   assert.deepEqual(await readFile(join(work,'body/'+title+'.docx')),original);
   assert.deepEqual(await readFile(join(work,'body/维护方案.docx')),maintenance);
   assert.deepEqual(current.orphan_body_files,[]);
  }
 }finally{view?.unmount();component?.close();await host.close()}
});
