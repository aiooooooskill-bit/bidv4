import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {request,json,validateUpload,type Task,type Stage} from '../api';
import {reportError,clearNotice} from '../components/NoticeCenter';
import {ArchiveProjectDialog} from '../components/ArchiveProjectDialog';
import {UploadDrop} from '../components/UploadDrop';
import {ExternalReviewUpload} from '../components/ExternalReviewUpload';
import {reviewLabels} from '../components/ReviewWorkspace';
export type ListMode='analysis'|'build'|'review';
type UploadAttempt={file:File;requestId:string;task?:Task};
// Notice actions survive page changes; deliver retries to the mounted list.
let retryUpload:((attempt:UploadAttempt)=>Promise<void>)|undefined;
const stages:Record<Stage,string>={new:'待解读',parsed:'已解析',analyzed:'已有解读',outlined:'已有目录',drafting:'编写中',delivered:'已合册'};
const filters={analysis:[['unread','未解读'],['analyzed','已有解读'],['all','总数']],build:[['unread','未解读'],['ready','待制作'],['outlined','制作中'],['delivered','已合册'],['all','总数']],review:[['pending','待审核'],['reviewed','已审核'],['all','总数']]} as const;
function matches(stage:Stage,key:string){if(key==='all')return true;if(key==='unread')return ['new','parsed'].includes(stage);if(key==='ready')return stage==='analyzed';if(key==='analyzed')return ['analyzed','outlined','drafting','delivered'].includes(stage);if(key==='outlined')return ['outlined','drafting'].includes(stage);return stage===key}
function taskMatches(task:Task,key:string){return key==='pending'?task.review_status!=='reviewed':key==='reviewed'?task.review_status==='reviewed':matches(task.stage,key)}
export function TenderList({mode,onOpen}:{mode:ListMode;onOpen:(id:string,target:ListMode)=>void}){
 const [tasks,setTasks]=useState<Task[]>([]),[filter,setFilter]=useState('all'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(true),[remove,setRemove]=useState<Task|null>(null);const active=useRef(true),sequence=useRef(0),lock=useRef(false),uploadAttempt=useRef<UploadAttempt|null>(null);
 const load=useCallback(async()=>{const seq=++sequence.current;setLoading(true);try{const result=await request<{tasks:Task[]}>('/tasks');if(!active.current||seq!==sequence.current)return;setTasks(result.tasks);setLoaded(true);clearNotice('task-list')}catch(e){if(active.current&&seq===sequence.current)reportError(e,{id:'task-list',scope:'list',title:'项目列表读取未完成'})}finally{if(active.current&&seq===sequence.current)setLoading(false)}},[]);
 useEffect(()=>{active.current=true;void load();return()=>{active.current=false;sequence.current++}},[load]);
 const filtered=useMemo(()=>tasks.filter(t=>taskMatches(t,filter)),[tasks,filter]);const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 useEffect(()=>setPage(1),[filter,pageSize,mode]);useEffect(()=>{setPage(p=>Math.min(p,totalPages))},[totalPages]);
 const upload=async(file:File,originalAttempt?:UploadAttempt)=>{
  if(lock.current)return;lock.current=true;setBusy(true);
  let attempt=originalAttempt??uploadAttempt.current,valid=false;
  try{
   validateUpload(file);valid=true;
   if(!attempt||attempt.file.name!==file.name||attempt.file.size!==file.size||attempt.file.lastModified!==file.lastModified)attempt={file,requestId:crypto.randomUUID()};
   uploadAttempt.current=attempt;
   const noticeId='upload:'+attempt.requestId;
   if(!attempt.task){
    const {tasks}=await request<{tasks:Task[]}>('/tasks');
    attempt.task=tasks.find(t=>t.id==='t_'+attempt!.requestId.replaceAll('-',''));
    if(!attempt.task)attempt.task=(await request<{task:Task}>('/tasks',json('POST',{title:file.name.replace(/\.[^.]+$/,''),request_id:attempt.requestId}))).task;
   }
   const task=attempt.task;
   const {files}=await request<{files:Array<{name:string;size:number}>}>(`/files?task_id=${encodeURIComponent(task.id)}`);
   let present=false;
   if(files.some(f=>f.name===file.name&&f.size===file.size)){
    const response=await fetch(`/api/bidv4/files/${encodeURIComponent(file.name)}/raw?task_id=${encodeURIComponent(task.id)}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`上传结果读取未完成（HTTP ${response.status}）`);
    const [local,remote]=await Promise.all([crypto.subtle.digest('SHA-256',await file.arrayBuffer()),crypto.subtle.digest('SHA-256',await response.arrayBuffer())]);
    present=new Uint8Array(local).every((v,i)=>v===new Uint8Array(remote)[i]);
   }
   if(!present){const data=new FormData();data.append('file',file);await request(`/files?task_id=${encodeURIComponent(task.id)}`,{method:'POST',body:data})}
   clearNotice(noticeId);uploadAttempt.current=null;await load();if(active.current)onOpen(task.id,mode);
  }catch(e){reportError(e,{id:valid&&attempt?'upload:'+attempt.requestId:'upload-validation',scope:'list',title:file.name+'上传未完成',retry:valid&&attempt?()=>retryUpload?.(attempt!):undefined,retryLabel:'重新上传'});await load()}
  finally{lock.current=false;setBusy(false)}
 };
 useEffect(()=>{const retry=(attempt:UploadAttempt)=>upload(attempt.file,attempt);retryUpload=retry;return()=>{if(retryUpload===retry)retryUpload=undefined}},[upload]);
 const archive=async()=>{if(!remove||busy)return;setBusy(true);try{await request(`/tasks/${remove.id}`,{method:'DELETE'});setRemove(null);await load();clearNotice('archive')}catch(e){reportError(e,{id:'archive',scope:'list',title:'项目归档未完成'})}finally{setBusy(false)}};
 return <div className="bp-list" data-mode={mode}><>{mode==='review'?<ExternalReviewUpload onOpen={id=>onOpen(id,'review')}/>:<div className="bp-upload"><div className="bp-upload-title">上传招标文件</div><div className="bp-muted">上传后进入项目工作台，选择来源文件并发起智能解读。原件可直接查看。</div><UploadDrop busy={busy} onPick={upload}/></div>}</><div className="bp-stats" data-mode={mode}>{filters[mode].map(([key,label])=><button className="bp-stat" key={key} data-active={filter===key} onClick={()=>setFilter(filter===key?'all':key)}><span className="bp-stat-label">{label}</span><span className="bp-stat-num">{loaded?tasks.filter(t=>taskMatches(t,key)).length:'—'}</span><span className="bp-stat-hint">采购项目</span></button>)}</div><div className="bp-section-title">采购项目</div>{!loaded?<div className="bp-empty">{loading?'正在读取项目…':'项目列表读取未完成。'}</div>:!tasks.length?<div className="bp-empty">还没有招标文件，先上传一份。</div>:!filtered.length?<div className="bp-empty">该状态下没有项目。</div>:<div className="bp-projects">{filtered.slice((page-1)*pageSize,page*pageSize).map(task=><article className="bp-project-tile" key={task.id} data-mode={mode}><div className="bp-tile-head"><span className="bp-badge">{task.review_mode==='external'?'外部文件':'平台项目'}</span></div><button className="bp-tile-title" onClick={()=>onOpen(task.id,mode)}>{task.title}</button><div className="bp-tile-chips">{mode!=='review'||task.review_mode!=='external'?<span className="bp-badge">{stages[task.stage]}</span>:null}{mode==='review'?<span className="bp-badge" data-tone={task.review_status==='reviewed'?'success':task.review_status==='running'?'processing':'pending'}>{reviewLabels[task.review_status??'unreviewed']}</span>:null}</div><div className="bp-tile-meta">{new Date(task.last_activity_at??task.created_at).toLocaleString('zh-CN')}</div><div className="bp-tile-acts"><button className="bp-btn" onClick={()=>onOpen(task.id,'analysis')}>查看解读</button>{mode!=='analysis'?<button className="bp-btn" data-kind="primary" onClick={()=>onOpen(task.id,mode)}>查看{mode==='review'?'审查':'标书'}</button>:null}<button className="bp-btn" onClick={()=>setRemove(task)}>归档</button></div></article>)}</div>}{filtered.length?<div className="bp-pager"><span>共{filtered.length}份</span><select aria-label="每页项目数" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>{[10,20,30].map(n=><option value={n} key={n}>{n}/页</option>)}</select><button className="bp-btn" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page}/{totalPages}</span><button className="bp-btn" disabled={page>=totalPages} onClick={()=>setPage(p=>p+1)}>下一页</button></div>:null}{remove?<ArchiveProjectDialog key={remove.id} title={remove.title} busy={busy} onClose={()=>setRemove(null)} onConfirm={()=>void archive()}/>:null}</div>
}
