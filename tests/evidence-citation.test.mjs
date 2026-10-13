import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceCitationSpans,evidenceSourceNames,locateEvidenceReference,resolveEvidenceCitation} from '../shared/evidence-citation.js';

const sources=['甲项目 招标文件（定稿）.docx','补充答疑（第二次）.pdf','附件.docx'];
const work=sources.map(name=>({path:`parse/${name}/${name}.md`}));
const resolve=(text,prior=null,names=sources)=>resolveEvidenceCitation(text,prior,names);

test('同表同列继承实际文件锚，文件名包含空格和中文括号',()=>{
 const first=resolve(`${sources[0]} 第一章（L10-L12）`);
 const next=resolve('同文件 2.1（L229-L230）',first.source);
 assert.equal(next.source,sources[0]);
 assert.deepEqual(next.references.map(({source,start,end})=>({source,start,end})),[{source:sources[0],start:229,end:230}]);
 assert.deepEqual(locateEvidenceReference(next.references[0].citation,work),{...next.references[0],path:work[0].path});
});

test('同一格全部斜线段、多个范围分别定位，后续行使用最后明确来源',()=>{
 const cell=resolve(`${sources[0]}（L10-L12、L15）/ 第三章（L20-L25）/ ${sources[1]}（L40）/ 同文件（L50-L52）`);
 assert.deepEqual(cell.references.map(({source,start,end})=>[source,start,end]),[[sources[0],10,12],[sources[0],15,15],[sources[0],20,25],[sources[1],40,40],[sources[1],50,52]]);
 assert.equal(cell.source,sources[1]);
 for(const reference of cell.references)assert.equal(locateEvidenceReference(reference.citation,work).source,reference.source);
 assert.equal(resolve('同文件（L88）',cell.source).references[0].source,sources[1]);
});

test('分号段独立起锚，文件名锚即使没有行号也可被同文件明确继承',()=>{
 const cell=resolve(`${sources[0]}（L10）；${sources[1]}；同文件 2.1（L20-L21）; L99`);
 assert.deepEqual(cell.references.map(({source,start})=>[source,start]),[[sources[0],10],[sources[1],20],[null,99]]);
 assert.equal(cell.source,null);
 const named=resolve(`${sources[0]}（L10）；${sources[1]}`);
 const next=resolve('同文件（L42）',named.source);assert.equal(next.references[0].source,sources[1]);
});

test('括号内分号注释不截断锚，文件名本身的括号与分号不参与分段',()=>{
 const name='服务（甲；乙） 合同.pdf';
 const result=resolve(`${name} 2.1（L52；后果见同文件 须知20.1（L210））`,null,[name]);
 assert.deepEqual(result.references.map(({source,start})=>[source,start]),[[name,52],[name,210]]);
});

test('孤立同文件、孤立行号即使只有一个来源也不能猜来源',()=>{
 const one=[work[0]];
 for(const text of ['同文件 2.1（L229-L230）','原件 L550-L575','L10']){
  assert.equal(resolve(text).references[0].source,null);
  if(text.startsWith('同文件'))assert.ok(resolve(text).references[0].citation.includes('同文件 2.1'));
  assert.throws(()=>locateEvidenceReference(text,one),/未明确/);
 }
 assert.equal(resolve('L10',sources[0]).references[0].source,null);
 assert.equal(resolve('原件 L10',sources[0]).source,null);
});

test('未知来源阻断旧锚，多个文件共同指向一个范围时拒绝歧义',()=>{
 const unknown=resolve(`${sources[0]}（L1）/ 未确认材料.pdf（L2）/ 同文件（L3）`);
 assert.deepEqual(unknown.references.map(({source})=>source),[sources[0],null,null]);
 assert.equal(unknown.source,null);
 const ambiguous=resolve(`${sources[0]}、${sources[1]}（L10）`);
 assert.equal(ambiguous.references[0].source,null);
 assert.throws(()=>locateEvidenceReference(ambiguous.references[0].citation,work),/未明确/);
});

