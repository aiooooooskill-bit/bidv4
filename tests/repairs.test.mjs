import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const compile=async options=>{const r=await build({bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent',...options});const m={exports:{}};new Function('module','exports',r.outputFiles[0].text)(m,m.exports);return m.exports};
const settle=async()=>{for(let n=0;n<60;n++)await Promise.resolve()};
async function rendererFixture({loadFailure=false,postFailure=false}={}){
 const urls=[],timers=[],history=[];let posts=0;
 globalThis.repairLoad=async url=>{urls.push(url);if(loadFailure&&urls.length===1)throw new Error('temporary module failure');return{renderHtmlToPng:async()=>new Blob(['png']),renderMermaidToPng:async()=>new Blob(['png'])}};
 globalThis.repairPending=async()=>({requests:[{request_id:'r'+(postFailure?0:posts),task_id:'t1',kind:'html',html:'<p>example</p>'}]});
 globalThis.repairTimer=fn=>{timers.push(fn);return 1};globalThis.repairClear=()=>{};globalThis.repairHistory=history;
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{posts++;return{ok:!postFailure,status:postFailure?503:200}};
 const module=await compile({stdin:{contents:"export {startRenderService} from './src/lib/renderService';export {useTaskNotices,reportError} from './src/components/NoticeCenter';",resolveDir:process.cwd(),loader:'ts'},define:{setTimeout:'globalThis.repairTimer',clearTimeout:'globalThis.repairClear'},plugins:[{name:'fault-injection',setup(b){
  b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},a=>({path:a.path,namespace:'fake'}));
  b.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:a.path.endsWith('jsx-runtime')?'export const jsx=()=>null;export const jsxs=()=>null;export const Fragment="fragment";':'export const useState=()=>[];export const useSyncExternalStore=(subscribe,get)=>{subscribe(()=>globalThis.repairHistory.push(get()));return get()};',loader:'js'}));
  b.onLoad({filter:/src\/api\.ts$/},()=>({contents:"export const BASE='/api';export const request=globalThis.repairPending;export class ApiError extends Error{}",loader:'ts'}));
  b.onLoad({filter:/MarkdownDocument\.tsx$/},()=>({contents:'export const businessText=x=>x;',loader:'tsx'}));
  b.onLoad({filter:/Modal\.tsx$/},()=>({contents:'export const Modal=()=>null;',loader:'tsx'}));
  b.onLoad({filter:/renderService\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('import(url)','globalThis.repairLoad(url)'),loader:'ts'}));
 }}]});
 module.useTaskNotices();const stop=module.startRenderService();await settle();timers.shift()();await settle();stop();globalThis.fetch=oldFetch;
 return{urls,history,posts,module};
}
test('插图模块首次加载失败后用新URL恢复，后续请求能生成图片',async()=>{
 const f=await rendererFixture({loadFailure:true});assert.equal(f.urls.length,2);assert.notEqual(f.urls[0],f.urls[1]);assert.equal(f.posts,2);assert.deepEqual(f.module.useTaskNotices().items.map(n=>n.id),['figure:r0']);
});
test('插图回执持续503只弹一次提示，未知异常首行不暴露SDK原文',async()=>{
 const f=await rendererFixture({postFailure:true});assert.equal(f.posts,2);assert.equal(f.history.filter((s,i)=>s.toast&&!f.history[i-1]?.toast).length,1);
 f.module.reportError(new Error('TypeError: Cannot read properties of undefined'),{id:'sdk'});const n=f.module.useTaskNotices().items.find(n=>n.id==='sdk');assert.ok(!n.message.includes('TypeError'));assert.ok(n.detail.includes('TypeError'));
});
