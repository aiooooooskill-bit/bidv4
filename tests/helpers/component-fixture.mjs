import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';

export async function fixture(fetcher,{realMaterialBlocks=false}={}){
 const previous={XMLHttpRequest:globalThis.XMLHttpRequest,fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document,hooks:globalThis.workflowHooks};
 let mounted;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 globalThis.XMLHttpRequest=class{upload={};open(method,url){this.method=method;this.url=url}send(body){this.upload.onprogress?.({lengthComputable:true,loaded:1,total:2});this.upload.onload?.();Promise.resolve(fetcher(this.url,{method:this.method,body})).then(async response=>{this.status=response.status;this.response=await response.json();this.onload?.()}).catch(()=>this.onerror?.())}};
 globalThis.fetch=fetcher;globalThis.window=new EventTarget();Object.assign(globalThis.window,{innerHeight:720,innerWidth:1280});globalThis.document=Object.assign(new EventTarget(),{hidden:false});
 globalThis.workflowHooks={
  createContext(value){const context={value};context.Provider=context;return context},
  useContext(context){return context.value},
  useState(value){const h=mounted,i=h.cursor++;h.slots[i]??={value:typeof value==='function'?value():value};return[h.slots[i].value,next=>{const value=typeof next==='function'?next(h.slots[i].value):next;if(!Object.is(value,h.slots[i].value)){h.slots[i].value=value;h.dirty=true}}]},
  useRef(value){const h=mounted,i=h.cursor++;h.slots[i]??={current:value};return h.slots[i]},
  useMemo(fn,deps){const h=mounted,i=h.cursor++;if(!equal(h.slots[i]?.deps,deps))h.slots[i]={value:fn(),deps};return h.slots[i].value},
  useCallback(fn,deps){return this.useMemo(()=>fn,deps)},
  useEffect(fn,deps){const h=mounted,i=h.cursor++;if(!equal(h.slots[i]?.deps,deps)){const old=h.slots[i];h.slots[i]={deps};h.effects.push(()=>{old?.cleanup?.();h.slots[i].cleanup=fn()})}},
  useSyncExternalStore(_subscribe,get){return get()},
 };
 // Export wrappers, since React hook imports are called without a receiver.
 const hooks=globalThis.workflowHooks;hooks.useCallback=(fn,deps)=>hooks.useMemo(()=>fn,deps);
 const result=await build({stdin:{contents:"export {ProjectFiles} from './src/components/ProjectFiles';export {ProjectTitle} from './src/components/ProjectTitle';export {FileActions} from './src/components/library/FileActions';export {Knowledge} from './src/components/library/Knowledge';export {validateUpload,uploadFile} from './src/api';export {CompanyDetail} from './src/components/library/Companies';export {RepresentativeDetail} from './src/components/library/Representatives';export {KnowledgeDetail} from './src/components/library/Knowledge';export {MaterialDetail} from './src/components/library/Materials';export {Templates} from './src/components/library/Templates';export {useNavigationGuard} from './src/components/NavigationGuard';export {NavigationGuard} from './src/components/NavigationGuard';export {WorkflowControls} from './src/components/WorkflowControls';export {ExecutionControls} from './src/components/ExecutionControls';export {ProjectWorkbench} from './src/screens/ProjectWorkbench';export {ReviewWorkspace} from './src/components/ReviewWorkspace';export {BuildWorkspace} from './src/components/BuildWorkspace';export {OutlineOptionsDialog} from './src/components/OutlineOptionsDialog';export {TenderList} from './src/screens/TenderList';export {DirectoryPanel} from './src/components/DirectoryPanel';export {Materials} from './src/components/library/Materials';export {Representatives} from './src/components/library/Representatives';export {MaterialBlocks} from './src/components/MaterialBlocks';export {BidderForm} from './src/components/BidderSetup';export {Upload} from './src/screens/Library';export {Library} from './src/screens/Library';export {useTaskNotices,reportError,reportExecution,syncExecutionNotices} from './src/components/NoticeCenter';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'component-fixtures',setup(b){
  b.onResolve({filter:/^(?:react(?:\/jsx-runtime)?|react-dom)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='react-dom'?'export const createPortal=children=>children;':a.path.endsWith('jsx-runtime')?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";':'export const {createContext,useContext,useState,useRef,useEffect,useMemo,useCallback,useSyncExternalStore}=globalThis.workflowHooks;export const useLayoutEffect=useEffect;',loader:'js'}));
  b.onLoad({filter:/library\/(Companies|Representatives|Knowledge|Materials)\.tsx$/},async a=>{const detail={Companies:'CompanyDetail',Representatives:'RepresentativeDetail',Knowledge:'KnowledgeDetail',Materials:'MaterialDetail'}[a.path.split('/').at(-1).replace('.tsx','')];return {contents:(await readFile(a.path,'utf8'))+'\nexport {'+detail+'};',loader:'tsx'}});
  b.onLoad({filter:/Library\.tsx$/},async a=>({contents:(await readFile(a.path,'utf8'))+'\nexport {'+(a.path.endsWith('Library.tsx')?'Upload':'BidderForm')+'};',loader:'tsx'}));
  b.onLoad({filter:/DocumentEditor\.tsx$/},()=>({contents:'export const DocumentEditor=()=>null;',loader:'tsx'}));
  b.onLoad({filter:/(SourcePreview|MaterialBlocks|MaterialChapterPicker|MarkdownDocument|Modal)\.tsx$/},a=>a.path.endsWith('MaterialBlocks.tsx')&&realMaterialBlocks?undefined:({contents:'export const SourcePreview=()=>null,MaterialChapterPicker=()=>null,MaterialBlocks=()=>null,MarkdownDocument=()=>null,Modal=()=>null;export const businessText=x=>x;',loader:'tsx'}));
 }}]});
 const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
 const api=module.exports;
 const mount=(name,props={})=>{
  const h={cursor:0,slots:[],effects:[],dirty:true,tree:null};
  const render=()=>{let count=0;do{assert.ok(count++<20,'render did not settle');mounted=h;h.cursor=0;h.dirty=false;h.tree=api[name](props);if(name==='NavigationGuard')h.tree.type.value=h.tree.props.value;for(const effect of h.effects.splice(0))effect()}while(h.dirty);return h.tree};
  return{render,async settle(){for(let i=0;i<12;i++){render();await Promise.resolve()}return render()},unmount(){for(const slot of h.slots)slot?.cleanup?.()}};
 };
 return{api,mount,close(){globalThis.XMLHttpRequest=previous.XMLHttpRequest;globalThis.fetch=previous.fetch;globalThis.window=previous.window;globalThis.document=previous.document;globalThis.workflowHooks=previous.hooks}};
}
export const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.open===false?null:node.props?.children)]:[];
export const find=(view,predicate)=>{const node=nodes(view.render()).find(predicate);assert.ok(node,'control not found');return node};
export const response=(value,status=200)=>Response.json(value,{status});
export const questionInput=()=>{const input={answers:{},notes:{}};input.setAnswers=value=>input.answers=typeof value==='function'?value(input.answers):value;input.setNotes=value=>input.notes=typeof value==='function'?value(input.notes):value;return input};

