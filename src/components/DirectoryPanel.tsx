import {useEffect,useRef,useState} from 'react';
import {useNavigationGuard} from './NavigationGuard';
import {request,json,ApiError,type Flow} from '../api';
import {numberTree,type NumberedNode} from '../lib/directoryNumbering';
import {findInDocs,promote,demote,canDemote,moveSibling,moveTo,canMoveTo,findParent,type DirectoryData,type EditNode} from '../lib/directoryTree';
import {businessText} from './MarkdownDocument';
import {reportError,clearNotice} from './NoticeCenter';
import {Modal} from './Modal';
type Directory=NonNullable<Flow['directory']>;
type EditorAction={kind:'rename'|'add'|'move';id?:string;docIndex:number};
const signature=(data:DirectoryData)=>JSON.stringify(data,(key,value)=>key==='_id'?undefined:value);
function editable(content:DirectoryData){const next=structuredClone(content);const walk=(nodes:EditNode[])=>nodes.forEach(n=>{n._id=crypto.randomUUID();walk(n.children??[])});next.response_documents?.forEach(d=>walk(d.directory??[]));return next}
const allNodes=(nodes:EditNode[]):EditNode[]=>nodes.flatMap(n=>[n,...allNodes(n.children??[])]);
const stateLabels={missing:'未生成',ready:'已生成',stale:'待更新',unverified:'待核对',draft:'待完成'};
export function DirectoryPanel({tid,value,onSaved,onSelect,locked=false,selected,statuses}:{tid:string;value:Directory;locked?:boolean;selected?:{volume:string;title:string}|null;statuses?:Flow['body_sections'];onSaved:()=>Promise<void>;onSelect:(volume:string,title:string)=>void}){
 const {mark}=useNavigationGuard();
 const [draft,setDraft]=useState<DirectoryData|null>(null),[base,setBase]=useState(value.content_seq),[busy,setBusy]=useState(false),[remove,setRemove]=useState<string|null>(null),[leaving,setLeaving]=useState(false),[conflict,setConflict]=useState(false),[initial,setInitial]=useState(''),[menu,setMenu]=useState<string|null>(null),[saved,setSaved]=useState(false);
 const [menuPosition,setMenuPosition]=useState({top:0,left:0});
 const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
 const [action,setAction]=useState<EditorAction|null>(null),[title,setTitle]=useState(''),[parent,setParent]=useState('');
 const dirty=!!draft&&signature(draft)!==initial,disabled=busy||locked;
 useEffect(()=>{mark(tid+':directory',dirty);return()=>mark(tid+':directory',false)},[tid,dirty,mark]);
 useEffect(()=>{if(!menu)return;const dismiss=(event:MouseEvent)=>{if(!(event.target as Element).closest('.directory-row-actions,.directory-menu'))setMenu(null)};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenu(null)};const scroll=(event:Event)=>{if(!(event.target instanceof Element&&event.target.closest('.directory-menu')))setMenu(null)};window.addEventListener('scroll',scroll,true);document.addEventListener('mousedown',dismiss);window.addEventListener('keydown',escape);return()=>{document.removeEventListener('mousedown',dismiss);window.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true)}},[menu]);
 const data=draft??value.content,docs=data.response_documents??[];
 const mutate=(fn:(data:DirectoryData)=>void)=>{if(disabled)return;setDraft(current=>{if(!current)return current;const next=structuredClone(current);fn(next);return next})};
 const node=(data:DirectoryData,id:string)=>findInDocs(data.response_documents??[],id);
 const saveCurrent=useRef<(force?:boolean)=>Promise<void>>(async()=>{}),saveLock=useRef(false);
 const save=async(force=false)=>{
  if(!draft||disabled||saveLock.current)return;saveLock.current=true;setBusy(true);setSaved(false);
  try{
   const validate=(nodes:EditNode[],titles:Set<string>,depth=1)=>nodes.forEach(n=>{if(!n.目录名称.trim())throw new ApiError(422,'章节标题不能为空');if(depth>5)throw new ApiError(422,'目录最多支持五层');if(!n.children?.length){if(titles.has(n.目录名称))throw new ApiError(422,'请为同册叶子章节使用不同标题：'+n.目录名称);titles.add(n.目录名称)}validate(n.children??[],titles,depth+1)});
   draft.response_documents?.forEach(doc=>validate(doc.directory??[],new Set()));
   const content=JSON.parse(JSON.stringify(draft,(key,value)=>key==='_id'?undefined:value));
   await request(`/artifacts/${value.artifact_id}/content`,json('PUT',{content,base_content_seq:base,force}));
   setDraft(null);setConflict(false);setSaved(true);clearNotice(tid+':directory-save');await onSaved();
  }catch(e){const changed=e instanceof ApiError&&e.status===409&&e.message.includes('内容已被其他修改');if(changed)setConflict(true);reportError(e,{id:tid+':directory-save',scope:tid,title:'目录保存未完成',retry:()=>saveCurrent.current(force),retryLabel:'重试保存',message:changed?'目录已在另一处更新，本次草稿已保留。请选择采用哪个版本。':undefined})}
  finally{saveLock.current=false;setBusy(false)}
 };
 saveCurrent.current=save;
 useEffect(()=>()=>{saveCurrent.current=async()=>{};clearNotice(tid+':directory-save')},[tid]);
 const openAction=(kind:EditorAction['kind'],docIndex:number,id?:string)=>{setMenu(null);setAction({kind,docIndex,id});setTitle(kind==='rename'&&id?node(data,id)!.list[node(data,id)!.index].目录名称:'新章节');setParent('')};
 const commitAction=()=>{
  if(!action)return;
  mutate(d=>{
   const a=action.id?node(d,action.id):null;
   if(action.kind==='rename'&&a)a.list[a.index].目录名称=title.trim();
   if(action.kind==='add'){
    const fresh:EditNode={目录名称:title.trim(),level:a?a.list[a.index].level+1:1,children:[],来源:[],理由来源:[],交付形态:'正文编写',节点概述:'',_id:crypto.randomUUID()};
    (a?(a.list[a.index].children??=[]):(d.response_documents![action.docIndex].directory??=[])).push(fresh);
   }
   if(action.kind==='move'&&action.id)moveTo(d.response_documents??[],action.id,parent||null);
  });setAction(null);
 };
 const tree=(nodes:NumberedNode[],volume:string,docIndex:number,depth=0):React.ReactNode=>nodes.map(({node:n,prefix,children},i)=>{
  const branchKey=volume+':'+prefix+':'+n.目录名称;
  const id=n._id!,address=draft?node(draft,id):null,status=statuses?.find(s=>s.volume===volume&&s.title===n.目录名称)?.status;
  return <div className="directory-node" key={n._id??depth+':'+i+':'+n.目录名称}>
   <div className="directory-line">{children.length?<button className="directory-toggle" aria-label={(collapsed.has(branchKey)?'展开':'收起')+n.目录名称} aria-expanded={!collapsed.has(branchKey)} onClick={()=>setCollapsed(current=>{const next=new Set(current);next.has(branchKey)?next.delete(branchKey):next.add(branchKey);return next})}>{collapsed.has(branchKey)?'›':'⌄'}</button>:null}<span className="directory-number">{prefix}</span><button className="directory-title" data-active={selected?.volume===volume&&selected?.title===n.目录名称} onClick={()=>{if(!children.length)onSelect(volume,n.目录名称)}}>{businessText(n.目录名称)}</button>
    {n.交付形态?<span className="directory-kind">{n.交付形态}</span>:null}
    {!children.length&&statuses?<span className="directory-file-state" data-state={status}>{n.目录名称==='目录'?'合册生成':status?stateLabels[status]:''}</span>:null}
    {draft?<div className="directory-row-actions">
     <button className="directory-icon" aria-label={'编辑标题：'+n.目录名称} title="编辑标题" disabled={disabled} onClick={()=>openAction('rename',docIndex,id)}>✎</button>
     <button className="directory-icon" aria-label={'删除章节：'+n.目录名称} title="删除该章及其子级" disabled={disabled} onClick={()=>setRemove(id)}>×</button>
     <button className="directory-icon" aria-label={'更多操作：'+n.目录名称} title="更多操作" aria-expanded={menu===id} disabled={disabled} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();setMenuPosition({top:Math.max(8,Math.min(rect.bottom,window.innerHeight-310)),left:Math.max(8,Math.min(rect.right-184,window.innerWidth-192))});setMenu(menu===id?null:id)}}>⋯</button>
     {menu===id?<div className="directory-menu" style={menuPosition}>
      <button disabled={disabled||n.level>=5} onClick={()=>openAction('add',docIndex,id)}>添加子项</button>
      {(['top','bottom','up','down'] as const).map((op,j)=><button key={op} disabled={disabled||!address||((op==='top'||op==='up')?address.index===0:address.index===address.list.length-1)} onClick={()=>{mutate(d=>moveSibling(d.response_documents??[],id,op));setMenu(null)}}>{['置顶','置底','上移','下移'][j]}</button>)}
      <button disabled={disabled||!findParent(docs,id)?.parent} onClick={()=>{mutate(d=>promote(d.response_documents??[],id));setMenu(null)}}>提升级别</button>
      <button disabled={disabled||!canDemote(docs,id)} onClick={()=>{mutate(d=>demote(d.response_documents??[],id));setMenu(null)}}>降低级别</button>
      <button disabled={disabled} onClick={()=>openAction('move',docIndex,id)}>移动到其他父级</button>
     </div>:null}
    </div>:null}
   </div>
   {n.节点概述?<p className="directory-summary">{businessText(n.节点概述)}</p>:null}
   {children.length&&!collapsed.has(branchKey)?<div className="directory-children">{tree(children,volume,docIndex,depth+1)}</div>:null}
  </div>;
 });
 return <section className="directory-panel">
  <div className="document-toolbar"><strong>投标目录</strong><span role="status">{busy?'保存中…':dirty?'未保存':saved?'已保存':''}</span><span className="bp-spacer"/>
   {draft?<><button className="bp-btn" disabled={disabled} onClick={()=>dirty?setLeaving(true):setDraft(null)}>取消</button><button className="bp-btn" disabled={disabled} onClick={()=>void save()}>保存目录</button></>:<button className="bp-btn" disabled={disabled} onClick={()=>{setBase(value.content_seq);setInitial(signature(value.content));setSaved(false);setMenu(null);setDraft(editable(value.content))}}>编辑目录</button>}
  </div>
  <div className="directory-docs">{docs.map((doc,index)=><div className="directory-volume" key={index}>
   {docs.length>1?<p className="directory-book-name">{businessText(doc.name??'响应文件')}</p>:null}
   {doc.scope?<details className="directory-scope"><summary>编制说明</summary><p>{businessText(doc.scope)}</p></details>:null}
   {tree(numberTree(doc.directory??[],data.numbering??'chapter'),doc.name?.trim()||'主册',index)}
   {draft?<button className="bp-btn directory-add" disabled={disabled} onClick={()=>openAction('add',index)}>+ 添加一级目录</button>:null}
  </div>)}</div>
  <Modal open={!!action} onClose={()=>setAction(null)} label={action?.kind==='move'?'移动章节':action?.kind==='add'?'添加章节':'修改章节标题'}>
   <div className="directory-dialog"><h2>{action?.kind==='move'?'移动到其他父级':action?.kind==='add'?'添加章节':'修改章节标题'}</h2>
    {action?.kind==='move'?<label>目标父级<select aria-label="目标父级" value={parent} onChange={e=>setParent(e.target.value)}><option value="">一级目录</option>{allNodes(docs[action.docIndex]?.directory??[]).filter(n=>canMoveTo(docs,action.id!,n._id!)).map(n=><option key={n._id} value={n._id}>{'　'.repeat(n.level-1)+n.目录名称}</option>)}</select></label>:<label>章节标题<input data-modal-autofocus aria-label="章节标题" value={title} onChange={e=>setTitle(e.target.value)}/></label>}
    <div className="dialog-actions"><button className="bp-btn" onClick={()=>setAction(null)}>取消</button><button className="bp-btn" data-kind="primary" disabled={disabled||(action?.kind!=='move'&&!title.trim())} onClick={commitAction}>确认</button></div>
   </div>
  </Modal>
  <Modal open={conflict} onClose={()=>setConflict(false)} label="目录版本冲突"><h2>目录已在另一处更新</h2><p>当前草稿仍在。使用本次目录会覆盖另一处修改，请确认要采用哪个版本。</p><button className="bp-btn" disabled={disabled} onClick={()=>setConflict(false)}>继续编辑</button><button className="bp-btn" disabled={disabled} onClick={()=>{setDraft(null);setConflict(false);setSaved(true);clearNotice(tid+':directory-save');void onSaved()}}>丢弃草稿并读取最新目录</button><button className="bp-btn" disabled={disabled} onClick={()=>void save(true)}>使用本次目录</button></Modal>
  <Modal open={!!remove} onClose={()=>setRemove(null)} label="删除章节"><h2>删除该章节及其子章节</h2><p>保存目录后生效，已有正文文件保留。</p><button className="bp-btn" onClick={()=>setRemove(null)}>取消</button><button className="bp-btn" disabled={disabled} onClick={()=>{mutate(d=>{const a=node(d,remove!);if(a)a.list.splice(a.index,1)});setRemove(null)}}>删除章节</button></Modal>
  <Modal open={leaving} onClose={()=>setLeaving(false)} label="未保存目录"><h2>退出目录编辑</h2><p>本次未保存的修改将被丢弃。</p><button className="bp-btn" onClick={()=>setLeaving(false)}>继续编辑</button><button className="bp-btn" onClick={()=>{setDraft(null);setLeaving(false)}}>丢弃本次修改</button></Modal>
 </section>;
}
