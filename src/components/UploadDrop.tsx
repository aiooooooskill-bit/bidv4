import {useRef,useState,type DragEvent} from 'react';
import {uploadExtensions} from '../api';

export function UploadDrop({busy,onPick,label='招标文件',inputLabel,fileName,purpose='source'}:{busy:boolean;onPick:(file:File)=>void|Promise<void>;label?:string;inputLabel?:string;fileName?:string;purpose?:'source'|'bid'}){
 const input=useRef<HTMLInputElement>(null),[over,setOver]=useState(false);
 const pick=(file?:File)=>{if(file&&!busy)void onPick(file)};
 const drop=(e:DragEvent<HTMLDivElement>)=>{e.preventDefault();setOver(false);pick(e.dataTransfer.files[0])};
 return <div className="bp-upload-drop" data-over={over} aria-disabled={busy} role="button" tabIndex={busy?-1:0} onKeyDown={e=>{if(!busy&&(e.key==='Enter'||e.key===' ')){e.preventDefault();input.current?.click()}}} onDragOver={e=>{e.preventDefault();if(!busy)setOver(true)}} onDragLeave={()=>setOver(false)} onDrop={drop} onClick={()=>!busy&&input.current?.click()}><input ref={input} hidden aria-label={inputLabel??'上传'+label} disabled={busy} type="file" accept={uploadExtensions.join(',')} onChange={e=>{const file=e.target.files?.[0];e.target.value='';pick(file)}}/><span className="bp-upload-icon">⇧</span><b>{busy?'正在上传…':`拖拽${label}到这里，或点击选择`}</b>{fileName?<span className="bp-upload-name">{fileName}</span>:null}<small>支持 DOCX、PDF、XLS、XLSX、PNG、JPG、JPEG、GIF、WebP，{purpose==='bid'?'投标文件不设大小上限':'单个不超过100MB'}</small></div>
}
