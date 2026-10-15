import {Pager} from '../Pager';
import {useConflictRecovery} from './ConflictRecovery';
import {useEffect,useState} from 'react';
import {api,type Representative,type Page,type Overview,type Shared} from './shared';
export function Representatives({overview,dirty,onDirty,onSaved,onError}:Shared){
 const [selected,setSelected]=useState(''),[creating,setCreating]=useState(false),[pagination,setPagination]=useState({page:1,size:5});
 const filtered=overview.representatives;
 const pages=Math.max(1,Math.ceil(filtered.length/pagination.size)),currentPage=Math.min(pagination.page,pages);
 const page:Page<Representative>={items:filtered.slice((currentPage-1)*pagination.size,currentPage*pagination.size),total:filtered.length,page:currentPage,pages,page_size:pagination.size};
 const rep=page.items.find(r=>r.id===selected)??page.items[0];
 // Keep a newly saved representative visible in the correct list page.
 useEffect(()=>{
  const saved=overview.representatives.find(r=>r.id===selected);if(!saved)return;
  const index=filtered.findIndex(r=>r.id===selected),targetPage=Math.floor(index/pagination.size)+1;
  if(index>=0)setPagination(p=>p.page===targetPage?p:{...p,page:targetPage});
 },[overview.representatives,selected,pagination.size]);
 return <><div className="toolbar"><p className="hint">授权代表独立维护、全库共用，可在任意投标主体的项目中选择。</p></div><div className="split"><section className="list-pane"><div className="list-heading"><strong>授权代表</strong><button disabled={dirty} onClick={()=>{setCreating(true);setSelected('')}}>＋ 新增</button></div><div className="records">{page.items.map(r=><button disabled={dirty} key={r.id} className={'record '+(!creating&&rep?.id===r.id?'selected':'')} onClick={()=>{setSelected(r.id);setCreating(false)}}><b>{r.name}</b><span className="record-sub">{r.title||'职务待补充'}</span></button>)}{!page.total?<div className="empty">暂无授权代表，可点击上方新增。</div>:null}</div><Pager page={page} disabled={dirty||creating} onChange={(page,size)=>{setPagination({page,size});setSelected('')}}/></section><section className="detail-pane">{rep||creating?<RepresentativeDetail key={creating?'new':rep?.id+':'+rep?.revision} rep={creating?undefined:rep} onDirty={onDirty} onSaved={async(message,id)=>{await onSaved(message);setSelected(id);setCreating(false)}} onError={onError}/>:<div className="empty">选择授权代表，或新增授权代表。</div>}</section></div></>
}

function RepresentativeDetail({rep:initialRep,onDirty,onSaved,onError}:{rep?:Representative;onDirty:(v:boolean,saving?:boolean)=>void;onSaved:(m:string,id:string)=>void|Promise<void>;onError:(e:any)=>void}){
 const {base:rep,fail,recovery,isActive,blocked}=useConflictRecovery(initialRep,async()=>{const r=await api<Overview>('/library/overview');const latest=r.representatives.find(x=>x.id===initialRep?.id);if(!latest)throw new Error('代表已不存在');return latest},onError,(r):Record<string,string>=>r?{'姓名':r.name,'职务':r.title,'联系电话':r.phone,'电子邮箱':r.email,'备注':r.note}:{});
 const blank={id:'',name:'',title:'',phone:'',email:'',note:'',revision:0};const base=rep??blank;
 const [draft,setDraft]=useState(base),[busy,setBusy]=useState(false);const dirty=JSON.stringify(draft)!==JSON.stringify(base);
 useEffect(()=>{onDirty(dirty||busy,busy);return()=>onDirty(false)},[dirty,busy]);
 return <><div className="detail-head"><div><h2>{rep?'授权代表信息':'新增授权代表'}</h2><p>所有投标主体共用此名单，具体授权范围在项目中确认</p></div></div><div className="detail-scroll">{recovery}<div className="form-grid">{[['name','姓名'],['title','职务'],['phone','联系电话'],['email','电子邮箱']].map(([key,label])=><label key={key}>{label}<input disabled={busy} aria-label={'代表'+label} value={draft[key as keyof Representative]} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))}/></label>)}</div><label className="full-field">授权说明 / 备注<textarea disabled={busy} value={draft.note} rows={4} onChange={e=>setDraft(d=>({...d,note:e.target.value}))}/></label><div className="inline-note">基础信息可复用；每个项目的授权范围、签署日期与授权书仍需要按招标要求确定。</div></div><div className="save-bar"><span>{dirty?'有未保存修改':'全库共用授权代表'}</span><button disabled={!dirty||busy} onClick={()=>setDraft(base)}>取消修改</button><button className="primary" disabled={!draft.name.trim()||busy||blocked} onClick={async()=>{setBusy(true);try{const r=await api('/library/representatives','POST',{...draft,revision:base.revision,id:draft.id||undefined});if(!isActive())return;await onSaved('授权代表已保存，可在制作准备中选择。',r.id)}catch(e){fail(e)}finally{if(isActive())setBusy(false)}}}>保存授权代表</button></div></>
}
