import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';

test('投标文件取消大小上限，招标限制和格式校验继续生效',async()=>{
 const f=await fixture(async()=>response({}));
 try{
  assert.doesNotThrow(()=>f.api.validateUpload({name:'投标.docx',size:5*1024**3},'bid'));
  assert.throws(()=>f.api.validateUpload({name:'招标.docx',size:101*1024**2}),/100MB/);
  assert.throws(()=>f.api.validateUpload({name:'投标.zip',size:1},'bid'),/仅支持/);
 }finally{f.close()}
});

test('审查统计基于当前报告状态，所有待审核状态可筛选且总数一致',async()=>{
 const statuses=['unreviewed','running','reviewed','stale','failed','stopped'];
 const f=await fixture(async()=>response({tasks:statuses.map((status,i)=>({id:String(i),title:status,stage:'delivered',review_status:status,review_mode:'platform',created_at:'2026-10-13'}))}));
 const view=f.mount('TenderList',{mode:'review',onOpen(){}});
 try{await view.settle();const stats=()=>nodes(view.render()).filter(n=>n.props.className==='bp-stat');assert.deepEqual(stats().map(n=>n.props.children[1].props.children),[5,1,6]);stats()[0].props.onClick();await view.settle();assert.equal(nodes(view.render()).filter(n=>n.type==='article').length,5);stats()[1].props.onClick();await view.settle();assert.equal(nodes(view.render()).filter(n=>n.type==='article').length,1)}finally{view.unmount();f.close()}
});

test('制作页发起审核携带当前版本，提交成功后跳转当前项目审查',async()=>{
 const actions=[],modes=[];
 const flow={task:{id:'t1',title:'项目'},execution:null,analysis_progress:[],files:[],source_selection:{main:'招标.docx',supplements:[],excluded:[]},body_files:['body/章节.docx'],body_sections:[{path:'body/章节.docx'}],input_versions:{review:'current-review-version'},review:{mode:'platform',status:'unreviewed',bids:[],report:null}};
 const f=await fixture(async(url,options={})=>{if(url.endsWith('/action')){actions.push(JSON.parse(options.body));return response({session_id:'review-session'})}if(url.includes('/page-flow/'))return response(flow);return response(url.includes('/files?')||url.includes('/workbench?')?{files:[]}:{artifacts:[]})});
 const view=f.mount('ProjectWorkbench',{tid:'t1',mode:'build',onBack(){},onMode:mode=>modes.push(mode)});
 try{await view.settle();await find(view,n=>n.type==='button'&&n.props.children==='发起审核').props.onClick();assert.equal(actions.length,1);assert.equal(actions[0].kind,'review');assert.equal(actions[0].input_version,'current-review-version');assert.deepEqual(modes,['review'])}finally{view.unmount();f.close()}
});


