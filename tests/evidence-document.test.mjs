import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module from 'node:module';
import {locateEvidenceReference} from '../shared/evidence-citation.js';
import {parseMarkdown,markdownSourceMap} from '../shared/markdown.js';
import {fixture,find,response} from './helpers/component-fixture.mjs';

const compiledResult=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MarkdownDocument} from './src/components/MarkdownDocument';export {businessDraft,joinBusinessDraft} from './src/lib/businessDraft';export const render=(content,registry,sourceNames)=>renderToStaticMarkup(React.createElement(MarkdownDocument,{content,registry,sourceNames,onEvidence:()=>{}}));export const buttons=(content,registry,sourceNames,onEvidence)=>{const document=MarkdownDocument({content,registry,sourceNames,onEvidence});const markdown=document.props.children;const tree=markdown.type(markdown.props);const result=[];const walk=n=>{if(Array.isArray(n)){n.forEach(walk);return}if(!n||typeof n!=='object')return;if(typeof n.type==='function'){walk(n.type(n.props));return}if(n.type==='button')result.push(n);walk(n.props?.children)};walk(tree);return result};",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'});
const compiled=new Module(process.cwd()+'/tests/evidence-document.cjs');compiled._compile(compiledResult.outputFiles[0].text,process.cwd()+'/tests/evidence-document.cjs');
const {render,buttons,businessDraft,joinBusinessDraft}=compiled.exports;
const sources=['原件 A（定稿）.pdf','答疑 B.docx'];
const work=sources.map(source=>({path:`parse/${source}/${source}.md`}));
const registry={'REQ-01':{text:'允许离线部署',出处:`${sources[0]}（L10-L12）`},'TPL-01':{text:'使用招标人提供的表格',出处:`${sources[1]}（L30）`}};
const table=(header,cells)=>`| ${header.join(' | ')} |\n|${header.map(()=>'---').join('|')}|\n${cells.map(row=>`| ${row.join(' | ')} |`).join('\n')}\n`;

test('大段业务文本能映射和编辑，不因字符数组作为函数参数而崩溃',()=>{
 const content='说明'.repeat(65000);
 const mapping=markdownSourceMap(parseMarkdown(content).children[0],content);
 assert.equal(mapping.text,content);assert.equal(mapping.positions.length,content.length);
 assert.deepEqual(mapping.positions.at(-1),{start:content.length-1,end:content.length});
 const fields=businessDraft(content,sources);
 assert.equal(joinBusinessDraft(content,fields),content);
});

test('不同标书的混合依据保留正文、强调与链接，只展开引用编号',()=>{
 const content=table(['事项','依据'],[['部署','**至少三年服务**，见 req-1；[风险说明](https://example.invalid/risk)，不得补造。']]);
 const html=render(content,registry,sources);
 assert.match(html,/<strong>至少三年服务<\/strong>/);
 assert.match(html,/允许离线部署/);assert.match(html,/不得补造/);
 assert.match(html,/href="https:\/\/example.invalid\/risk"/);
 assert.doesNotMatch(html,/req-1/i);
 const missing=render(content,undefined,sources);
 assert.match(missing,/至少三年服务/);assert.match(missing,/风险说明/);assert.match(missing,/不得补造/);
 assert.match(missing,/依据未关联/);
});

test('长短编号及大小写遵循同一关联协议，纯编号列表不展示顿号残渣',()=>{
 const content=table(['依据'],[['REQ-1、`tpl-1`、REQ-01']]);
 const html=render(content,registry,sources);
 assert.equal((html.match(/允许离线部署/g)??[]).length,1);
 assert.match(html,/使用招标人提供的表格/);
 assert.doesNotMatch(html,/(?:REQ|TPL)-\d|<td>、<\/td>/i);
 assert.equal(buttons(content,registry,sources,()=>{}).length,2);
 assert.equal(businessDraft(content).length,0);
 assert.equal(joinBusinessDraft(content,businessDraft(content)),content);
 const unverified=render(content,undefined,sources);
 assert.equal((unverified.match(/依据未关联/g)??[]).length,1);
 assert.match(unverified,/2 项依据未关联/);
});

test('依据业务文字可以修改保存，编号、内联出处及Markdown关联位置保留',()=>{
 const content=table(['事项','依据'],[['履约','**三年维护**，依据 REQ-1；原件 A（定稿）.pdf 第五节（L10-L12），按已确认范围响应。']]);
 const fields=businessDraft(content,sources);
 assert.ok(fields.some(field=>field.value.includes('三年维护')));
 assert.ok(fields.every(field=>!/(REQ-1|原件 A|第五节|L10)/.test(field.value)));
 assert.equal(joinBusinessDraft(content,fields),content);
 const edited=fields.map(field=>({...field,value:field.value.replace('三年维护','五年维护').replace('已确认范围','更新范围')}));
 assert.equal(joinBusinessDraft(content,edited),content.replace('三年维护','五年维护').replace('已确认范围','更新范围'));
});

