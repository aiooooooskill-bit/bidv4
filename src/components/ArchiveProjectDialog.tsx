import {useState} from 'react';
import {Modal} from './Modal';

export function ArchiveProjectDialog({title,busy,onClose,onConfirm}:{
 title:string;busy:boolean;onClose:()=>void;onConfirm:()=>void;
}){
 const [expanded,setExpanded]=useState(false);
 const characters=Array.from(title),truncated=characters.length>5;
 const close=()=>{if(!busy)onClose()};
 return <Modal open onClose={close} width="440px" label="归档项目">
  <section className="bp-archive-dialog" aria-busy={busy}>
   <header className="bp-archive-head">
    <span className="bp-archive-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v4H4zM6 8v12h12V8M10 12h4"/></svg></span>
    <h2>归档项目</h2>
    <button type="button" className="bp-archive-close" aria-label="关闭归档弹窗" disabled={busy} onClick={close}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
   </header>
   <div className="bp-archive-copy">
    <p>确定归档「{truncated?<button type="button" className="bp-archive-name" title={title} aria-label={`查看项目全称：${title}`} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{characters.slice(0,5).join('')}…</button>:<span>{title}</span>}」？</p>
    {truncated?<div className="bp-archive-full" hidden={!expanded}>{title}</div>:null}
    <p>归档后，项目将从当前列表移除。</p>
    <div className="bp-archive-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM8 12l3 3 5-6"/></svg>原文件与已有成果将保留</div>
   </div>
   <footer className="bp-archive-actions">
    <button type="button" className="bp-btn" disabled={busy} data-modal-autofocus onClick={close}>取消</button>
    <button type="button" className="bp-btn" data-kind="primary" disabled={busy} onClick={()=>{if(!busy)onConfirm()}}>{busy?'正在归档…':'确认归档'}</button>
   </footer>
  </section>
 </Modal>;
}
