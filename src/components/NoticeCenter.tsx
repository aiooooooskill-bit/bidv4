import {useState,useSyncExternalStore,type ReactNode} from 'react';
import {Modal} from './Modal';
import {businessText} from './MarkdownDocument';
import {ApiError,type Flow,type Execution} from '../api';
import {actionSatisfied,actionNames,deliveryReady} from '../../shared/delivery-status.js';

type Submission=Pick<Execution,'kind'|'sections'|'created_at'>;
export type TaskNotice={id:string;scope:string;kind:'error';title:string;message:string;detail?:string;body?:ReactNode;execution?:Execution;submission?:Submission;action?:{label:string;run:()=>void|Promise<void>}};
let items:TaskNotice[]=[];
let activeScope='analysis';
let drawer=false;
let toast:TaskNotice|null=null;
const listeners=new Set<()=>void>();
let snapshot:{items:TaskNotice[];drawer:boolean;toast:TaskNotice|null;activeScope:string}={items,drawer,toast,activeScope};
const emit=()=>{snapshot={items,drawer,toast,activeScope};listeners.forEach(f=>f());};
const subscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};};
export const useTaskNotices=()=>useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot);
export function setNoticeScope(scope:string){activeScope=scope;toast=null;emit();}
export function putNotice(n:TaskNotice,showToast=false){
  const existing=items.find(i=>i.id===n.id);
  items=[...items.filter(i=>i.id!==n.id),n];
  if(showToast&&(!existing||existing.message!==n.message))toast=n;
  emit();
}
export function clearNotice(id:string){items=items.filter(n=>n.id!==id);if(toast?.id===id)toast=null;emit();}
export const executionNoticeId=(tid:string,e:Execution)=>`${tid}:execution:${e.kind}:${e.action_id}`;
export function syncExecutionNotices(tid:string,flow:Flow){
  if(deliveryReady(flow))clearNotice(tid+':export');
  const current=flow.execution;
  for(const notice of [...items]){
    if(notice.scope!==tid)continue;
    const attempt=notice.submission;
    if(attempt){
      const completed=current?.kind===attempt.kind&&current.state==='completed'&&
        Number.isFinite(attempt.created_at)&&(current.created_at??0)>=attempt.created_at!&&
        (!attempt.sections?.length||attempt.sections.every(s=>current.sections?.some(n=>n.volume===s.volume&&n.title===s.title)));
      if(completed||actionSatisfied(flow,attempt))clearNotice(notice.id);
      continue;
    }
    const old=notice.execution;
    if(!old)continue;
    const sameAction=current?.action_id===old.action_id;
    const replaced=current?.kind===old.kind&&current.state==='completed'&&current.action_id!==old.action_id&&
      (!old.sections?.length||old.sections.every(s=>current.sections?.some(n=>n.volume===s.volume&&n.title===s.title)));
    if((sameAction&&(current.resolved||current.state==='completed'))||replaced||actionSatisfied(flow,old))clearNotice(notice.id);
  }
}
export function reportExecution(tid:string,execution:Execution){
  const id=executionNoticeId(tid,execution);
  if(execution.state!=='failed'||execution.resolved){clearNotice(id);return}
  reportError(new Error(execution.error??'本轮执行未完成'),{id,scope:tid,title:(actionNames[execution.kind]??'执行')+'未完成',execution});
}
export function openNoticeCenter(){drawer=true;toast=null;emit();}
export function reportError(value:unknown,options:{id?:string;scope?:string;title?:string;message?:string;retry?:()=>void|Promise<void>;retryLabel?:string;execution?:Execution;submission?:Submission}={}){
  const raw=value instanceof Error?value.message:String(value??'');if(!raw)return;
  const stale=/409|已变化|版本|过期/.test(raw);
  const network=value instanceof ApiError&&[502,503,504].includes(value.status)||/Failed to fetch|fetch failed|NetworkError|502|503/.test(raw);
  const model=/模型|凭证|图片输入|model|provider|credential|api.?key|inputModalities|image input/i.test(raw);
  const message=options.message??(stale?'内容已被更新，本次保存或提交未完成。请读取最新状态后重试。':model?'当前模型调用未完成，请检查 dsh 中的模型配置、凭证及图片输入能力。':network?'暂时无法连接服务，本次操作未完成。可重试当前操作。':/Invalid PDF|PasswordException|password|图片无法解码/i.test(raw)?'原件无法预览，请检查文件是否损坏或需要密码。':/Can't find end of central directory|invalid zip|corrupt/i.test(raw)?'Word文件无法打开，请检查原件是否为有效DOCX。':value instanceof ApiError&&[413,415].includes(value.status)?businessText(raw):value instanceof ApiError&&value.status>=400&&value.status<500&&!/[A-Za-z]{4,}|Traceback|\n/.test(raw)?businessText(raw):'本次操作未完成，已有内容保留。请重试当前操作；若仍失败，可查看详细信息。');
  putNotice({id:options.id??`${options.scope??activeScope}:error:${raw}`,scope:options.scope??activeScope,kind:'error',title:options.title??'操作未完成',message,execution:options.execution,submission:options.submission,detail:message!==raw?businessText(raw).slice(0,8000):undefined,action:options.retry?{label:options.retryLabel??'重新读取',run:options.retry}:undefined},true);
}
export function NoticeButton(){
  const s=useTaskNotices(),count=s.items.filter(n=>n.scope===s.activeScope).length;
  return <button className="bp-btn ly-notice-button" type="button" onClick={openNoticeCenter}>操作提示{count>0?<span className="ly-notice-count">{count}</span>:null}</button>;
}
export function TaskNoticeHost(){
  const s=useTaskNotices(),[busy,setBusy]=useState<string|null>(null);
  const list=s.items.filter(n=>n.scope===s.activeScope);
  const act=async(n:TaskNotice)=>{if(!n.action||busy)return;setBusy(n.id);try{await n.action.run();}catch(e){reportError(e,{scope:n.scope,id:n.id+':action'});}finally{setBusy(null);}};
  const close=()=>{drawer=false;emit();};
  const sections=[['error','操作失败']] as const;
  return <>
    {s.toast?.scope===s.activeScope?<aside className="ly-toast" role="alert"><div><strong>{s.toast.title}</strong><p>{s.toast.message}</p></div><button type="button" className="bp-btn" onClick={openNoticeCenter}>查看详情</button><button type="button" className="ly-icon-btn" aria-label="收起操作提示" onClick={()=>{toast=null;emit();}}>×</button></aside>:null}
    <div className="ly-drawer-root"><Modal open={s.drawer} onClose={close} label="操作提示" priority>
      <header className="ly-drawer-head"><div><small>当前任务</small><h2>操作提示 <span>{list.length}</span></h2></div><button type="button" className="ly-icon-btn" aria-label="关闭操作提示" onClick={close} data-modal-autofocus>×</button></header>
      <div className="ly-drawer-body">
        {!list.length?<p className="ly-empty">当前没有操作失败记录。</p>:sections.map(([kind,title])=>{
          const rows=list.filter(n=>n.kind===kind);return rows.length?<section key={kind}><h3>{title} <span>{rows.length}</span></h3>{rows.map(n=><article className="ly-notice-card" data-kind={n.kind} key={n.id}><strong>{n.title}</strong><p>{n.message}</p>{n.body}{n.detail?<details><summary>详细信息</summary><pre>{n.detail}</pre></details>:null}{n.action?<button className="bp-btn" type="button" disabled={busy!==null} onClick={()=>void act(n)}>{busy===n.id?'处理中…':n.action.label}</button>:null}</article>)}</section>:null;
        })}
      </div>
      <footer className="ly-drawer-foot">此处仅记录未成功的操作，不影响文档阅读。</footer>
    </Modal></div>
  </>;
}
