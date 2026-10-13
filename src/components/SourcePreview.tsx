import {useEffect,useState} from 'react';
import {DocxViewer} from './DocxViewer';
import PdfPreviewBody from './PdfPreviewBody';
import {MarkdownDocument} from './MarkdownDocument';
import {reportError,clearNotice} from './NoticeCenter';
export function SourcePreview({name,url}:{name:string;url:string}){
  const ext=name.slice(name.lastIndexOf('.')).toLowerCase();
  const [text,setText]=useState<string|null>(null),[blob,setBlob]=useState<Blob|null>(null),[image,setImage]=useState<string|null>(null),[retry,setRetry]=useState(0),[failed,setFailed]=useState(false);
  useEffect(()=>{
    setFailed(false);
    if(ext==='.docx')return;
    const id='preview:'+url;let alive=true;let objectUrl:string|null=null;const controller=new AbortController();setBlob(null);setImage(null);setText(null);setFailed(false);
    fetch(url,{signal:controller.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error(`原件读取失败（HTTP ${r.status}）`);return r.blob()}).then(async b=>{if(!alive)return;clearNotice(id);if(ext==='.md'||ext==='.txt'){const content=await b.text();if(alive)setText(content)}else if(ext==='.pdf')setBlob(b);else{objectUrl=URL.createObjectURL(b);setImage(objectUrl)}}).catch(e=>{if(alive){setFailed(true);reportError(e,{id,title:'原件预览未完成',retry:()=>setRetry(n=>n+1)})}});
    return()=>{alive=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);clearNotice(id)};
  },[url,ext,retry]);
  const failure=(e:unknown)=>{setFailed(true);reportError(e,{id:'preview:'+url,title:'原件预览未完成',retry:()=>setRetry(n=>n+1)})};
  if(failed)return <div className="bp-empty"><button className="bp-btn" onClick={()=>setRetry(n=>n+1)}>重新读取原件</button></div>;
  if(ext==='.md'||ext==='.txt')return text!==null?<div className="work-document">{ext==='.md'?<MarkdownDocument content={text}/>:<pre>{text}</pre>}</div>:<div className="bp-empty">正在读取原件…</div>;
  if(ext==='.docx')return <DocxViewer key={url} src={url} fitWidth/>;
  if(ext==='.pdf')return blob?<PdfPreviewBody key={url+retry} data={blob} onError={failure}/>:<div className="bp-empty">正在读取原件…</div>;
  return image?<div className="source-img-root"><img src={image} alt={name} onError={()=>failure(new Error('图片无法解码，请检查原文件'))}/></div>:<div className="bp-empty">正在读取原件…</div>;
}