test('工作树来源整名精确匹配，短名不能命中另一个文件的后缀',()=>{
 const names=['项目.docx','旧项目.docx'];
 const data=names.map(name=>({path:`parse/${name}/source.md`}));
 assert.equal(resolve('旧项目.docx（L1）',null,names).references[0].source,names[1]);
 assert.equal(resolve('旧项目.docx（L1）',null,[names[0]]).references[0].source,null);
 assert.equal(locateEvidenceReference('项目.docx（L2）',data).path,data[0].path);
});

test('来源目录只取真正的顶层Markdown解析稿；重复解析稿及多范围拒绝首项误读',()=>{
 const extra=[...work,{path:'parse/sources.md'},{path:'analysis/requirements.md'},{path:`parse/${sources[0]}/images/readme.md`}];
 assert.deepEqual(evidenceSourceNames(extra),sources);
 assert.throws(()=>locateEvidenceReference(`${sources[0]} L1、L5`,work),/多个/);
 assert.throws(()=>locateEvidenceReference(`${sources[0]} L1`,[...work,{path:`parse/${sources[0]}/another.md`}]),/不唯一/);
});

test('行号支持不同分隔写法并拒绝倒序/零行，章节小数不被误认成行号',()=>{
 const result=resolve(`${sources[0]} 须知15.1-L15.3（L177-L179）/ L200–205 / L210至L212 / L230~L231`);
 assert.deepEqual(result.references.map(({start,end})=>[start,end]),[[177,179],[200,205],[210,212],[230,231]]);
 for(const lines of ['L0','L12-L10'])assert.throws(()=>locateEvidenceReference(`${sources[0]} ${lines}`,work),/无效/);
 assert.throws(()=>locateEvidenceReference(`${sources[0]} 2.1`,work),/没有/);
});

test('混合业务依据保护空格括号文件名及完整定位线索，前后业务文字可编辑',()=>{
 const source='采购 文件（新版）.pdf';
 const text=`原文要求，${source} 第一节（L10-L12），按此响应 REQ-1。`;
 const spans=evidenceCitationSpans(text,[source]);
 assert.deepEqual(spans.map(({start,end})=>text.slice(start,end)),[`${source} 第一节（L10-L12）`]);
 assert.equal(text.slice(0,spans[0].start),'原文要求，');
 assert.equal(text.slice(spans[0].end),'，按此响应 REQ-1。');
});

test('出处span覆盖多个契约段与范围，同时保留分号后的业务说明',()=>{
 const text=`业务前缀，${sources[0]} 第一章（L10-L12、L15）/ 第三章（L20-L25）；同文件 2.1（L40）; 业务后缀`;
 const spans=evidenceCitationSpans(text,sources);
 assert.deepEqual(spans.map(({start,end})=>text.slice(start,end)),[`${sources[0]} 第一章（L10-L12、L15）/ 第三章（L20-L25）；同文件 2.1（L40）`]);
 assert.equal(text.slice(spans[0].end),'; 业务后缀');
});

test('引用之后无新锚的业务行文不会被前一文件名span吞并',()=>{
 const text=`${sources[0]}（L10），支持五年服务；补充说明 L20。`;
 const spans=evidenceCitationSpans(text,sources);
 assert.deepEqual(spans.map(({start,end})=>text.slice(start,end)),[`${sources[0]}（L10）`,'L20']);
});

test('独立文件名锚和孤立同文件关联受保护，孤立L只保护行号本身',()=>{
 for(const text of [sources[0],'同文件 第三节（L10-L20）'])assert.deepEqual(evidenceCitationSpans(text,sources),[{start:0,end:text.length}]);
 const text='正文应答 L10，并说明原因';
 assert.deepEqual(evidenceCitationSpans(text,sources).map(({start,end})=>text.slice(start,end)),['L10']);
});
