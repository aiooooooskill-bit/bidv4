import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:['src/lib/projectUpdates.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {startProjectUpdates}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('逐字流与内部投影更新不触发项目请求，真实执行和目录变化仍通知',()=>{
 let value={phase:'ready',ids:['a'],byId:{a:{running:true,updatedAt:1,retainedBy:{mainView:1},projectionValues:{}}}},listener,count=0;
 const off=startProjectUpdates({getSnapshot:()=>value,subscribe:fn=>{listener=fn;return()=>listener=undefined}},()=>count++);
 for(let i=0;i<500;i++){value={...value,byId:{a:{...value.byId.a,projectionValues:{tokens:i},retainedBy:{mainView:i}}}};listener()}
 assert.equal(count,0,'500次原生流更新不能产生业务请求风暴');
 value.byId.a.running=false;listener();assert.equal(count,1,'结束时刷新最终成果');listener();assert.equal(count,1);
 value.byId.a.updatedAt=2;listener();assert.equal(count,2,'原生对话新活动仍刷新');
 value={...value,ids:['a','b'],byId:{...value.byId,b:{running:true,updatedAt:3}}};listener();assert.equal(count,3,'新项目会话仍刷新');
 value={...value,ids:['b']};listener();assert.equal(count,4,'移除会话仍刷新');off();assert.equal(listener,undefined);
});
