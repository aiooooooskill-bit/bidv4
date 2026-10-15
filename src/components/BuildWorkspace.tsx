import {useEffect,useRef,useState} from 'react';
import {BASE,bodyUrl,request,json,type Flow,type Artifact,type WorkFile} from '../api';
import {useExecutionControls,type ExecutionInput} from './ExecutionControls';
import {DirectoryPanel} from './DirectoryPanel';
import {SourcePreview} from './SourcePreview';
import {BidderSetup} from './BidderSetup';
import {Modal} from './Modal';
import {OutlineOptionsDialog} from './OutlineOptionsDialog';
import {useNavigationGuard} from './NavigationGuard';
import {reportError,clearNotice} from './NoticeCenter';
import type {EditNode} from '../lib/directoryTree';

export type ExecuteAction=(kind:string,sections?:Array<{volume:string;title:string}>,options?:Record<string,unknown>)=>Promise<boolean>;
type Selection={volume:string;title:string};
const countDirectoryNodes=(nodes:EditNode[]):number=>nodes.reduce((count,node)=>count+1+countDirectoryNodes(node.children??[]),0);
export function BuildWorkspace({tid,mode,flow,input,artifacts,disabled,busy,onChanged,execute,exportVolume,renderDocument}:{tid:string;mode:'build';flow:Flow;input:ExecutionInput;artifacts:Artifact[];disabled:boolean;busy:boolean;onChanged:()=>Promise<void>;execute:ExecuteAction;exportVolume:()=>Promise<void>;renderDocument:(file:WorkFile)=>React.ReactNode}){
 const {navigate,hasDirty}=useNavigationGuard();
 const [tab,setTab]=useState('directory'),[selected,setSelected]=useState<Selection|null>(null),[volumeId,setVolumeId]=useState<string|null>(null),[orphan,setOrphan]=useState<string|null>(null),[outlineOpen,setOutlineOpen]=useState(false),[action,setAction]=useState<'guide'|'promises'|'revise'|null>(null),[instruction,setInstruction]=useState('');
 const guide=flow.files.find(f=>f.path==='body/写作指引.md'),promises=flow.files.find(f=>f.path==='body/关键事实与承诺.md');
 const section=flow.body_sections.find(s=>s.volume===selected?.volume&&s.title===selected?.title);
 const selectedBody=section&&flow.body_files.includes(section.path)?section.path:null;
 const total=flow.body_sections.length,generated=flow.body_sections.filter(s=>flow.body_files.includes(s.path)).length,missing=total-generated,unfinished=flow.body_sections.filter(s=>s.status==='draft').length;
 const affected=flow.body_sections.filter(s=>s.status==='stale'||s.status==='unverified');
 const volumes=artifacts.filter(a=>a.kind==='tender.volume'),volume=volumes.find(a=>a.artifact_id===volumeId);
 const currentVolumes=flow.volume_states,readyVolumes=currentVolumes.filter(v=>v.status==='ready').length;
 const directoryCount=flow.directory?.content.response_documents?.reduce((count,document)=>count+countDirectoryNodes(document.directory??[]),0)??0;
 const historicalVolumes=volumes.filter(a=>!currentVolumes.some(v=>v.artifact_id===a.artifact_id));
 const selectedVolumeState=currentVolumes.find(v=>v.artifact_id===volumeId);
 const locked=disabled||hasDirty,prepared=flow.build_preparation?.guide==='ready'&&flow.build_preparation?.promises==='ready';
 const stalePreparation=['guide','promises'].filter(stage=>flow.build_preparation?.[stage as 'guide'|'promises']==='stale');
 const complete=!!total&&!missing&&!unfinished&&prepared&&!!currentVolumes.length&&readyVolumes===currentVolumes.length;
 const previewUrl=volume?`${BASE}/artifacts/${volume.artifact_id}/file?v=${volume.content_seq}`:orphan?bodyUrl(tid,orphan,flow.input_versions.revise):selectedBody?bodyUrl(tid,selectedBody,flow.input_versions.revise):null;
 const previewName=volume?volume.display_name+'.docx':orphan??selectedBody;
 const running=['running','needs_input'].includes(flow.execution?.state??'');
 const buildPhase=flow.build_preparation?.guide!=='ready'?'准备写作指引':flow.build_preparation?.promises!=='ready'?'准备关键事实与承诺':'逐章生成正文与合册';
 const pendingQuestion=flow.execution?.questions?.flatMap(g=>g.questions)[0];
 const needsInput=flow.execution?.state==='needs_input',reviewPreparation=!running&&stalePreparation.length>0,panelNeeded=needsInput||reviewPreparation;
 const questionCount=flow.execution?.questions?.reduce((count,group)=>count+group.questions.length,0)??0,panelId=`preparation-panel-${tid}`;
 const panelIdentity=JSON.stringify([tid,needsInput?[flow.execution?.session_id,flow.execution?.questions]:null,reviewPreparation?stalePreparation.map(stage=>[stage,flow.build_preparation_changes?.[stage as 'guide'|'promises']]):null]);
 const [panelOpen,setPanelOpen]=useState(panelNeeded);
 const panelRef=useRef<HTMLElement>(null),panelToggle=useRef<HTMLButtonElement>(null);
 const closePanel=()=>{setPanelOpen(false);if(panelRef.current?.contains(document.activeElement))panelToggle.current?.focus()};
 useEffect(()=>setPanelOpen(panelNeeded),[panelIdentity,panelNeeded]);
 useEffect(()=>{
  if(!panelNeeded||!panelOpen)return;
  // 使用冒泡监听；现有 Modal 在捕获阶段处理 Escape 并阻止传播。
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();closePanel()}};
  window.addEventListener('keydown',close);
  return()=>window.removeEventListener('keydown',close);
 },[panelNeeded,panelOpen]);
 const phase=flow.execution?.state==='needs_input'?`等待${pendingQuestion?.header??'补充信息'}答复`:flow.execution?.kind==='body'?(flow.build_preparation?.guide!=='ready'?'准备写作指引':flow.build_preparation?.promises!=='ready'?'整理关键事实与承诺':`正在生成${flow.execution.sections?.map(s=>s.title).join('、')??'所选章节'}`):flow.execution?.kind==='build'?buildPhase:({outline:'正在生成目录',guide:'正在生成写作指引',promises:'正在生成关键事实与承诺',body:'正在生成章节',revise:'正在修改章节'} as Record<string,string>)[flow.execution?.kind??'']??'正在执行';
 useEffect(()=>{if(selected&&!section){setSelected(null);setVolumeId(null)}},[selected,section]);
 useEffect(()=>{if(mode==='build'&&tab==='checks')setTab('directory')},[mode,tab]);
 const pick=(volume:string,title:string)=>{setSelected({volume,title});setVolumeId(null);setOrphan(null)};
 const accept=async()=>{if(!selected)return;try{await request(`/page-flow/${tid}/accept-section`,json('POST',{...selected,input_version:flow.input_versions.revise}));clearNotice(tid+':accept-section');await onChanged()}catch(e){reportError(e,{id:tid+':accept-section',scope:tid,title:'章节依据确认未完成'})}};
 const openAction=(kind:NonNullable<typeof action>)=>{setInstruction('');setAction(kind)};
 const stateLabel=running?phase:flow.execution?.state==='failed'?'制作未完成':flow.execution?.state==='stopped'?'已停止':complete?'标书已制作':flow.execution?.state==='completed'?'本轮已结束':'待开始';
 const {controls,form}=useExecutionControls({tid,execution:flow.execution,input,onChanged,layout:'build',stateLabel,progress:<>
  <div className="build-status-metrics" aria-label="制作进度"><span className="build-status-group"><span className="build-status-dot" data-state={flow.directory?'ready':'missing'} aria-hidden="true"/><span>{flow.directory?'目录已保存':'目录未生成'}</span>{flow.directory?<small>{directoryCount} 项</small>:null}</span><span className="build-status-group" aria-label={`正文生成进度：${generated} / ${total} 章`}><span>正文</span><strong>{generated} / {total}</strong><span>章</span></span><span className="build-status-group" aria-label={`整册就绪：${readyVolumes} / ${currentVolumes.length} 册`}><span>整册就绪</span><strong>{readyVolumes} / {currentVolumes.length}</strong><span>册</span></span><span className="build-status-group">{flow.directory?(flow.directory.content.page_target==null?'不限篇幅':`目标 ${flow.directory.content.page_target} 页`):'篇幅待设置'}</span></div>
  {unfinished||affected.length||hasDirty||flow.execution?.state==='failed'?<div className="build-status-notes">{unfinished?<span>{unfinished} 章待完成</span>:null}{affected.length?<span data-tone="warning">{affected.length} 章待核对或更新</span>:null}{hasDirty?<strong data-tone="warning">请先保存当前修改，再发起制作操作。</strong>:null}{flow.execution?.state==='failed'?<strong data-tone="error">制作未完成，请查看错误提示</strong>:null}</div>:null}
 </>});
 const tabs=<div className="bp-tabs">{[['directory','目录与章节'],['guide','写作指引'],['promises','关键事实与承诺'],].map(([key,label])=><button className="bp-tab" data-active={tab===key} key={key} onClick={()=>{if(tab!==key)navigate(()=>setTab(key))}}>{label}</button>)}</div>;
 return <>
  {mode==='build'?<div className="build-toolbar"><BidderSetup tid={tid} flow={flow} onChanged={onChanged}/><button className="bp-btn" disabled={locked} onClick={()=>setOutlineOpen(true)}>{flow.directory?'智能调整目录':'智能生成目录'}</button>
   <span className="bp-spacer"/><button className="bp-btn" data-kind="primary" disabled={locked||!flow.bidder?.confirmed||flow.bidder?.stale||!flow.directory||!total||complete||!!stalePreparation.length} onClick={()=>void execute('build',[])}>{complete?'标书已制作':generated?'继续制作标书':'开始制作标书'}</button>
   <button className="bp-btn" disabled={locked||!generated} onClick={()=>void exportVolume()}>合册导出</button>
  </div>:null}
  {controls}
  {panelNeeded?<div className="preparation-summary" role="status"><div><strong>{needsInput?'制作需要补充信息':'写作准备需要核对'}</strong><span>{needsInput?`请在核对面板填写${questionCount?` ${questionCount} 项`:''}制作信息后继续。`:'编写依据已变化，请核对写作准备后继续。'}</span></div><button ref={panelToggle} className="bp-btn" aria-expanded={panelOpen} aria-controls={panelId} onClick={()=>setPanelOpen(open=>!open)}>{panelOpen?'收起核对面板':'打开核对面板'}</button></div>:null}
  <div className="build-workspace" data-panel-open={panelNeeded&&panelOpen}><div className="build-content">
  {tab!=='directory'?tabs:null}
  {tab==='directory'?<div className="build-layout">
   <div className="directory-pane">{tabs}
   {flow.directory?<DirectoryPanel tid={tid} value={flow.directory} onSaved={onChanged} locked={disabled} onSelect={pick} selected={selected} statuses={flow.body_sections}/>:<div className="bp-empty">点击“智能生成目录”，选择目标篇幅与编号方式。</div>}
   </div>
   <div className="chapter-pane"><div className="document-toolbar"><strong>{volume?.display_name??orphan?.split('/').pop()??selected?.title??'Word 文档预览'}</strong><span className="bp-spacer"/>
    {volumeId||orphan?<button className="bp-btn" onClick={()=>{setVolumeId(null);setOrphan(null)}}>返回章节预览</button>:selected?<>
     <button className="bp-btn" disabled={locked||!section||!!stalePreparation.length} title={hasDirty?'请先保存当前修改':running?'当前操作尚未结束':stalePreparation.length?'请先核对过期的写作准备':!prepared?'自动补齐写作准备后，只生成所选章':undefined} onClick={()=>void execute('body',[selected],{instruction:selectedBody?'更新当前章，按当前目录与写作指引重新编写；仅更新此章，保留其他正文。':''})}>{selectedBody?'更新当前章':'生成当前章'}</button>
     <button className="bp-btn" disabled={locked||!selectedBody||!prepared} onClick={()=>openAction('revise')}>修改当前章</button>
    </>:null}
   </div>
   {!volumeId&&!orphan&&(section?.status==='stale'||section?.status==='unverified')&&selectedBody?<div className="chapter-notice">{section.status==='stale'?'本章编写依据已变化，已有 Word 正文保留。请核对后保留，或更新当前章。':'本章已有 Word 正文，编写依据尚未核对。'}<button className="bp-btn" disabled={locked||!prepared} onClick={()=>void accept()}>已核对，保留当前章</button></div>:null}
   {volume&&selectedVolumeState?.status!=='ready'?<div className="chapter-notice">{selectedVolumeState?'此整册尚未按当前目录和正文完成合册发布，请重新合册。':'此整册已不在当前目录中，作为历史文件保留。'}</div>:null}
   {previewUrl&&previewName?<SourcePreview key={previewUrl} name={previewName.endsWith('.docx')?previewName:previewName+'.docx'} url={previewUrl}/>:<div className="bp-empty">{selected?'本章节尚无正文。点击“生成当前章”可自动补齐写作准备并生成本章。':'点击左侧章节查看 Word 文档。'}</div>}
   {currentVolumes.length?<div className="volume-files">{currentVolumes.map(v=>{const a=volumes.find(a=>a.artifact_id===v.artifact_id);return <div key={v.name}><strong>{v.name}</strong><span>{v.status==='ready'?'整册已就绪':v.status==='missing'?'待合册发布':'待重新合册'}</span>{a?<><button className="bp-btn" onClick={()=>{setVolumeId(a.artifact_id);setOrphan(null)}}>预览整册</button>{v.status==='ready'?<a className="bp-btn" href={`${BASE}/artifacts/${a.artifact_id}/file?v=${a.content_seq}`}>下载标书</a>:null}</>:null}</div>})}</div>:null}
   {historicalVolumes.length?<details className="retained-files"><summary>{historicalVolumes.length} 份历史整册已保留</summary>{historicalVolumes.map(a=><div key={a.artifact_id}><span>{a.display_name}</span><button className="bp-btn" onClick={()=>{setVolumeId(a.artifact_id);setOrphan(null)}}>预览历史整册</button><a className="bp-btn" href={`${BASE}/artifacts/${a.artifact_id}/file?v=${a.content_seq}`}>下载历史整册</a></div>)}</details>:null}
   {flow.orphan_body_files?.length?<details className="retained-files"><summary>{flow.orphan_body_files.length} 份正文已不在当前目录中，文件已保留</summary>{flow.orphan_body_files.map(path=><button className="bp-btn" key={path} onClick={()=>{setOrphan(path);setVolumeId(null)}}>{path.split('/').pop()}</button>)}</details>:null}
   </div>
  </div>:tab==='guide'||tab==='promises'?<><div className="build-toolbar"><span>{tab==='guide'?'按当前目录规划章节写法与素材。':'统一全文的项目事实与具体承诺值。'}</span><span className="bp-spacer"/><button className="bp-btn" disabled={locked||!flow.directory||(tab==='promises'&&flow.build_preparation?.guide!=='ready')} onClick={()=>openAction(tab)}>{tab==='guide'?'生成写作指引':'生成承诺清单'}</button></div><div className="work-document">{(tab==='guide'?guide:promises)?renderDocument((tab==='guide'?guide:promises)!):<div className="bp-empty">{tab==='guide'?'尚无写作指引，可单独生成或由“开始制作标书”自动准备。':'尚无关键事实与承诺，可单独生成或由“开始制作标书”自动准备。'}</div>}</div></>:null}
  </div>{panelNeeded&&panelOpen?<aside ref={panelRef} className="preparation-panel" id={panelId} aria-label="制作核对面板"><div className="preparation-panel-header"><strong>制作信息核对</strong><button className="bp-btn" aria-label="收起核对面板" onClick={closePanel}>收起</button></div><div className="preparation-panel-content">
   {form}
   {reviewPreparation?<section className="preparation-review"><h2>写作准备需要核对</h2>{stalePreparation.map(stage=><section key={stage}><h3>{stage==='guide'?'写作指引':'关键事实与承诺'}</h3><ul>{(flow.build_preparation_changes?.[stage as 'guide'|'promises']?.length?flow.build_preparation_changes[stage as 'guide'|'promises']:['编写依据已变化']).map((change,index)=><li key={index}>{change}</li>)}</ul><button className="bp-btn" disabled={hasDirty} onClick={()=>navigate(()=>setTab(stage))}>{stage==='guide'?'查看写作指引':'查看关键事实与承诺'}</button></section>)}<p>请按当前依据核对，在对应页签编辑并保存后继续；共享准备变化会影响其他章的编写依据，已有正文保留。</p></section>:null}
  </div></aside>:null}</div>
  {outlineOpen?<OutlineOptionsDialog value={flow.directory?.content} busy={busy} onClose={()=>setOutlineOpen(false)} onSubmit={options=>execute('outline',[],{...options,instruction:flow.directory?'按当前已保存目录调整，保留人工编排；只调整符合当前目标篇幅和编号设置所必需的内容。':''})}/>:null}
  <Modal open={!!action} onClose={()=>{if(!busy)setAction(null)}} label={action==='revise'?'修改当前章':action==='guide'?'生成写作指引':'生成承诺清单'} width="600px"><div className="outline-options"><h2>{action==='revise'?'修改当前章':action==='guide'?'生成写作指引':'生成承诺清单'}</h2><label>{action==='revise'?'修改要求':'补充要求（选填）'}<textarea data-modal-autofocus aria-label="本次操作要求" value={instruction} disabled={busy} rows={6} onChange={e=>setInstruction(e.target.value)} placeholder={action==='promises'?'填写已经确定的具体承诺值；缺失项将在制作时集中询问。':'填写本次写作或修改要求。'}/></label><div className="dialog-actions"><button className="bp-btn" disabled={busy} onClick={()=>setAction(null)}>取消</button><button className="bp-btn" data-kind="primary" disabled={busy||(action==='revise'&&!instruction.trim())} onClick={async()=>{if(action&&await execute(action,action==='revise'&&selected?[selected]:[],{instruction}))setAction(null)}}>确认{action==='revise'?'修改':'生成'}</button></div></div></Modal>
 </>;
}
