import {useEffect,useState} from 'react';
import {request,json,type Task} from '../api';
import {useNavigationGuard} from './NavigationGuard';
export function ProjectTitle({task,onOpen,onChanged,disabled=false}:{task:Task;onOpen:()=>void;onChanged:()=>Promise<void>;disabled?:boolean}){
 const [editing,setEditing]=useState(false),[title,setTitle]=useState(task.title),[previousTitle,setPreviousTitle]=useState(task.title),[busy,setBusy]=useState(false),[error,setError]=useState(''),guard=useNavigationGuard();
 const dirty=editing&&title!==task.title;
 useEffect(()=>{guard.mark('project-name:'+task.id,dirty);return()=>guard.mark('project-name:'+task.id,false)},[guard.mark,task.id,dirty]);
 const cancel=()=>{if(busy)return;setTitle(task.title);setEditing(false);setError('');guard.mark('project-name:'+task.id,false)};
 const save=async()=>{if(busy||!title.trim())return;setBusy(true);setError('');try{await request(`/tasks/${task.id}`,json('PATCH',{title:title.trim(),previous_title:previousTitle}));guard.mark('project-name:'+task.id,false);setEditing(false);await onChanged();window.dispatchEvent(new Event('ooo-bidpliot:changed'))}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 return <div className="project-title-editor">{editing?<><input autoFocus aria-label="项目名称" value={title} disabled={busy} maxLength={200} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();void save()}else if(e.key==='Escape'){e.preventDefault();cancel()}}}/><div className="project-title-actions"><button className="bp-btn" data-kind="primary" disabled={busy||!title.trim()} onClick={()=>void save()}>{busy?'保存中…':'保存'}</button><button className="bp-btn" disabled={busy} onClick={cancel}>取消</button></div>{error?<p role="alert">{error}</p>:null}</>:<><button className="bp-tile-title" onClick={onOpen}>{task.title}</button><button className="project-title-edit" aria-label={'编辑项目名称：'+task.title} disabled={disabled} onClick={()=>{setTitle(task.title);setPreviousTitle(task.title);setError('');setEditing(true)}}>✎</button></>}</div>
}
