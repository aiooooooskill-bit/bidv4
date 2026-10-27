import {useEffect,useState} from 'react';
import {FileActions} from './FileActions';
import {BASE} from '../../api';
import {SourcePreview} from '../SourcePreview';
import {api,Tag,type Shared} from './shared';
export function Templates({epoch,onSaved,onError,onDirty,dirty}:Shared){
 const [busy,setBusy]=useState(false);
 useEffect(()=>{onDirty(busy,busy);return()=>onDirty(false)},[busy]);
 const [items,setItems]=useState<{key:string;name:string;active:boolean;builtin:boolean;version:string}[]>([]),[selected,setSelected]=useState('');
 useEffect(()=>{let alive=true;api('/templates').then(r=>{if(alive){setItems(r);setSelected(old=>r.some((x:any)=>x.key===old)?old:r[0]?.key??'')}}).catch(onError);return()=>{alive=false}},[epoch]);
 const item=items.find(i=>i.key===selected);
 return <><div className="toolbar"><span className="hint">用于标书合册的页面与排版设置。</span></div><div className="split"><section className="list-pane">{items.map(i=><button disabled={dirty||busy} className={'record '+(selected===i.key?'selected':'')} key={i.key} onClick={()=>setSelected(i.key)}><b>{i.name}</b><Tag tone={i.active?'blue':'green'}>{i.active?'默认版式':'可用版式'}</Tag></button>)}</section><section className="detail-pane">{item?<><div className="detail-head"><h2>{item.name}</h2><div className="library-detail-actions"><button disabled={item.active||busy} onClick={async()=>{try{await api('/templates/'+encodeURIComponent(item.key)+'/activate','POST',{});onSaved('默认版式已更新。')}catch(e){onError(e)}}}>{item.active?'当前默认版式':'设为默认版式'}</button><FileActions key={item.key+item.version} kind="template" name={item.name} path={'/templates/'+encodeURIComponent(item.key)} versionQuery={'version='+encodeURIComponent(item.version)} builtin={item.builtin} disabled={busy} onBusyChange={setBusy} onChanged={message=>onSaved(message)}/></div></div><div className="library-source"><SourcePreview name={item.name+'.docx'} url={BASE+'/templates/'+encodeURIComponent(item.key)+'/raw?v='+encodeURIComponent(item.version)}/></div></>:<div className="empty">暂无 Word 版式，可上传 DOCX。</div>}</section></div></>
}
