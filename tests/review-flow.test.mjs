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
 const report={document_issues:[],check_notes:[],summary_items:['本轮已核查七类要点。','本次形成2条审查意见。'],requirements,issues,coverage:categories.map(category=>({category,note:'已检查原文'})),limitations:['签章人工核实']};
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
  assert.deepEqual(nodes(summary).filter(n=>n.type==='li').map(n=>n.props.children),['本轮已核查七类要点。','本次形成2条审查意见。']);
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

test('终稿检查问题进入零模型问题报告的清单并支持处理记录',async()=>{
 const requests=[];
 const f=await fixture(async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return response({ok:true})});
 const program={id:'document-check:0:1',document_ids:['bid-0'],location:'T2R3',risk_type:'suggestion',title:'正文含内联占位',explanation:'T2R3：正文含【待补】',suggestion:'补齐正式内容'};
 const report={summary_items:['招标逐项对照已完成。'],issues:[],document_issues:[program],check_notes:[{name:'终稿检查',notes:['签章未核验']}],requirements:[],coverage:[],limitations:['签章人工核验']};
 const flow={execution:null,source_selection:{main:'招标.docx'},review:{mode:'external',status:'reviewed',bids:['投标.docx'],report:{report,decisions:{},session_id:'r',documents:[{id:'bid-0',name:'投标.docx'}],analysis:{previous_flow:{mode:'external'},clarifications:[]},audit:{assessments:{}}}}};
 const view=f.mount('ReviewWorkspace',{tid:'t1',flow,sources:[],input:{},disabled:false,onChanged:async()=>{},execute:async()=>{}});
 try{
  await view.settle();
  const metrics=nodes(view.render()).filter(n=>n.props.className==='bp-stat');
  assert.deepEqual(metrics.map(n=>n.props.children[1].props.children),[0,0,0,1]);
  assert.doesNotMatch(JSON.stringify(view.render()),/本次已核查范围内未发现问题/);
  metrics[3].props.onClick();await view.settle();
  assert.equal(nodes(view.render()).filter(n=>n.props.className==='review-issue').length,1);
  assert.match(JSON.stringify(view.render()),/投标文件终稿检查|T2R3/);
  find(view,n=>n.type==='textarea').props.onChange({target:{value:'核对后补齐'}});await view.settle();
  await find(view,n=>n.type==='button'&&n.props.children==='保存备注').props.onClick();
  assert.equal(requests[0].body.issue_id,program.id);assert.equal(requests[0].body.note,'核对后补齐');
 }finally{view.unmount();f.close()}
});

function pagedReviewProps(){
 const issues=Array.from({length:12},(_,i)=>({id:'issue'+i,requirement_id:'requirement',risk_type:i%2?'confirmation':'scoring',title:'问题'+i,explanation:'原文事实'+i,suggestion:'处理建议'+i}));
 const program={id:'document-check:0:1',document_ids:['b'],location:'P8',risk_type:'suggestion',title:'终稿占位问题',explanation:'正文含占位',suggestion:'补齐内容'};
 const requirement={id:'requirement',category:'商务技术要求',text:'招标要求',status:'responded',tender:[{document_id:'t',start:1,end:1,quote:'招标原文'}],bid:[{document_id:'b',start:1,end:1,quote:'投标原文'}]};
 const report={summary_items:['概要'],issues,document_issues:[program],check_notes:[],requirements:[requirement],coverage:[],limitations:['图片待核验']};
 const flow={execution:null,source_selection:{main:'招标.docx'},review:{mode:'external',status:'reviewed',bids:['投标.docx'],report:{report,decisions:{issue5:{status:'pending',note:'已保存备注'}},session_id:'r',documents:[{id:'t',name:'招标.docx'},{id:'b',name:'投标.docx'}],analysis:{previous_flow:{mode:'external'},clarifications:[]},audit:{assessments:{requirement:'双方对照'}}}}};
 return {tid:'t1',flow,sources:[],input:{},disabled:false,onChanged:async()=>{},execute:async()=>{}};
}
const issueCards=view=>nodes(view.render()).filter(n=>n.props.className==='review-issue');
const issuePager=view=>find(view,n=>typeof n.type==='function'&&n.type.name==='Pager');
const showIssues=view=>find(view,n=>n.props.role==='tab'&&String(n.props.children).startsWith('问题清单')).props.onClick();

test('问题清单分页覆盖全部模型和终稿意见，详情随翻页且页数缩减不落空',async()=>{
 const f=await fixture(async()=>response({})),props=pagedReviewProps(),view=f.mount('ReviewWorkspace',props);
 try{
  await view.settle();showIssues(view);await view.settle();
  assert.equal(issueCards(view).length,5);assert.deepEqual(issueCards(view).map(n=>n.props.children[2].props.children),['问题0','问题1','问题2','问题3','问题4']);
  assert.deepEqual(issuePager(view).props.page,{total:13,page:1,pages:3,page_size:5});
  issuePager(view).props.onChange(2,5);await view.settle();
  assert.equal(find(view,n=>n.type==='h2').props.children,'问题5');assert.equal(find(view,n=>n.type==='textarea').props.value,'已保存备注');
  issueCards(view)[3].props.onClick();await view.settle();assert.equal(find(view,n=>n.type==='h2').props.children,'问题8');
  issuePager(view).props.onChange(3,5);await view.settle();assert.deepEqual(issueCards(view).map(n=>n.props.children[2].props.children),['问题10','问题11','终稿占位问题']);
  const pagerControls=nodes(issuePager(view).type(issuePager(view).props));assert.equal(pagerControls.find(n=>n.type==='button'&&n.props.children==='下一页').props.disabled,true);
  props.flow.review.report.report.issues.splice(4);await view.settle();assert.equal(issuePager(view).props.page.page,1);assert.equal(issueCards(view).length,5);assert.equal(find(view,n=>n.type==='h2').props.children,'问题0');
 }finally{view.unmount();f.close()}
});

