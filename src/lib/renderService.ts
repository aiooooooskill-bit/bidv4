import {BASE,request} from '../api';
import {clearNotice,reportError} from '../components/NoticeCenter';

export type PendingRender={request_id:string;task_id:string}&({kind:'html';html:string}|{kind:'flow';mermaid:string});
const rendererUrl=BASE+'/assets/renderer/figureRenderer.js';
let renderer:Promise<typeof import('./figureRenderer')>|undefined;
let loadAttempt=0;
async function loadRenderer(){
 if(!renderer){
  const url=loadAttempt++?rendererUrl+'?retry='+loadAttempt:rendererUrl;
  renderer=import(url).catch(error=>{renderer=undefined;throw error});
 }
 return renderer;
}

async function postFigure(requestId:string,png:Blob|null,signal:AbortSignal){
 const form=new FormData();form.append('request_id',requestId);
 if(png)form.append('file',png,'figure.png');
 const response=await fetch(BASE+'/render/figure',{method:'POST',body:form,signal});
 if(!response.ok&&response.status!==404)throw new Error(`文档插图回执未完成（HTTP ${response.status}）`);
}

// Keep one sequential consumer for the plugin lifetime, including when its overlay is closed.
export function startRenderService(){
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const poll=async()=>{
  try{
   const {requests}=await request<{requests:PendingRender[]}>('/render/pending',{signal:controller.signal});
   for(const pending of requests){
    if(controller.signal.aborted)break;
    let png:Blob|null=null;
    try{
     const lib=await loadRenderer();
     png=pending.kind==='flow'?await lib.renderMermaidToPng(pending.mermaid):await lib.renderHtmlToPng(pending.html);
    }catch(error){
     if(!controller.signal.aborted)reportError(error,{id:'figure:'+pending.request_id,scope:pending.task_id,title:'文档插图未完成',message:'本次图示未能生成，可调整本章要求后重新生成。'});
    }
    if(!controller.signal.aborted)await postFigure(pending.request_id,png,controller.signal);
   }
   clearNotice('figure-service');
  }catch(error){if(!controller.signal.aborted)reportError(error,{id:'figure-service',title:'文档渲染服务读取未完成'})}
  finally{if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),3000)}
 };
 void poll();
 return()=>{controller.abort();clearTimeout(timer)};
}
