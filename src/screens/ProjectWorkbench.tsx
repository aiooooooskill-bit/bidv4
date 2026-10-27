import {ProjectFiles} from '../components/ProjectFiles';
import {WorkflowControls} from '../components/WorkflowControls';
import {BidderSetup} from '../components/BidderSetup';
import {openAgentConversation} from '../lib/agentConversation';
import {useCallback,useEffect,useRef,useState} from 'react';
import {request,json,sourceUrl,type Artifact,type Flow,type SourceFile,type WorkFile,type WorkEntry} from '../api';
import {SourcePreview} from '../components/SourcePreview';
import {ReviewWorkspace} from '../components/ReviewWorkspace';
import {BuildWorkspace,type ExecuteAction} from '../components/BuildWorkspace';
import {DocumentEditor} from '../components/DocumentEditor';
import {MarkdownDocument} from '../components/MarkdownDocument';
import {AnalysisProgress} from '../components/AnalysisProgress';
import {analysisCategories as categories} from '../../shared/analysis-progress.js';
import {evidenceSourceNames,locateEvidenceReference} from '../../shared/evidence-citation.js';
import {ExecutionControls,useExecutionInput} from '../components/ExecutionControls';
import {reportError,clearNotice,syncExecutionNotices} from '../components/NoticeCenter';
import {Modal} from '../components/Modal';
import {useNavigationGuard} from '../components/NavigationGuard';
import type {ListMode} from './TenderList';
export function ProjectWorkbench({tid,mode,onBack,onMode}:{tid:string;mode:ListMode;onBack:()=>void;onMode:(mode:ListMode)=>void}){
 const {navigate}=useNavigationGuard();
 const [previewName,setPreviewName]=useState('');
 const [flow,setFlow]=useState<Flow|null>(null),[loading,setLoading]=useState(true),[sources,setSources]=useState<SourceFile[]>([]),[artifacts,setArtifacts]=useState<Artifact[]>([]),[work,setWork]=useState<WorkEntry[]>([]),[showSource,setShowSource]=useState(true),[sourceModal,setSourceModal]=useState(false),[tab,setTab]=useState('basic'),[busy,setBusy]=useState(false),[syncing,setSyncing]=useState(false),[evidence,setEvidence]=useState<{content:string;name:string}|null>(null);
 const input=useExecutionInput(tid,flow?.execution??null);
 const active=useRef(true),sequence=useRef(0),actionLock=useRef(false),pending=useRef<{intent:string;payload:Record<string,unknown>;created_at:number;action_id:string}|null>(null);
 const load=useCallback(async()=>{const current=++sequence.current;setLoading(true);try{let [f,s,a,w]=await Promise.all([request<Flow>(`/page-flow/${tid}`),request<{files:SourceFile[]}>(`/files?task_id=${tid}`),request<{artifacts:Artifact[]}>(`/artifacts?task_id=${tid}`),request<{files:WorkEntry[]}>(`/workbench?task_id=${tid}`)]);if(!active.current||current!==sequence.current)return;const attempt=pending.current;if(attempt&&f.execution?.action_id===attempt.action_id)pending.current=null;syncExecutionNotices(tid,f);setFlow(f);setSyncing(false);setSources(s.files);setArtifacts(a.artifacts);setWork(w.files);clearNotice(tid+':project-load')}catch(e){if(active.current&&current===sequence.current)reportError(e,{id:tid+':project-load',scope:tid,title:'项目读取未完成',retry:load})}finally{if(active.current&&current===sequence.current)setLoading(false)}},[tid]);
 useEffect(()=>{active.current=true;void load();return()=>{active.current=false;sequence.current++}},[load,mode]);
 useEffect(()=>{const changed=()=>void load();window.addEventListener('ooo-bidpliot:changed',changed);return()=>window.removeEventListener('ooo-bidpliot:changed',changed)},[load]);
 useEffect(()=>{if(!syncing&&!['running','needs_input'].includes(flow?.execution?.state??'')&&flow?.workflow?.state!=='running')return;const id=setInterval(()=>void load(),3000);return()=>clearInterval(id)},[flow?.execution?.state,flow?.workflow?.state,syncing,load]);
 const mainFile=flow?.source_selection.main??'',supplements=flow?.source_selection.supplements.map(s=>s.file)??[];
 const disabled=!flow||busy||syncing||flow.workflow?.state==='running'||flow.execution?.state==='running'||flow.execution?.state==='needs_input';
 const execute:ExecuteAction=async(kind,sections=[],options={})=>{
  if(!flow||actionLock.current||disabled)return false;
  actionLock.current=true;sequence.current++;setBusy(true);
  const intent=JSON.stringify({kind,main_file:mainFile,supplements:supplements.filter(n=>n!==mainFile),sections,...options});
  let attempt=pending.current?.intent===intent?pending.current:null;
  try{
  if(!attempt){
   const requestId=crypto.randomUUID();
   // 对账服务端由 request_id 生成的 action_id，回执丢失时仍能精确识别本轮。
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(requestId));
   attempt={intent,created_at:Date.now(),action_id:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),payload:{kind,request_id:requestId,input_version:flow.input_versions[kind],main_file:mainFile,supplements:supplements.filter(n=>n!==mainFile),sections,...options}};
  }
  pending.current=attempt;
  await request(`/page-flow/${tid}/action`,json('POST',attempt.payload));pending.current=null;sequence.current++;setSyncing(true);clearNotice(tid+':page-action:'+kind);await load();return true}
  catch(e){reportError(e,{id:tid+':page-action:'+kind,scope:tid,title:'操作提交未完成',submission:{kind,sections,created_at:attempt?.created_at??Date.now()}});if(e instanceof Error&&'status'in e)pending.current=null;sequence.current++;setSyncing(true);await load();return false}
  finally{actionLock.current=false;setBusy(false)}
 };
 const exportVolume=async()=>{if(!flow||busy)return;setBusy(true);try{await request(`/page-flow/${tid}/export`,json('POST',{input_version:flow.input_versions.revise}));await load();clearNotice(tid+':export')}catch(e){reportError(e,{id:tid+':export',scope:tid,title:'合册未完成'})}finally{setBusy(false)}};
 const openEvidence=async(citation:string)=>{try{const reference=locateEvidenceReference(citation,work);const result=await request<{content:string}>(`/workbench/content?${new URLSearchParams({task_id:tid,path:reference.path,start:String(reference.start),end:String(reference.end)})}`);setEvidence({name:reference.source!,content:result.content});clearNotice(tid+':evidence')}catch(e){reportError(e,{id:tid+':evidence',scope:tid,title:'依据读取未完成'})}};
 const currentSource=sources.find(f=>f.name===previewName)??sources.find(f=>f.name===mainFile)??sources.find(f=>!flow?.review?.bids.includes(f.name));
 const category=categories.find(c=>c.key===tab)!;
 const readable=flow?.files.filter(f=>f.path.startsWith('analysis/')&&category.paths.includes(f.path.split('/').pop()!))??[];
 const sourcePanel=<div className="bp-source-pane"><div className="source-toolbar"><select aria-label="选择原文" value={currentSource?.name??''} onChange={e=>setPreviewName(e.target.value)}>{!currentSource?<option value="">选择招标原文</option>:null}{sources.filter(f=>!flow?.review?.bids.includes(f.name)).map(f=><option value={f.name} key={f.name}>{f.name}</option>)}</select>{flow?<ProjectFiles tid={tid} flow={flow} sources={sources} disabled={disabled} onBusy={setBusy} onChanged={load} onPreview={setPreviewName}/>:null}</div>{currentSource?<SourcePreview key={currentSource.name} name={currentSource.name} url={sourceUrl(tid,currentSource)}/>:<div className="bp-empty">尚无来源文件，可在此补充上传。</div>}</div>;
 const document=(file:WorkFile)=><DocumentEditor key={file.path} tid={tid} file={file} onSaved={load} onEvidence={openEvidence} registry={file.registry} sourceNames={evidenceSourceNames(work)}/>;
 if(!flow)return <div className="bp-analysis project-workbench"><div className="bp-detail-bar"><button className="bp-btn" onClick={onBack}>‹ 返回列表</button><span className="bp-title">{mode==='analysis'?'智能解读':mode==='build'?'标书制作':'标书审查'}</span><span className="bp-spacer"/></div><div className="bp-empty">{loading?'正在读取项目…':'项目读取未完成，请查看操作提示。'}</div></div>;
 return <div className="bp-analysis project-workbench"><div className="bp-detail-bar"><button className="bp-btn" onClick={onBack}>‹ 返回列表</button><span className="bp-title">{mode==='analysis'?'读透招标文件':mode==='build'?'标书制作':'标书审查'}</span><span className="bp-file bp-ellipsis">{flow?.task.title??'正在读取项目…'}</span><span className="bp-spacer"/><div className="project-agent-actions" role="group" aria-label="流程与对话"><WorkflowControls tid={tid} flow={flow} onChanged={load} disabled={busy||syncing}/><button className="bp-btn" disabled={!flow.session_id} onClick={()=>{if(flow.session_id)navigate(()=>openAgentConversation(flow.session_id!))}}>Agent 对话</button></div><button className="bp-btn" onClick={()=>mode==='analysis'?setShowSource(v=>!v):setSourceModal(true)}>{mode==='analysis'&&showSource?'收起原文':'查看原文'}</button>{mode==='analysis'?<><button className="bp-btn" disabled={disabled||!mainFile} onClick={()=>execute('analyse')}>开始解读</button><button className="bp-btn" onClick={()=>onMode('build')}>制作标书</button></>:<button className="bp-btn" disabled={mode==='build'&&(disabled||!flow.body_sections.some(s=>flow.body_files.includes(s.path)))} onClick={async()=>{if(mode==='build'){if(await execute('review'))onMode('review')}else onMode('build')}}>{mode==='build'?'发起审核':'返回制作'}</button>}{flow.workflow?.state==='completed'?<div className="project-result-actions" role="group" aria-label="流程成果">{flow.review.status==='reviewed'&&flow.review.report?<button className="bp-btn" onClick={()=>navigate(()=>onMode('review'))}>查看审查报告</button>:null}{flow.volume_states.filter(v=>v.status==='ready'&&v.artifact_id).map(v=><a className="bp-btn" key={v.artifact_id!} href={'/api/bidv4/artifacts/'+v.artifact_id+'/file'} title="下载已发布的合册 Word" download>{v.name}下载</a>)}</div>:null}</div>{mode==='analysis'?<BidderSetup tid={tid} flow={flow} onChanged={load}/>:null}{mode==='analysis'?<ExecutionControls key={tid} tid={tid} execution={flow.execution} input={input} onChanged={load} progress={<AnalysisProgress progress={flow.analysis_progress}/>}/>:null}{mode==='analysis'?<>{!mainFile?<p className="chapter-notice">请选择或上传主文件，再启动解读或自动完成。</p>:flow.analysis_current===false&&flow.files.some(f=>f.path.startsWith('analysis/'))?<p className="chapter-notice">来源已变化或解读尚未完成。此前成果保留，请重新解读后继续制作。</p>:null}<div className="bp-split" data-view={showSource?'split':'content'}>{showSource?sourcePanel:null}<div className="bp-main"><div className="bp-tabs">{categories.map(c=><button className="bp-tab" data-active={tab===c.key} key={c.key} onClick={()=>{if(tab!==c.key)navigate(()=>setTab(c.key))}}>{c.name}</button>)}</div><div className="bp-body">{readable.length?readable.map(document):<div className="bp-empty">此栏目尚无解读文件。</div>}</div></div></div></>:mode==='review'?<ReviewWorkspace tid={tid} flow={flow} sources={sources} input={input} disabled={disabled} onChanged={load} execute={execute}/>:<BuildWorkspace tid={tid} syncing={syncing} flow={flow} input={input} artifacts={artifacts} disabled={disabled} busy={busy} onChanged={load} execute={execute} exportVolume={exportVolume} renderDocument={document} /> }<Modal open={sourceModal} onClose={()=>setSourceModal(false)} width="90vw" label="招标原文"><div className="library-preview"><div className="document-toolbar"><strong>招标原文</strong><button className="bp-btn" onClick={()=>setSourceModal(false)}>关闭</button></div>{sourcePanel}</div></Modal><Modal open={!!evidence} onClose={()=>setEvidence(null)} label="原文依据"><div className="document-toolbar"><strong>{evidence?.name}</strong><button className="bp-btn" onClick={()=>setEvidence(null)}>关闭</button></div><MarkdownDocument content={evidence?.content??''}/></Modal></div>
}
