import {useEffect,useRef,useState,type ReactNode} from 'react';
import {request,json,ApiError,type Flow,type Execution} from '../api';
import {reportError,clearNotice,reportExecution} from './NoticeCenter';
import {businessText} from './MarkdownDocument';
const labels={running:'正在执行',needs_input:'填写具体选项',completed:'本轮已结束',failed:'本轮未完成',stopped:'已停止'};
const identityOf=(e:Execution|null)=>JSON.stringify([e?.session_id,e?.action_id,e?.questions]);
// 草稿随项目详情存活；执行栏因页面布局切换重挂时仍使用同一份答案。
export function useExecutionInput(tid:string,execution:Execution|null){
 const [answers,setAnswers]=useState<Record<string,string[]>>({}),[notes,setNotes]=useState<Record<string,string>>({});
 const identity=identityOf(execution);
 useEffect(()=>{setAnswers({});setNotes({})},[tid,identity]);
 return {answers,setAnswers,notes,setNotes};
}
export type ExecutionInput=ReturnType<typeof useExecutionInput>;
type ExecutionControlsProps={tid:string;execution:Execution|null;input:ExecutionInput;onChanged:()=>Promise<void>;progress?:ReactNode;stateLabel?:string;statusState?:Execution['state'];layout?:'build'};
export function useExecutionControls({tid,execution,input,onChanged,progress,stateLabel,statusState,layout}:ExecutionControlsProps){
 const {answers,setAnswers,notes,setNotes}=input;
 const [busy,setBusy]=useState(false),[stopping,setStopping]=useState(false),lock=useRef(false);
 const identity=identityOf(execution),groups=execution?.questions??[],questions=groups.flatMap(g=>g.questions.map(q=>({...q,key:g.callId+':'+q.id,callId:g.callId})));
 useEffect(()=>{setStopping(false)},[identity]);
 useEffect(()=>{if(!['running','needs_input'].includes(execution?.state??''))setStopping(false)},[execution?.state]);
 useEffect(()=>{if(execution)reportExecution(tid,execution)},[execution?.action_id,execution?.state,execution?.error,execution?.resolved,tid]);
 const submit=async()=>{
  if(!execution||lock.current)return;lock.current=true;setBusy(true);const id=tid+':answer:'+execution.session_id;
  try{
   const latest=(await request<Flow>(`/page-flow/${tid}`)).execution;
   if(latest?.state!=='needs_input'||identityOf(latest)!==identity){await onChanged();throw new ApiError(409,'本次问题已变化，请读取最新问题后作答')}
   await request(`/page-flow/${tid}/answer`,json('POST',{session_id:execution.session_id,call_ids:groups.map(g=>g.callId),batches:groups.map(g=>({call_id:g.callId,answers:g.questions.map(q=>{const key=g.callId+':'+q.id;return {id:q.id,selected:answers[key]??[],...(notes[key]?.trim()?{custom:notes[key].trim()}:{})}})}))}));
   clearNotice(id);await onChanged();
  }catch(e){await onChanged();reportError(e,{id,scope:tid,title:'选项提交未完成'})}finally{lock.current=false;setBusy(false)}
 };
 const stop=async()=>{
  if(!execution||lock.current||stopping)return;lock.current=true;setStopping(true);const id=tid+':stop:'+execution.session_id;
  try{await request(`/page-flow/${tid}/stop`,json('POST',{session_id:execution.session_id,action_id:execution.action_id}));clearNotice(id);await onChanged()}
  catch(e){setStopping(false);await onChanged();reportError(e,{id,scope:tid,title:'停止操作未完成',retry:stop,retryLabel:'再次停止'})}finally{lock.current=false}
 };
 const displayState=statusState??(execution?.resolved?'completed':execution?.state);
 const stopButton=['running','needs_input'].includes(execution?.state??'')?<button className="bp-btn" disabled={busy||stopping} onClick={()=>void stop()}>{stopping?'正在停止…':'停止'}</button>:null;
 const controls=progress||execution?layout==='build'?<div className="build-status" aria-label="制作状态">{progress}<div className="build-status-execution" data-state={displayState}><span className="build-status-dot" data-state={displayState} aria-hidden="true"/><strong role="status">{stopping?'正在停止…':stateLabel??(execution?(execution.state==='needs_input'?'等待补充':labels[displayState!]):'待开始')}</strong>{stopButton}</div></div>:<div className={progress?"analysis-execution":"ly-task-strip"}>{progress??<><span className="ly-status-dot" data-state={displayState}/><strong role="status">{stopping?'正在停止…':stateLabel??labels[displayState!]}</strong></>}{!progress?<span className="bp-spacer"/>:null}{stopButton}</div>:null;
 const form=execution?.state==='needs_input'?<form className="run-options" onSubmit={e=>{e.preventDefault();void submit()}}><div className="run-options-title"><strong>补充本次{execution.kind==='review'?'审查':'制作'}信息</strong><span>填写缺失值后继续，已有答复保留在当前项目。</span></div>{questions.map(q=><fieldset key={q.key} disabled={busy||stopping}><legend>{businessText(q.question)}</legend>{q.options?.map(o=><label key={o.label}><input type={q.multiSelect?'checkbox':'radio'} name={'decision-'+q.key} checked={answers[q.key]?.includes(o.label)??false} onChange={e=>setAnswers(current=>({...current,[q.key]:q.multiSelect?(e.target.checked?[...(current[q.key]??[]),o.label]:(current[q.key]??[]).filter(v=>v!==o.label)):[o.label]}))}/>{businessText(o.label)}{o.description?<small>{businessText(o.description)}</small>:null}</label>)}<textarea rows={2} aria-label="本次选择或补充说明" placeholder="填写具体选择或补充说明" value={notes[q.key]??''} onChange={e=>setNotes({...notes,[q.key]:e.target.value})}/></fieldset>)}<button className="bp-btn" disabled={busy||stopping||!questions.length||!questions.every(q=>answers[q.key]?.length||notes[q.key]?.trim())}>提交选项</button></form>:null;
 return {controls,form};
}
export function ExecutionControls(props:ExecutionControlsProps){
 const {controls,form}=useExecutionControls(props);
 return <>{controls}{form}</>;
}
