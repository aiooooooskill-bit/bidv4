import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module from 'node:module';
async function module(path){const result=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))}
const draft=await module('src/lib/businessDraft.ts');
test('格式化标题与表头按AST文本识别，原文位置仍可无损保存',()=>{
 const content='## **来源标注**\n\n- 隐藏关联\n\n## 业务内容\n\n| 要求 | **出处** |\n|---|---|\n| 三年\\|7×24 | 招标文件.docx L10 |\n';
 const fields=draft.businessDraft(content);
 assert.ok(fields.some(field=>field.value==='三年\\|7×24'));
 assert.ok(fields.every(field=>!/隐藏关联|招标文件/.test(field.value)));
 assert.equal(draft.joinBusinessDraft(content,fields),content);
});
test('业务编辑隐藏内部标识并原位保存关联与元信息',()=>{
 const original='<!-- metadata -->\n# 投标要求\n\n| 编号 | 要求 | 出处 |\n|---|---|---|\n| REQ-01 | 三年服务 | 源文件 L10 |\n\n## 来源标注\nMAND-01\n\n## 说明\n覆盖 REQ-01 的技术方案。\n';
 const fields=draft.businessDraft(original);assert.ok(fields.length);assert.ok(fields.every(f=>!/(REQ|MAND)-01|metadata|来源标注/.test(f.value)));
 assert.equal(draft.joinBusinessDraft(original,fields),original);
 const changed=fields.map(f=>f.value.includes('三年服务')?{...f,value:f.value.replace('三年服务','五年服务')}:f);
 assert.equal(draft.joinBusinessDraft(original,changed),original.replace('三年服务','五年服务'));
});
const directory=await module('src/lib/directoryTree.ts');
test('目录升降级保持来源字段、重新编号且禁止超深树',()=>{
 const docs=[{directory:[{_id:'a',目录名称:'一',level:1,children:[],来源:['REQ-01']},{_id:'b',目录名称:'二',level:1,children:[],理由来源:['MAND-01']}]}];
 assert.ok(directory.demote(docs,'b'));assert.equal(docs[0].directory[0].children[0].level,2);assert.deepEqual(docs[0].directory[0].children[0].理由来源,['MAND-01']);assert.ok(directory.promote(docs,'b'));assert.equal(docs[0].directory[1].level,1);
});

test('整格替换不删除GFM分隔符，新增竖线不产生额外列',()=>{
 const original='| 编号 | 要求 | 出处 |\n|---|---|---|\n| REQ-01 | 三年服务 | 源文件 L10 |\n';
 const fields=draft.businessDraft(original);
 const cell=fields.find(f=>f.value==='三年服务');assert.ok(cell);
 assert.equal(draft.joinBusinessDraft(original,fields),original);
 const replaced=fields.map(f=>f===cell?{...f,value:'甲|乙\n新增说明'}:f);
 assert.equal(draft.joinBusinessDraft(original,replaced),original.replace('三年服务','甲\\|乙 新增说明'));
 assert.ok(replaced.every(f=>!f.value.includes('REQ-01')));
 const blank='| 事项 | 值 |\n|---|---|\n| 时限 |  |\n';
 const blankFields=draft.businessDraft(blank);const empty=blankFields.find(f=>f.value==='');assert.ok(empty);
 const filled=draft.joinBusinessDraft(blank,blankFields.map(f=>f===empty?{...f,value:'90天'}:f));
 assert.ok(filled.includes('| 时限 |  90天|'));
 assert.equal(draft.joinBusinessDraft(blank,blankFields),blank);
});

test('业务编辑保留整列出处、行号、模型状态及内联文件关联',()=>{
 const original='| 要求 | 出处 | 状态 |\n|---|---|---|\n| 三年服务 | 招标文件.docx 前附表（L10-L20） | unknown |\n\n补充要求：五年维护，招标文件.pdf 第三章 L30-L40；状态 conflicting。\n';
 const fields=draft.businessDraft(original);
 assert.ok(fields.every(f=>!/招标文件|L\d|unknown|conflicting/.test(f.value)));
 const changed=fields.map(f=>({...f,value:f.value.replace('三年服务','四年服务').replace('五年维护','六年维护')}));
 assert.equal(draft.joinBusinessDraft(original,changed),original.replace('三年服务','四年服务').replace('五年维护','六年维护'));
});

