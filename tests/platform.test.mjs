import test from 'node:test';
import assert from 'node:assert/strict';
import {pythonExecutable} from '../server/platform.mjs';
import {probePython} from '../server/installation.mjs';
import {fileURLToPath} from 'node:url';

test('Windows 带空格和中文的安装目录使用原生 Python exe 路径',()=>{
 assert.equal(pythonExecutable('C:\\Users\\同事\\My Plugins\\投标','win32'),'C:\\Users\\同事\\My Plugins\\投标\\business\\python\\.venv\\Scripts\\python.exe');
 assert.equal(pythonExecutable('/Applications/插件 Space','darwin'),'/Applications/插件 Space/business/python/.venv/bin/python');
});
test('安装自检实际加载 Python 及跨平台文件锁依赖',async()=>{
 const result=await probePython(fileURLToPath(new URL('..',import.meta.url)));
 assert.match(result.version,/^3\./);
});
