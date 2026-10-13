import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMarkdown,markdownText} from '../shared/markdown.js';
import {jsonResponse} from '../server/native/markdown.mjs';

const cases=JSON.parse(await readFile(new URL('./fixtures/markdown-contract.json',import.meta.url),'utf8'));
for(const sample of cases)test('跨端 Markdown 契约：'+sample.name,()=>{
 const tree=parseMarkdown(sample.content);
 assert.deepEqual(tree.children.filter(n=>n.type==='heading').map(n=>[n.position.start.line,n.depth,markdownText(n)]),sample.headings);
 const tables=tree.children.filter(n=>n.type==='table').map(n=>{
  const header=n.children[0].children.map(markdownText);
  const rows=n.children.slice(1).map(row=>[row.position.start.line,Array.from({length:header.length},(_,i)=>row.children[i]?markdownText(row.children[i]):'')]);
  return [n.position.start.line,header,rows];
 });
 assert.deepEqual(tables,sample.tables);
});

test('资料整理 JSON 代码块采用 AST，支持两种围栏且拒绝混入正文',()=>{
 for(const text of ['{"value":"三年"}','```json\n{"value":"三年"}\n```','~~~~json\n{"value":"三年"}\n~~~~'])assert.deepEqual(jsonResponse(text),{value:'三年'});
 assert.throws(()=>jsonResponse('说明\n\n```json\n{"value":"三年"}\n```'));
 assert.throws(()=>jsonResponse('```json\n{"value":}\n```'));
});