test('纯业务依据和空白依据保持可编辑，不以依据表头锁死业务内容',()=>{
 const content=table(['事项','依据'],[['期限','按用户确认的合同期限编写'],['范围','']]);
 const fields=businessDraft(content,sources);
 assert.ok(fields.some(field=>field.value==='按用户确认的合同期限编写'));
 assert.ok(fields.some(field=>field.label.endsWith('依据')&&field.value===''));
 const edited=fields.map(field=>field.value==='按用户确认的合同期限编写'?{...field,value:'按已确认的服务范围编写'}:field);
 assert.equal(joinBusinessDraft(content,edited),content.replace('按用户确认的合同期限编写','按已确认的服务范围编写'));
});

test('Markdown转义、实体及格式化出处和编号按AST原文位置受保护',()=>{
 const source='采购 文件(新版).pdf';
 for(const header of ['依据','原文依据'])for(const citation of ['采购 文件\\(新版\\).pdf 第一节（L10-L12）','采购&#32;文件&#40;新版&#41;.pdf 第一节（L10-L12）','**采购 文件(新版).pdf** 第一节（L10-L12）']){
  const content=table([header],[['业务文字，'+citation+'，按照 REQ\\-1 提供服务。']]);
  const fields=businessDraft(content,[source]);
  assert.ok(fields.some(field=>field.value.includes('业务文字')));
  assert.ok(fields.every(field=>!/采购|文件|新版|第一节|REQ/.test(field.value)));
  assert.equal(joinBusinessDraft(content,fields),content);
  assert.equal(joinBusinessDraft(content,fields.map(field=>({...field,value:field.value.replace('提供服务','响应范围')}))),content.replace('提供服务','响应范围'));
  const html=render(content,{'REQ-01':{text:'符合当前采购需求',出处:source+'（L10-L12）'}},[source]);
  assert.match(html,/符合当前采购需求/);assert.match(html,/业务文字/);
  assert.doesNotMatch(html,/REQ/);
 }
});

test('原文出处线索继承同列前文，多个来源和行号逐个打开真实解析稿',()=>{
 const content=table(['章节名称','原文出处线索'],[['声明',`${sources[0]} 附件一（L10-L12）`],['资格','同文件 附件二（L20）'],['报价',`${sources[1]}（L30）；同文件（L35-L36）`]]);
 const selected=[];
 const actions=buttons(content,undefined,sources,citation=>selected.push(locateEvidenceReference(citation,work)));
 assert.equal(actions.length,4);
 actions.forEach(action=>action.props.onClick());
 assert.deepEqual(selected.map(({path,start,end})=>[path,start,end]),[[work[0].path,10,12],[work[0].path,20,20],[work[1].path,30,30],[work[1].path,35,36]]);
 const fields=businessDraft(content,sources);
 assert.deepEqual(fields.map(field=>field.value),['声明','资格','报价']);
});

test('来源锚按表与列隔离，未明确来源无法通过单文件猜测或邻列锚打开',()=>{
 const content=table(['内容','出处'],[[`${sources[0]}（L1）`,'同文件（L2）']])+'\n'+table(['内容','出处'],[['孤立','同文件（L3）']]);
 const selected=[];
 const actions=buttons(content,undefined,sources,citation=>selected.push(citation));
 actions.forEach(action=>action.props.onClick());
 assert.equal(selected.length,3);
 assert.equal(locateEvidenceReference(selected[0],work).source,sources[0]);
 assert.throws(()=>locateEvidenceReference(selected[1],[work[0]]),/未明确/);
 assert.throws(()=>locateEvidenceReference(selected[2],[work[0]]),/未明确/);
});

test('项目渲染使用文档自己的依据映射；证据请求携带精确文件与区段',async()=>{
 const file={path:'body/写作指引.md',content:table(['节','依据'],[['示例','REQ-1']]),hash:'old',registry};
 const flow={task:{id:'evidence-project',title:'另一份采购文件'},execution:null,analysis_progress:[],files:[file],directory:{artifact_id:'dir',content_seq:2,content:{registry:{'REQ-01':{text:'错误的新要求'}},response_documents:[]}},source_selection:{main:sources[0],supplements:[],excluded:[]},body_files:[],body_sections:[],volume_states:[],input_versions:{}};
 const reads=[];
 const f=await fixture(async(url)=>{if(url.includes('/workbench/content?')){reads.push(new URL(url,'http://fixture'));return response({content:'精确原文'})}if(url.includes('/page-flow/'))return response(flow);if(url.includes('/files?'))return response({files:[]});if(url.includes('/artifacts?'))return response({artifacts:[]});if(url.includes('/workbench?'))return response({files:work});throw new Error('unexpected '+url)});
 const view=f.mount('ProjectWorkbench',{tid:flow.task.id,mode:'build',onBack(){},onMode(){}});
 try{
  await view.settle();
  const workspace=find(view,node=>node.props.renderDocument);
  const document=workspace.props.renderDocument(file);
  assert.deepEqual(document.props.registry,registry);assert.deepEqual(document.props.sourceNames,sources);
  await document.props.onEvidence(`${sources[1]}（L35-L36）`);
  assert.equal(reads.length,1);assert.equal(reads[0].searchParams.get('path'),work[1].path);assert.equal(reads[0].searchParams.get('start'),'35');assert.equal(reads[0].searchParams.get('end'),'36');
  await document.props.onEvidence('同文件（L20）');
  assert.equal(reads.length,1,'无锚不发读取请求');
 }finally{view.unmount();f.close()}
});