test('Markdown含出处的业务单元格保留正文与格式，同时显示依据入口',async()=>{
 const result=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MarkdownDocument} from './src/components/MarkdownDocument';export const render=(content,registry)=>renderToStaticMarkup(React.createElement(MarkdownDocument,{content,registry,onEvidence:()=>{}}));",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'});
 const filename=process.cwd()+'/tests/render.cjs';const compiled=new Module(filename);compiled._compile(result.outputFiles[0].text,filename);
 const html=compiled.exports.render('| 内容 |\n|---|\n| **三年服务**，招标文件.docx L10-L20，REQ-01 |');
 assert.match(html,/<strong>三年服务<\/strong>/);assert.match(html,/招标文件.docx/);assert.match(html,/查看依据/);assert.doesNotMatch(html,/REQ-01/);
 const guide='| 节 | 模式 | **依据** | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 投标函 | 格式跟随 | MAND-01、`TPL-01` | — | 按原件填写 |\n| 方案 | 推理撰写 | REQ-999 | 【缺】 | 待补底稿 |\n| 目录 | — | — | — | 自动合册 |';
 const resolved=compiled.exports.render(guide,{'MAND-01':{text:'投标函',出处:'主文件.docx 附件1（L550）'},'TPL-01':{text:'投标函格式',出处:'主文件.docx 附件1（L550-L575）'}});
 assert.match(resolved,/投标函格式/);assert.match(resolved,/主文件.docx 附件1（L550-L575）/);
 assert.equal((resolved.match(/>查看依据(?: \d+)?<\/button>/g)??[]).length,2);
 assert.match(resolved,/依据未关联，请核对文档来源/);
 assert.doesNotMatch(resolved,/(MAND|TPL|REQ)-\d|<td>、<\/td>/);
 assert.match(resolved,/<td>【缺】<\/td>/);assert.match(resolved,/<td>—<\/td>/);
 const withoutRegistry=compiled.exports.render(guide);
 assert.match(withoutRegistry,/依据未关联/);assert.doesNotMatch(withoutRegistry,/<td>、<\/td>/);
});

test('写作指引编辑保护完整依据单元格，不把顿号当可编辑内容',()=>{
 const guide='| 节 | 依据 | 素材 | 备注 |\n|---|---|---|---|\n| 投标函 | MAND-01、TPL-01 | — | 按原件填写 |\n';
 const fields=draft.businessDraft(guide);
 assert.ok(fields.every(f=>!f.label.endsWith('依据')&&f.value!=='、'));
 const changed=fields.map(f=>({...f,value:f.value.replace('按原件填写','按原件核对并填写')}));
 assert.equal(draft.joinBusinessDraft(guide,changed),guide.replace('按原件填写','按原件核对并填写'));
});

test('灵燕真实出处表头与同文件章节定位不开放编辑',()=>{
 const original='| 需求（原文 verbatim 片段） | 出处（章/节/附件编号） |\n|---|---|\n| 三年服务 | 同文件 2.1（L229-L230） |\n';
 const fields=draft.businessDraft(original);assert.deepEqual(fields.map(f=>f.value),['三年服务']);
 assert.equal(draft.joinBusinessDraft(original,fields.map(f=>({...f,value:'四年服务'}))),original.replace('三年服务','四年服务'));
});
test('降级不会把已有子树推到第五层以外',()=>{
 const docs=[{directory:[{_id:'p',目录名称:'父',level:3,children:[{_id:'a',目录名称:'前章',level:4,children:[]},{_id:'b',目录名称:'当前',level:4,children:[{_id:'c',目录名称:'子章',level:5,children:[]}]}]}]}];
 const before=structuredClone(docs);assert.equal(directory.canDemote(docs,'b'),false);assert.equal(directory.demote(docs,'b'),false);assert.deepEqual(docs,before);
});


test('目录排序与跨父级移动保持子树数据，拒绝后代、跨册和超过五层的目标',()=>{
 const docs=[{directory:[{_id:'a',目录名称:'甲',level:1,children:[{_id:'b',目录名称:'乙',level:2,children:[],来源:['REQ-01']}]},{_id:'c',目录名称:'丙',level:1,children:[]},{_id:'d',目录名称:'丁',level:1,children:[]}]},{directory:[{_id:'other',目录名称:'另册',level:1,children:[]}]}];
 assert.equal(directory.moveTo(docs,'a','b'),false);assert.equal(directory.moveTo(docs,'b','other'),false);
 assert.ok(directory.moveSibling(docs,'d','top'));assert.deepEqual(docs[0].directory.map(n=>n._id),['d','a','c']);
 assert.ok(directory.moveSibling(docs,'d','bottom'));assert.ok(directory.moveSibling(docs,'d','up'));assert.ok(directory.moveSibling(docs,'d','down'));assert.deepEqual(docs[0].directory.map(n=>n._id),['a','c','d']);
 assert.ok(directory.moveTo(docs,'b','c'));assert.equal(docs[0].directory[0].children.length,0);assert.deepEqual(docs[0].directory[1].children[0].来源,['REQ-01']);
 assert.ok(directory.moveTo(docs,'b',null));assert.equal(docs[0].directory.at(-1).level,1);
 docs[0].directory[1].level=5;assert.equal(directory.moveTo(docs,'b','c'),false);
});
