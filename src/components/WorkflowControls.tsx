import {useState} from 'react';
import {request,json,type Flow} from '../api';
import {reportError,clearNotice} from './NoticeCenter';
import {useNavigationGuard} from './NavigationGuard';
import {Modal} from './Modal';
const labels:Record<string,string>={analyse:'解析与解读',outline:'投标目录',build:'正文制作与合册',review:'标书审核'};
export function WorkflowControls({tid,flow,onChanged}:{tid:string;flow:Flow;onChanged:()=>Promise<void>}){
 const {hasDirty}=useNavigationGuard();
 const [busy,setBusy]=useState(false),[open,setOpen]=useState(false),[includeReview,setIncludeReview]=useState(false),workflow=flow.workflow;
 const active=workflow?.state==='running',waiting=workflow?.state==='needs_input'&&flow.execution?.state==='needs_input',executing=flow.execution?.state==='running';
 const resume=!!workflow&&!['completed','stopped'].includes(workflow.state);
 const submit=async(resume=false,stop=false)=>{if(hasDirty&&!stop)return;setBusy(true);try{await request(`/page-flow/${tid}/workflow`,stop?json('DELETE',{workflow_id:workflow!.id}):json('POST',resume?{resume:true}:{resume:false,include_review:includeReview}));setOpen(false);clearNotice(tid+':workflow');await onChanged()}catch(e){reportError(e,{id:tid+':workflow',scope:tid,title:'自动流程未完成'})}finally{setBusy(false)}};
 const status=workflow?.state==='completed'?'流程已完成':active?'正在'+(labels[workflow.stage??'analyse']??'执行'):workflow?.state==='needs_input'?'等待具体信息':workflow?.state==='stopped'?'流程已停止':workflow?.error;
 return <>{active||waiting?<button className="bp-btn" data-kind="danger" title={status} disabled={busy} onClick={()=>void submit(false,true)}>停止流程</button>:<button className="bp-btn" data-kind="primary" title={hasDirty?'请先保存当前修改，再自动完成流程':status??'自动完成解读、制作目录和制作投标文件，可选择标书审核'} disabled={hasDirty||busy||executing||!flow.source_selection.main} onClick={()=>{if(hasDirty||busy||executing||!flow.source_selection.main)return;if(resume)void submit(true);else{setIncludeReview(false);setOpen(true)}}}>{resume?'继续流程':'自动完成'}</button>}
 <Modal open={open} onClose={()=>{if(!busy)setOpen(false)}} label="自动完成" width="600px">
  <div className="workflow-options">
   <div className="workflow-heading"><h2>自动完成</h2><button className="workflow-close" aria-label="关闭" disabled={busy} onClick={()=>setOpen(false)}>×</button></div>
   <p className="workflow-intro">按以下流程自动完成投标文件制作。</p>
   <div className="workflow-caption">默认执行流程</div>
   <div className="workflow-steps">{['解读','制作目录','制作投标文件'].map((label,index)=><div className="workflow-step" key={label}>{index>0&&<span className="workflow-arrow" aria-hidden="true">→</span>}<span className="workflow-number">{index+1}</span><span>{label}</span></div>)}</div>
   <div className="workflow-optional"><div className="workflow-caption">可选流程</div>
    <label className="workflow-review" data-selected={includeReview}><input type="checkbox" checked={includeReview} disabled={busy} onChange={e=>setIncludeReview(e.target.checked)}/><div><span className="workflow-review-title">标书审核<span className="workflow-tag">可选</span></span><p>投标文件制作完成后，继续进行标书审核。</p></div></label>
    <div className="workflow-warning"><span aria-hidden="true">ⓘ</span><span>标书审核会消耗大量 Token，请按需选择。</span></div>
   </div>
   <p className="workflow-summary" aria-live="polite">{includeReview?'本次执行 4 个流程，制作完成后继续进行标书审核。':'本次执行 3 个流程，完成投标文件制作后结束。'}</p>
  </div>
  <div className="workflow-actions"><button className="bp-btn" disabled={busy} onClick={()=>setOpen(false)}>取消</button><button className="bp-btn" data-kind="primary" disabled={busy||hasDirty||executing||!flow.source_selection.main} onClick={()=>void submit()}>{busy?'提交中…':'开始自动完成'}</button></div>
 </Modal></>;
}
