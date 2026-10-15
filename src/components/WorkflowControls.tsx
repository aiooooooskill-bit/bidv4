import {useState} from 'react';
import {request,json,type Flow} from '../api';
import {reportError} from './NoticeCenter';
import {useNavigationGuard} from './NavigationGuard';
const labels:Record<string,string>={analyse:'解析与解读',outline:'投标目录',build:'正文制作与合册',review:'标书审查'};
export function WorkflowControls({tid,flow,onChanged}:{tid:string;flow:Flow;onChanged:()=>Promise<void>}){
 const {hasDirty}=useNavigationGuard();
 const [busy,setBusy]=useState(false),workflow=flow.workflow;
 const active=workflow?.state==='running',waiting=workflow?.state==='needs_input'&&flow.execution?.state==='needs_input',executing=flow.execution?.state==='running';
 const submit=async(resume=false,stop=false)=>{if(hasDirty&&!stop)return;setBusy(true);try{await request(`/page-flow/${tid}/workflow`,stop?json('DELETE',{workflow_id:workflow!.id}):json('POST',{resume}));await onChanged()}catch(e){reportError(e,{id:tid+':workflow',scope:tid,title:'自动流程未完成'})}finally{setBusy(false)}};
 const status=workflow?.state==='completed'?'流程已完成':active?'正在'+(labels[workflow.stage??'analyse']??'执行'):workflow?.state==='needs_input'?'等待具体信息':workflow?.state==='stopped'?'流程已停止':workflow?.error;
 return active||waiting?<button className="bp-btn" data-kind="danger" title={status} disabled={busy} onClick={()=>void submit(false,true)}>停止流程</button>:<button className="bp-btn" data-kind="primary" title={hasDirty?'请先保存当前修改，再自动完成流程':status??'自动完成解析、解读、目录、制作和审查'} disabled={hasDirty||busy||executing||!flow.source_selection.main} onClick={()=>void submit(!!workflow&&!['completed','stopped'].includes(workflow.state))}>{workflow&&!['completed','stopped'].includes(workflow.state)?'继续流程':'自动完成'}</button>;
}
