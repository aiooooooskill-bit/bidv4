import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeWorkPath} from '../server/native/work-paths.mjs';

const cases=JSON.parse(await readFile(new URL('./fixtures/work-paths.json',import.meta.url),'utf8'));
test('工作路径统一 macOS/Windows 分隔符和相对别名',()=>{
 for(const [path,expected] of cases.accepted)assert.equal(normalizeWorkPath(path),expected,path);
});
test('工作路径拒绝绝对路径、盘符、UNC 和越界',()=>{
 for(const path of cases.rejected)assert.throws(()=>normalizeWorkPath(path),/路径越界/,path);
});
