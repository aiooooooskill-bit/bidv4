import {useRef,useState} from 'react';
import {request,json,validateUpload,type Flow,type Task} from '../api';
import {UploadDrop} from './UploadDrop';
import {reportError,clearNotice} from './NoticeCenter';
export function ExternalReviewUpload({onOpen}:{onOpen:(tid:string)=>void}){
 const [tender,setTender]=useState<File|null>(null),[bid,setBid]=useState<File|null>(null),[busy,setBusy]=useState(false);
 const attempt=useRef<{requestId:string;task?:Task}>(),lock=useRef(false);
 const choose=(kind:'tender'|'bid',file?:File)=>{if(!file)return;try{validateUpload(file,kind==='bid'?'bid':'source');attempt.current=undefined;(kind==='tender'?setTender:setBid)(file);clearNotice('external-review-upload')}catch(e){reportError(e,{id:'external-review-upload',scope:'list',title:'文件选择未完成'})}};
 const submit=async()=>{if(!tender||!bid||lock.current)return;lock.current=true;setBusy(true);try{
  if(tender.name===bid.name)throw new Error('招标和投标文件名称不能相同，请先重命名');
  const a=attempt.current??={requestId:crypto.randomUUID()};
  if(!a.task)a.task=(await request<{task:Task}>('/tasks',json('POST',{title:tender.name.replace(/\.[^.]+$/,''),request_id:a.requestId}))).task;
  for(const [purpose,file] of [['source',tender],['bid',bid]] as const){const form=new FormData();form.append('file',file);await request(`/files?task_id=${a.task.id}&purpose=${purpose}`,{method:'POST',body:form})}
  let flow=await request<Flow>(`/page-flow/${a.task.id}`);
  if(flow.source_selection.main!==tender.name)flow=await request<Flow>(`/page-flow/${a.task.id}/sources`,json('PUT',{main_file:tender.name,supplements:[],input_version:flow.input_versions.analyse}));
  await request(`/page-flow/${a.task.id}/review-input`,json('PUT',{bids:[bid.name],input_version:flow.input_versions.review}));
  clearNotice('external-review-upload');onOpen(a.task.id);
 }catch(e){reportError(e,{id:'external-review-upload',scope:'list',title:'外部文件上传未完成'})}finally{lock.current=false;setBusy(false)}};
 return <div className="bp-upload review-upload"><div className="bp-upload-title">上传外部标书审查</div><div className="bp-muted">选择招标文件与已写好的投标文件。进入项目后发起审核，自动解析文件、整理结构并逐项对照招标要求。</div><div className="review-file-picks">{(['tender','bid'] as const).map(kind=><UploadDrop key={kind} busy={busy} purpose={kind==='bid'?'bid':'source'} label={kind==='tender'?'招标文件':'投标文件'} inputLabel={kind==='tender'?'上传审查招标文件':'上传审查投标文件'} fileName={(kind==='tender'?tender:bid)?.name} onPick={file=>choose(kind,file)}/>)}</div><div className="bp-row"><span className="bp-spacer"/><button className="bp-btn" data-kind="primary" disabled={busy||!tender||!bid} onClick={()=>void submit()}>{busy?'正在上传…':'上传并进入审查'}</button></div></div>;
}
