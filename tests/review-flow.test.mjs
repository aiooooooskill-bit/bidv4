import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';

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