test('问题分类、待处理筛选和每页数量切换重置页码并保留全量统计',async()=>{
 const f=await fixture(async()=>response({})),props=pagedReviewProps(),view=f.mount('ReviewWorkspace',props);
 try{
  await view.settle();showIssues(view);await view.settle();issuePager(view).props.onChange(3,5);await view.settle();
  find(view,n=>n.props.className==='bp-tab'&&n.props.children?.[0]==='评分失分风险').props.onClick();await view.settle();
  assert.deepEqual(issuePager(view).props.page,{total:6,page:1,pages:2,page_size:5});assert.equal(find(view,n=>n.type==='h2').props.children,'问题0');
  issuePager(view).props.onChange(2,5);await view.settle();assert.equal(find(view,n=>n.type==='h2').props.children,'问题10');
  const select=nodes(issuePager(view).type(issuePager(view).props)).find(n=>n.type==='select');select.props.onChange({target:{value:'10'}});await view.settle();assert.deepEqual(issuePager(view).props.page,{total:6,page:1,pages:1,page_size:10});assert.equal(issueCards(view).length,6);
  find(view,n=>n.props.className==='bp-tab'&&n.props.children?.[0]==='全部').props.onClick();await view.settle();
  props.flow.review.report.decisions={...props.flow.review.report.decisions,...Object.fromEntries(Array.from({length:10},(_,i)=>['issue'+i,{status:'confirmed',note:''}]))};await view.settle();
  find(view,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await view.settle();assert.equal(issuePager(view).props.page.total,3);assert.equal(issueCards(view).length,3);assert.match(JSON.stringify(view.render()),/已处理 /);
  props.flow.review.report.created_at='new-report';await view.settle();assert.equal(issuePager(view).props.page.page,1);
 }finally{view.unmount();f.close()}
});

test('同一会话的新报告重置问题与备注，保存携带报告版本',async()=>{
 const requests=[],f=await fixture(async(url,options)=>{requests.push(JSON.parse(options.body));return response({})}),props=pagedReviewProps(),view=f.mount('ReviewWorkspace',props);
 props.flow.review.report.created_at='first-report';
 try{
  await view.settle();showIssues(view);await view.settle();issuePager(view).props.onChange(2,5);await view.settle();
  find(view,n=>n.type==='textarea').props.onChange({target:{value:'旧报告草稿'}});await view.settle();
  props.flow.review.report.created_at='second-report';await view.settle();
  assert.equal(issuePager(view).props.page.page,1);assert.equal(find(view,n=>n.type==='h2').props.children,'问题0');assert.equal(find(view,n=>n.type==='textarea').props.value,'');
  find(view,n=>n.type==='textarea').props.onChange({target:{value:'本轮备注'}});await view.settle();
  find(view,n=>n.type==='button'&&n.props.children==='保存备注').props.onClick();await view.settle();
  assert.deepEqual(requests,[{session_id:'r',report_created_at:'second-report',issue_id:'issue0',status:'pending',note:'本轮备注'}]);
 }finally{view.unmount();f.close()}
});

test('问题清单翻页遵循未保存备注保护，放弃草稿后显示目标页已保存备注',async()=>{
 const f=await fixture(async()=>response({})),guard=f.mount('NavigationGuard',{children:null});guard.render();
 const view=f.mount('ReviewWorkspace',pagedReviewProps());
 try{
  await view.settle();showIssues(view);await view.settle();
  find(view,n=>n.type==='textarea').props.onChange({target:{value:'未保存草稿'}});await view.settle();guard.render();
  issuePager(view).props.onChange(2,5);await view.settle();guard.render();assert.equal(issuePager(view).props.page.page,1);assert.equal(find(view,n=>n.type==='textarea').props.value,'未保存草稿');
  find(guard,n=>n.type==='button'&&n.props.children==='继续编辑').props.onClick();guard.render();assert.equal(issuePager(view).props.page.page,1);
  issuePager(view).props.onChange(2,5);guard.render();find(guard,n=>n.type==='button'&&n.props.children==='丢弃修改并离开').props.onClick();await view.settle();guard.render();
  assert.equal(issuePager(view).props.page.page,2);assert.equal(find(view,n=>n.type==='h2').props.children,'问题5');assert.equal(find(view,n=>n.type==='textarea').props.value,'已保存备注');
 }finally{view.unmount();guard.unmount();f.close()}
});
