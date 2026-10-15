import {useRef,useState} from 'react';
import {uploadFile,validateUpload,type UploadProgress} from '../../api';
import {Modal} from '../Modal';
import {CompanySelect,type Overview} from './shared';

export type UploadKind='kb'|'mt'|'template';
export function UploadSteps({steps,current}:{steps:string[];current:number}){
 return <ol className="library-upload-steps" aria-label="上传步骤">{steps.map((label,index)=><li key={label} className={index<current?'done':index===current?'current':''} aria-current={index===current?'step':undefined}><span>{index<current?'✓':index+1}</span>{label}</li>)}</ol>;
}
export function Upload({kind,overview,onClose,onDone}:{kind:UploadKind;overview:Overview;onClose:()=>void;onDone:(message:string,id?:string)=>void|Promise<void>}){
 const [company,setCompany]=useState(''),[file,setFile]=useState<File|null>(null),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[over,setOver]=useState(false),[error,setError]=useState(''),[uploaded,setUploaded]=useState<{id?:string}|null>(null),[progress,setProgress]=useState<UploadProgress|null>(null);
 const input=useRef<HTMLInputElement>(null),lock=useRef(false);
 const title=kind==='kb'?'公司资料':kind==='mt'?'写作素材':'Word 版式';
 const uploadTitle=kind==='template'?'上传 Word 版式':'上传'+title;
 const steps=kind==='kb'?['选择文件','确认归属','上传完成']:kind==='mt'?['上传文件','选择章节','保存素材']:['选择文件','确认上传','上传完成'];
 const formats=kind==='kb'?'DOCX / PDF / PNG / JPG / JPEG / GIF / WebP':'DOCX';
 const accept=kind==='kb'?'.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp':'.docx';
 const limit=kind==='template'?20:100;
 const message=kind==='kb'?'公司资料已上传，识别整理完成后请核对内容与归属。':kind==='mt'?'文件已上传，请选择章节并保存为素材。':'Word 版式已上传，可预览并设为默认版式。';
 const pick=(next?:File)=>{
  if(!next||lock.current)return;
  setError('');
  try{
   if(kind!=='mt')validateUpload(next);
   if(kind!=='kb'&&!next.name.toLowerCase().endsWith('.docx'))throw new Error('仅支持 DOCX 文件，请将文件另存为 .docx 后上传。');
   if(kind!=='mt'&&next.size>limit*1024*1024)throw new Error(`文件超过 ${limit} MB 上限。`);
   setFile(next);
  }catch(e){setFile(null);setError(e instanceof Error?e.message:String(e))}
 };
 const finish=async()=>{if(lock.current)return;if(uploaded){lock.current=true;setBusy(true);try{await onDone(message,kind==='mt'?uploaded.id:undefined)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}}else onClose()};
 const submit=async()=>{
  if(lock.current||!file||(kind==='kb'&&!company))return;
  lock.current=true;setBusy(true);setError('');setProgress({loaded:0,total:file.size,processing:false});
  try{
   const result=await uploadFile<{id?:string}>(kind==='kb'?'/kb/files?company_id='+encodeURIComponent(company):kind==='mt'?'/materials/files':'/templates',file,setProgress);
   setUploaded(result);setStep(2);
   if(kind==='mt')await onDone(message,result.id);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{lock.current=false;setBusy(false)}
 };
 return <Modal open onClose={()=>void finish()} label={uploadTitle} width="650px"><div className="library-ui library-upload-dialog" aria-busy={busy}><div className="modal-head"><div><h2>{uploadTitle}</h2><p>{kind==='kb'?'归档企业资料，识别后核对并用于项目':kind==='mt'?'将历史方案整理为可检索、可复用的章节':'保存常用 Word 页面与排版设置'}</p></div><button disabled={busy} aria-label="关闭上传窗口" onClick={()=>void finish()}>×</button></div><div className="modal-body"><UploadSteps steps={steps} current={step}/>
 {step===0?<><div className="library-upload-drop" data-over={over} aria-disabled={busy} onDragOver={e=>{e.preventDefault();if(!busy)setOver(true)}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);if(e.dataTransfer.files.length>1){setError('每次请选择一个文件上传。');return}pick(e.dataTransfer.files[0])}}><span className="library-upload-symbol" aria-hidden="true">↑</span><strong>拖拽文件到这里，或点击选择</strong><span className="hint">{formats} · {kind==='mt'?'文件大小不限':`单个文件不超过 ${limit} MB`}</span><button disabled={busy} onClick={()=>input.current?.click()}>选择文件</button><input ref={input} hidden aria-label="选择上传文件" type="file" disabled={busy} accept={accept} onChange={e=>{pick(e.target.files?.[0]);e.target.value=''}}/></div>{file?<div className="library-upload-file" role="status"><span className="file-icon">{file.name.split('.').at(-1)?.toUpperCase()}</span><div><b>{file.name}</b><span>{file.size<1024*1024?Math.max(1,Math.ceil(file.size/1024))+' KB':(file.size/1024/1024).toFixed(1)+' MB'} · 已选择，待上传</span></div><button className="text-button" disabled={busy} aria-label="移除已选文件" onClick={()=>{setFile(null);setError('')}}>移除</button></div>:null}<p className="library-upload-note">{kind==='kb'?'下一步确认资料所属主体。上传后进行识别整理，结果需要核对。':kind==='mt'?'上传后自动打开章节目录。勾选需要复用的章节，填写名称并保存后，才会进入素材列表与写作检索。':'下一步确认文件。同名版式将被替换；上传后可预览，再按需设为默认。'}</p></>:step===1?<><div className="library-upload-file"><span className="file-icon">{file?.name.split('.').at(-1)?.toUpperCase()}</span><div><b>{file?.name}</b><span>确认无误后上传</span></div></div>{kind==='kb'?<label className="full-field">资料所属主体<CompanySelect value={company} companies={overview.companies} onChange={setCompany} unassigned disabled={busy}/>{!overview.companies.length?<small>请先在“投标主体”中新增企业，再上传公司资料。</small>:null}</label>:null}<p className="library-upload-note">{kind==='kb'?'资料将归档到所选主体。识别整理在上传后继续进行，不代表资料已核对。':'此文件只提供页面、页眉页脚及排版样式，不作为写作内容素材。上传同名文件会替换原版式；默认版式仍由你选择。'}</p></>:<div className="library-upload-result" role="status"><span aria-hidden="true">✓</span><h3>{title}已上传</h3><p>{kind==='kb'?'文件已保存到所选主体。识别整理完成后，请在资料详情核对内容。':kind==='mt'?'原件已保存，可继续选择章节并建立素材。':'文件已保存到版式列表，可预览效果，并按需设为默认。'}</p><b>{file?.name}</b></div>}
 {busy&&!uploaded&&progress?<div className="library-upload-progress" role="status" aria-live="polite"><div><strong>{progress.processing?'文件已传输，正在处理':'正在上传文件'}</strong><span>{progress.total?Math.min(100,Math.floor(progress.loaded/progress.total*100)):0}%</span></div><progress aria-label="文件传输进度" max={100} value={progress.total?Math.min(100,Math.floor(progress.loaded/progress.total*100)):0}/><p>{progress.processing?(kind==='mt'?'正在解析章节目录，完成后会自动打开章节选择。':kind==='kb'?'正在保存资料，之后会继续识别整理。':'正在校验 Word 文件并保存版式。'):`已传输 ${(progress.loaded/1024/1024).toFixed(1)} / ${(progress.total/1024/1024).toFixed(1)} MB`}</p></div>:busy?<p className="hint" role="status">正在更新列表…</p>:null}{error?<div role="alert" className="error">{error}</div>:null}</div><div className="modal-actions">{step===2?<button className="primary" disabled={busy} onClick={()=>void finish()}>{kind==='kb'?'查看公司资料':kind==='mt'?'继续选择章节':'查看 Word 版式'}</button>:<><button disabled={busy} onClick={()=>step===1?setStep(0):onClose()}>{step===1?'上一步':'取消'}</button><button className="primary" disabled={busy||!file||(step===1&&kind==='kb'&&!company)} onClick={()=>kind!=='mt'&&step===0?setStep(1):void submit()}>{busy?'正在上传…':kind==='mt'?'上传并选择章节':step===0?'下一步':kind==='kb'?'确认归属并上传':'确认上传'}</button></>}</div></div></Modal>;
}
