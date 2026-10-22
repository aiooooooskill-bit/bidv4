import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {autoUpdate,computePosition,flip,hide,offset,shift,size} from '@floating-ui/dom';
import {uploadFile,validateUpload,type UploadProgress} from '../../api';
import {Modal} from '../Modal';
import {api} from './shared';

type Action='replace'|'recognize'|'delete'|'delete-block';
type Props={kind:'kb'|'mt'|'template';name:string;path:string;versionQuery:string;disabled?:boolean;builtin?:boolean;blockCount?:number;block?:{id:string;title:string};onBusyChange?:(busy:boolean)=>void;onChanged:(message:string,action:Action)=>void|Promise<void>};
function FileActionIcon({name}:{name:'refresh'|'trash'|'folder-x'}){
 return <svg className="library-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  {name==='refresh'?<><path d="M3 11a9 9 0 0 1 15-6.7L21 7M21 3v4h-4M21 13a9 9 0 0 1-15 6.7L3 17M3 21v-4h4"/></>:name==='trash'?<><path d="M3 6h18M10 11v6M14 11v6M5 6l1 14h12l1-14M9 6V3h6v3"/></>:<><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/><path d="m10 11 5 5m0-5-5 5"/></>}
 </svg>;
}
export function FileActions({kind,name,path,versionQuery,disabled=false,builtin=false,blockCount=0,block,onBusyChange,onChanged}:Props){
 const [over,setOver]=useState(false),[menu,setMenu]=useState(false),[action,setAction]=useState<Action|null>(null),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState<UploadProgress|null>(null),[committed,setCommitted]=useState(false);
 const input=useRef<HTMLInputElement>(null),lock=useRef(false),mounted=useRef(true),more=useRef<HTMLButtonElement>(null),root=useRef<HTMLDivElement>(null),menuElement=useRef<HTMLDivElement>(null);
 useEffect(()=>()=>{mounted.current=false},[]);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false)},[busy]);
 useEffect(()=>{if(!menu)return;const close=(e:Event)=>{if(!root.current?.contains(e.target as Node)&&!menuElement.current?.contains(e.target as Node))setMenu(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[menu]);
 useEffect(()=>{
  const anchor=more.current,popup=menuElement.current;if(!menu||!anchor||!popup)return;
  let active=true,positioned=false;
  const cleanup=autoUpdate(anchor,popup,()=>{
   void computePosition(anchor,popup,{placement:'bottom-end',strategy:'fixed',middleware:[offset(6),flip({padding:8}),shift({padding:8}),size({padding:8,apply({availableWidth,availableHeight,elements}){Object.assign(elements.floating.style,{maxWidth:Math.max(0,availableWidth)+'px',maxHeight:Math.max(0,availableHeight)+'px'})}}),hide({strategy:'referenceHidden'})]}).then(({x,y,middlewareData})=>{
    if(!active)return;if(middlewareData.hide?.referenceHidden){setMenu(false);return}Object.assign(popup.style,{left:x+'px',top:y+'px',visibility:'visible'});
    if(!positioned){positioned=true;popup.querySelector('button')?.focus()}
   });
  });
  return()=>{active=false;cleanup()};
 },[menu]);
 const open=(next:Action)=>{more.current?.focus();setMenu(false);setAction(next);setFile(null);setError('');setProgress(null);setCommitted(false)};
 const close=()=>{if(!lock.current){setAction(null);more.current?.focus()}};
 const title=action==='replace'?'更换文件':action==='recognize'?(kind==='kb'?'重新识别':'重新解析来源文件'):action==='delete-block'?'删除当前素材':kind==='mt'?'删除来源文件':'删除资料';
 const note=action==='replace'?(kind==='kb'?'新文件校验通过后，将保留资料名称和公司归属，清除旧识别结果与人工核对内容，重新识别、AI 整理并更新检索索引。完成后请重新核对。':kind==='mt'?`更换将清除该来源的 ${blockCount} 份关联素材及其检索内容。新文件解析后，请重新选择章节建立素材，旧章节区间不会沿用。`:'将替换当前版式文件并保留其名称与默认设置，已有标书文件保持原样。'):action==='recognize'?(kind==='kb'?'将从原件重新识别并进行 AI 整理。旧识别结果、人工核对内容和索引将清除，处理完成后请重新核对。':`将重新解析原件并更新 ${blockCount} 份关联素材的检索内容，完成后请核对章节区间。`):action==='delete-block'?'只删除当前素材及其检索内容，来源文件和其他素材保留。此操作无法撤销。':kind==='mt'?`将删除来源文件、解析产物及全部 ${blockCount} 份关联素材和检索内容。此操作无法撤销。`:kind==='kb'?'将删除原件、识别结果、核对内容和检索索引。已采用该资料的主体信息需要重新核对。此操作无法撤销。':'将删除该版式；如果它是默认版式，将恢复使用内置版式。已有标书文件保持原样。此操作无法撤销。';
 const message=action==='replace'?(kind==='kb'?'文件已更换，已提交完整识别与 AI 整理，完成后请重新核对。':kind==='mt'?'来源文件已更换，请核对解析结果并重新选择章节建立素材。':'版式文件已更换，预览已更新。'):action==='recognize'?(kind==='kb'?'已提交完整重新识别与 AI 整理，旧核对内容已清除。':'来源文件重新解析已处理，请核对解析状态、素材内容和章节区间。'):action==='delete-block'?'当前素材及其检索内容已删除，来源文件保留。':kind==='mt'?'来源文件、全部关联素材与检索内容已删除。':'资料及相关文件已删除。';
 const pick=(next?:File)=>{
  if(!next||lock.current||committed)return;
  setFile(null);setError('');
  try{if(kind!=='mt')validateUpload(next);if(kind!=='kb'&&!next.name.toLowerCase().endsWith('.docx'))throw new Error('仅支持 DOCX 文件');if(kind==='template'&&next.size>20*1024*1024)throw new Error('版式文件超过 20 MB 上限');if(!next.size)throw new Error('文件内容为空');setFile(next)}catch(error){setError(error instanceof Error?error.message:String(error))}
 };
 const submit=async()=>{
  if(lock.current||!action||(!committed&&disabled)||(!committed&&action==='replace'&&!file))return;
  lock.current=true;setBusy(true);setError('');
  try{
   if(!committed){
    if(action==='replace')await uploadFile(path+'/replace?'+versionQuery,file!,p=>mounted.current&&setProgress(p));
    else if(action==='recognize')await api(path+(kind==='kb'?'/retrigger?'+versionQuery:'/reparse'),'POST',{});
    else await api(action==='delete-block'?'/materials/blocks/'+block!.id:path+'?'+versionQuery,'DELETE',{});
    if(!mounted.current)return;
    setCommitted(true);
   }
   await onChanged(message,action);
   if(mounted.current)setAction(null);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e))}
  finally{lock.current=false;if(mounted.current)setBusy(false)}
 };
 return <div className="library-file-actions" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)&&!menuElement.current?.contains(e.relatedTarget as Node))setMenu(false)}} onKeyDown={e=>{
  if(e.key==='Escape'&&menu){e.preventDefault();setMenu(false);more.current?.focus()}
  if(e.key==='ArrowDown'&&e.target===more.current){e.preventDefault();setMenu(true);menuElement.current?.querySelector('button')?.focus()}
  if(menu&&menuElement.current?.contains(e.target as Node)){
   const buttons=Array.from(menuElement.current.querySelectorAll('button')),index=buttons.indexOf(e.target as HTMLButtonElement);
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus()}
   if(e.key==='Tab'&&((e.shiftKey&&index===0)||(!e.shiftKey&&index===buttons.length-1))){e.preventDefault();setMenu(false);more.current?.focus()}
  }
 }}>
  <button disabled={disabled||busy||builtin} onClick={()=>open('replace')}>更换文件</button>
  <div className="library-more"><button ref={more} aria-label="更多文件操作" aria-expanded={menu} aria-controls="library-file-menu" disabled={disabled||busy||builtin} onClick={()=>setMenu(v=>!v)}>更多 ▾</button>{menu?createPortal(<div className="bid-ui library-ui library-menu-layer"><div ref={menuElement} id="library-file-menu" className="library-file-menu" style={{visibility:'hidden'}}>
   {kind!=='template'?<div className="library-menu-section" role="group" aria-label="文件处理"><div className="library-menu-heading" aria-hidden="true">文件处理</div><button onClick={()=>open('recognize')}><FileActionIcon name="refresh"/><span>{kind==='kb'?'重新识别':'重新解析来源文件'}</span></button></div>:null}
   <div className="library-menu-section" role="group" aria-label="删除"><div className="library-menu-heading" aria-hidden="true">删除</div>{block?<button className="library-menu-danger" onClick={()=>open('delete-block')}><FileActionIcon name="trash"/><span>删除当前素材</span></button>:null}<button className="library-menu-danger" onClick={()=>open('delete')}><FileActionIcon name={kind==='mt'?'folder-x':'trash'}/><span>{kind==='mt'?'删除来源文件及全部关联素材':'删除资料'}</span></button></div>
  </div></div>,document.body):null}</div>
  <Modal open={action!==null} onClose={close} label={title} role={action==='replace'?'dialog':'alertdialog'} width="600px"><div className={'library-ui library-file-dialog'+(action==='replace'?' library-pinned-dialog':'')} aria-busy={busy}><div className="modal-head"><h2>{title}</h2><button aria-label="关闭文件操作" disabled={busy} onClick={close}>×</button></div><div className="modal-body"><p className="library-action-file">{action==='delete-block'?block?.title:name}</p><p>{note}</p>{action==='replace'?<><div className="library-upload-drop" data-over={over} aria-disabled={busy||committed} onDragOver={e=>{e.preventDefault();if(!busy&&!committed)setOver(true)}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);if(busy||committed)return;if(e.dataTransfer.files.length>1){setError('每次请选择一个文件上传。');return}pick(e.dataTransfer.files[0])}}><span className="library-upload-symbol" aria-hidden="true">↑</span><strong>拖拽文件到这里，或点击选择</strong><span className="hint">{kind==='kb'?'DOCX / PDF / PNG / JPG / JPEG / GIF / WebP':'DOCX'} · {kind==='mt'?'文件大小不限':`单个文件不超过 ${kind==='template'?20:100} MB`}</span><button disabled={busy||committed} onClick={()=>input.current?.click()}>选择文件</button><input ref={input} hidden type="file" aria-label="选择替换文件" disabled={busy||committed} accept={kind==='kb'?'.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp':'.docx'} onChange={e=>{pick(e.target.files?.[0]);e.target.value=''}}/></div>{file?<div className="library-upload-file" role="status"><span className="file-icon">{file.name.split('.').at(-1)?.toUpperCase()}</span><div><b>{file.name}</b><span>{file.size<1024*1024?Math.max(1,Math.ceil(file.size/1024))+' KB':(file.size/1024/1024).toFixed(1)+' MB'} · 已选择，待上传</span></div><button className="text-button" disabled={busy||committed} aria-label="移除已选文件" onClick={()=>{setFile(null);setError('')}}>移除</button></div>:null}</>:null}{progress?<div className="library-upload-progress" role="status"><progress aria-label="替换文件传输进度" max={100} value={progress.total?Math.min(100,progress.loaded/progress.total*100):0}/><p>{progress.processing?'文件传输完成，正在校验并处理…':'正在上传新文件…'}</p></div>:null}{error?<div className="error" role="alert">{error}</div>:null}{committed&&error?<p>操作已完成，重新读取即可查看结果。</p>:null}</div><div className="modal-actions"><button disabled={busy} onClick={close}>取消</button><button className={action?.startsWith('delete')?'danger':'primary'} disabled={busy||(!committed&&disabled)||(!committed&&action==='replace'&&!file)} onClick={()=>void submit()}>{busy?'正在处理…':committed?'重新读取结果':action==='replace'?'确认更换并处理':action==='recognize'?'确认重新处理':'确认删除'}</button></div></div></Modal>
 </div>;
}
