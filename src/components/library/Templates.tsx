import {useEffect,useState} from 'react';
import {BASE,request} from '../../api';
import {SourcePreview} from '../SourcePreview';
import {api,type Shared} from './shared';
export function Templates({epoch,onSaved,onError}:Shared){
 const [items,setItems]=useState<{key:string;name:string;active:boolean}[]>([]),[selected,setSelected]=useState('');
 useEffect(()=>{let alive=true;api('/templates').then(r=>{if(alive){setItems(r);setSelected(old=>r.some((x:any)=>x.key===old)?old:r[0]?.key??'')}}).catch(onError);return()=>{alive=false}},[epoch]);
 const item=items.find(i=>i.key===selected);
 return <><div className="toolbar"><label className="button">上传 Word 版式<input hidden type="file" accept=".docx" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;try{const body=new FormData();body.append('file',f);await request('/templates',{method:'POST',body});onSaved('Word 版式已上传。')}catch(e){onError(e)}}}/></label><span className="hint">用于标书合册的页面与排版设置。</span></div><div className="split"><section className="list-pane">{items.map(i=><button className={'record '+(selected===i.key?'selected':'')} key={i.key} onClick={()=>setSelected(i.key)}><b>{i.name}</b><span>{i.active?'默认版式':'可用版式'}</span></button>)}</section><section className="detail-pane">{item?<><div className="detail-head"><h2>{item.name}</h2><button disabled={item.active} onClick={async()=>{try{await api('/templates/'+encodeURIComponent(item.key)+'/activate','POST',{});onSaved('默认版式已更新。')}catch(e){onError(e)}}}>{item.active?'当前默认版式':'设为默认版式'}</button></div><div className="library-source"><SourcePreview name={item.name+'.docx'} url={BASE+'/templates/'+encodeURIComponent(item.key)+'/raw'}/></div></>:<div className="empty">暂无 Word 版式，可上传 DOCX。</div>}</section></div></>
}
