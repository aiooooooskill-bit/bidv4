import {useState} from 'react';
import {Modal} from './Modal';
import {NUMBERING_OPTIONS} from '../lib/directoryNumbering';
import type {DirectoryData} from '../lib/directoryTree';

export interface OutlineOptions {page_target:number|null;numbering:NonNullable<DirectoryData['numbering']>}
export function OutlineOptionsDialog({value,busy,onClose,onSubmit}:{value?:DirectoryData;busy:boolean;onClose:()=>void;onSubmit:(options:OutlineOptions)=>Promise<boolean>}){
 const [unlimited,setUnlimited]=useState(value?.page_target===null);
 const [pages,setPages]=useState(String(value?.page_target??120));
 const [numbering,setNumbering]=useState<OutlineOptions['numbering']>(value?.numbering??'decimal');
 const valid=unlimited||(Number.isInteger(Number(pages))&&Number(pages)>=1&&Number(pages)<=1000);
 return <Modal open onClose={()=>{if(!busy)onClose()}} label={value?'智能调整目录':'智能生成目录'} width="600px">
  <div className="outline-options"><h2>{value?'智能调整目录':'智能生成目录'}</h2>
   <fieldset disabled={busy}><legend>目标篇幅</legend><div className="page-presets">{[50,80,120,150,200,250].map(n=><button type="button" className="bp-btn" data-active={!unlimited&&Number(pages)===n} key={n} onClick={()=>{setUnlimited(false);setPages(String(n))}}>{n} 页</button>)}</div>
    <label className="page-custom">自定义页数<input aria-label="目标篇幅页数" type="number" min={1} max={1000} disabled={unlimited} value={pages} onChange={e=>setPages(e.target.value)}/></label>
    <label className="page-unlimited"><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)}/>不限篇幅</label>
    <p>{unlimited?'按招标要求与响应完整性安排篇幅。':'目标篇幅用于目录规划和正文篇幅分配，实际 Word 页数随内容与排版变化。'}</p>
   </fieldset>
   <fieldset disabled={busy}><legend>编号方式</legend><div className="numbering-options">{NUMBERING_OPTIONS.map(o=><label key={o.value}><input type="radio" name="outline-numbering" checked={numbering===o.value} onChange={()=>setNumbering(o.value)}/>{o.label}</label>)}</div></fieldset>
   {value?<p>按当前已保存目录调整。已有正文保留，生成后可查看受影响章节。</p>:null}
   <div className="dialog-actions"><button className="bp-btn" disabled={busy} onClick={onClose}>取消</button><button className="bp-btn" data-kind="primary" disabled={busy||!valid} onClick={async()=>{if(await onSubmit({page_target:unlimited?null:Number(pages),numbering}))onClose()}}>{busy?'提交中…':'确认并生成'}</button></div>
  </div>
 </Modal>;
}