test('审查头部集中操作、编号摘要与完整证据展示',async()=>{
 const categories=['结构事实','资格要求','递交要求','商务技术要求','格式要求','废标条款','评分标准'];
 const requirements=categories.map((category,i)=>({id:String(i),category,text:'要求'+i,status:'responded',tender:[{document_id:'t',start:1,end:1,quote:'招标原文'}],bid:[{document_id:'b',start:1,end:1,quote:'投标原文'}]}));
 requirements[0].tender.push({document_id:'supplement',start:30,end:34,quote:'补充文件的例外条款，适用范围待澄清。'});
 const issues=['disqualification','scoring','scoring','confirmation','suggestion'].map((risk_type,i)=>({id:'issue'+i,requirement_id:'0',risk_type,title:'问题'+i,explanation:'原文事实',suggestion:'处理建议'}));
 const report={summary:'已完成对照。团队人数不足；证书需要核验。\n建议补全证明。',requirements,issues,coverage:categories.map(category=>({category,note:'已检查原文'})),limitations:['签章人工核实']};
 const f=await fixture(async()=>response({}));
 const flow={task:{id:'t1'},execution:{kind:'review',session_id:'r',state:'completed',questions:[]},source_selection:{main:'招标.docx',supplements:[]},body_sections:[],body_files:[],review:{mode:'external',bids:['投标.docx'],status:'reviewed',report:{audit:{batches:7,requirements:7,assessments:Object.fromEntries(requirements.map(r=>[r.id,'双方证据支持本项判断']))},session_id:'r',report,decisions:{},documents:[{id:'t',name:'招标.docx'},{id:'supplement',name:'补充说明.docx'},{id:'b',name:'投标.docx'}],analysis:{previous_flow:{mode:'external',note:'独立审查依据'},reused_platform_analysis:false,validation:'[校验通过]',clarifications:[],catalog:requirements},checks:[{name:'制作过程检查',status:'not_applicable',detail:'外部文件没有素材使用计划，不能验证素材使用率。'}]}}};
 const props={tid:'t1',flow,sources:[{name:'招标.docx'},{name:'投标.docx'}],input:{answers:{},notes:{}},disabled:false,onChanged:async()=>{},execute:async()=>{}};
 const view=f.mount('ReviewWorkspace',props);
 try{
  await view.settle();
  const header=find(view,n=>n.props.className==='build-toolbar review-header');
  const actions=nodes(header).filter(n=>(n.type==='label'&&n.props.className==='bp-btn')||(n.type==='button'&&typeof n.props.children==='string'));
  assert.deepEqual(actions.map(n=>n.type==='label'?n.props.children[0]:n.props.children),['更新招标文件','更新投标文件','预览招标文件','预览投标文件','重新审核']);
  assert.equal(nodes(header).find(n=>n.props.role==='status').props.children,'已审核');
  const summary=find(view,n=>n.type==='ol'&&n.props.className==='review-summary');
  assert.deepEqual(nodes(summary).filter(n=>n.type==='li').map(n=>n.props.children),['已完成对照。','团队人数不足；','证书需要核验。','建议补全证明。']);
  assert.equal(nodes(view.render()).filter(n=>n.props.role==='tab').length,3);
  assert.doesNotMatch(JSON.stringify(view.render()),/灵燕能力整合审查|本次审查文件|新文件沿用|灵燕原检查/);
  const metrics=nodes(view.render()).filter(n=>n.props.className==='bp-stat');
  assert.deepEqual(metrics.map(n=>n.props.children[0].props.children),['可能废标','评分失分风险','需确认','建议修改']);
  assert.deepEqual(metrics.map(n=>n.props.children[1].props.children),[1,2,1,1]);
  metrics[1].props.onClick();
  assert.equal(nodes(view.render()).filter(n=>n.props.className==='review-issue').length,2);
  assert.ok(nodes(view.render()).some(n=>n.props['aria-label']==='处理备注'));
  assert.deepEqual(nodes(view.render()).filter(n=>n.type==='blockquote').map(n=>n.props.children),['招标原文','补充文件的例外条款，适用范围待澄清。','投标原文']);
  assert.match(JSON.stringify(view.render()),/补充说明.docx/);
  assert.doesNotMatch(JSON.stringify(view.render()),/高风险|中风险|低风险|语义复核/);
  find(view,n=>n.type==='button'&&n.props.children==='招标要点与对照').props.onClick();
  assert.equal(nodes(view.render()).filter(n=>n.type==='tr').length,8);
  assert.equal(nodes(view.render()).filter(n=>n.type==='summary'&&n.props.children==='查看依据与响应').length,7);
  flow.execution.state='running';flow.review.status='running';props.disabled=true;
  assert.equal(nodes(view.render()).find(n=>n.props.role==='status').props.children,'审核中');
  const runningHeader=find(view,n=>n.props.className==='build-toolbar review-header');
  assert.ok(nodes(runningHeader).some(n=>n.type==='button'&&n.props.children==='停止'));
  assert.ok(nodes(runningHeader).filter(n=>n.type==='input').every(n=>n.props.disabled));
  flow.review.mode='platform';
  flow.review.report.analysis.previous_flow={mode:'platform',directory:null,analysis_files:[],analysis_note:'原文与有效版本为准',planning:[{kind:'guide',status:'ready',changes:[]},{kind:'promises',status:'stale',changes:['招标解读已变化']}],chapters:[{status:'ready'},{status:'stale'}],orphan_body_files:['旧正文.docx'],bidder:{confirmed:true,stale:false}};
  const rendered=JSON.stringify(view.render());
  assert.match(rendered,/本轮采用的前序成果/);
  assert.match(rendered,/有效，参与比对/);
  assert.match(rendered,/已过期，待重新核对/);
  assert.match(rendered,/招标解读已变化/);
 }finally{view.unmount();f.close()}
});
