import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../src/lib/businessLinks.ts',import.meta.url),'utf8');
const compiled=await transform(source,{loader:'ts',format:'cjs',target:'es2022'});

// Model the browser's capture/bubble boundary with native cancelable Events.
// The later host listener is the documented MarkdownAnchor behavior: it
// prevents ordinary link navigation and delegates HTTP links to the Sidebar.
function browser(){
 const origin='http://127.0.0.1:47831',listeners=new Set(),module={exports:{}};
 class Element{
  constructor(parent){this.parent=parent}
  closest(){return this instanceof Anchor?this:this.parent?.closest()??null}
 }
 class Anchor extends Element{
  constructor(href,{target='_blank',download=''}={}){super();this.href=href.startsWith('/')?origin+href:href;this.target=target;this.download=download}
 }
 const document={addEventListener(type,listener,capture){assert.equal(type,'click');assert.equal(capture,true);listeners.add(listener)},removeEventListener(type,listener,capture){assert.equal(type,'click');assert.equal(capture,true);listeners.delete(listener)}};
 runInNewContext(compiled.code,{module,exports:module.exports,document,window:{location:{origin}},Element,HTMLAnchorElement:Anchor,URL});
 const click=(target,overrides={})=>{
  const event=new Event('click',{bubbles:true,cancelable:true});
  Object.defineProperties(event,Object.fromEntries(Object.entries({target,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...overrides}).map(([key,value])=>[key,{value}])));
  for(const listener of listeners)listener(event);
  let hostOpened=false;
  if(!event.cancelBubble&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){hostOpened=true;event.preventDefault()}
  return {event,hostOpened,nativeNavigation:!event.defaultPrevented};
 };
 return {origin,Anchor,Element,listeners,start:module.exports.startBusinessLinks,click};
}

test('业务整册与MD链接保留原生打开和下载，绕过宿主同源嵌入浏览器',()=>{
 const b=browser(),dispose=b.start();
 try{
  for(const path of ['/api/bidv4/artifacts/artifact-123/file','/api/bidv4/workbench/raw?task_id=t1&path=body/test.docx','/api/bidv4/workbench/content?task_id=t1&path=analysis%2F%E8%AF%84%E5%88%86.md']){
   const anchor=new b.Anchor(path,{target:'_blank',download:'技术标.docx'}),before={href:anchor.href,target:anchor.target,download:anchor.download};
   const result=b.click(new b.Element(anchor));
   assert.equal(result.hostOpened,false);assert.equal(result.event.cancelBubble,true);assert.equal(result.nativeNavigation,true);
   assert.deepEqual({href:anchor.href,target:anchor.target,download:anchor.download},before,'href, target and download retain browser defaults');
  }
 }finally{dispose()}
});

test('其他业务路由、普通外链、异源同路径及非链接点击保留宿主行为',()=>{
 const b=browser(),dispose=b.start();
 try{
  for(const href of ['/api/bidv4/tasks','/api/bidv4/artifacts/a1/content','/api/bidv4/artifacts/a1/file/extra','/api/bidv4/workbench/content-extra','https://example.test/api/bidv4/artifacts/a1/file','https://example.test/document']){
   const result=b.click(new b.Anchor(href));assert.equal(result.event.cancelBubble,false,href);assert.equal(result.hostOpened,true,href);
  }
  for(const target of [new b.Element(),null,{}])assert.equal(b.click(target).event.cancelBubble,false);
 }finally{dispose()}
});

test('中键与修饰键业务点击维持浏览器特殊打开语义',()=>{
 const b=browser(),dispose=b.start();
 try{
  for(const overrides of [{button:1},{button:2},{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true}]){
   const result=b.click(new b.Anchor('/api/bidv4/artifacts/a1/file'),overrides);
   assert.equal(result.event.cancelBubble,false);assert.equal(result.nativeNavigation,true);assert.equal(result.hostOpened,false);
  }
 }finally{dispose()}
});

test('卸载恢复宿主导航，重新挂载只注册一次本插件处理',()=>{
 const b=browser(),anchor=new b.Anchor('/api/bidv4/artifacts/a1/file');
 assert.equal(b.click(anchor).hostOpened,true);
 const dispose=b.start();assert.equal(b.listeners.size,1);assert.equal(b.click(anchor).nativeNavigation,true);
 dispose();dispose();assert.equal(b.listeners.size,0);assert.equal(b.click(anchor).hostOpened,true);
 const reloaded=b.start();try{assert.equal(b.listeners.size,1);assert.equal(b.click(anchor).nativeNavigation,true)}finally{reloaded()}
 assert.equal(b.listeners.size,0);
});

test('无效URL不使全局捕获监听抛错或拦截其他链接',()=>{
 const b=browser(),dispose=b.start();
 try{for(const href of ['http://[','https://','http://%']){const result=b.click(new b.Anchor(href));assert.equal(result.event.cancelBubble,false)}}finally{dispose()}
});
