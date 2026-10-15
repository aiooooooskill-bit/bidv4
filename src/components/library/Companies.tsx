import {Pager} from '../Pager';
import {useConflictRecovery} from './ConflictRecovery';
import React,{useEffect,useRef,useState} from 'react';
import {BASE} from '../../api';
import {SourcePreview} from '../SourcePreview';
import {api,encode,stamp,cx,Tag,CompanySelect,type Company,type Representative,type Kb,type Page,type Metadata,type Overview,type Shared} from './shared';
const PROFILE_ALIASES:Record<string,string>={
 company_name:'name','持证单位':'name','企业名称':'name','公司名称':'name','公司全称':'name','账户名称':'name',
 '统一社会信用代码':'credit_code','社会信用代码':'credit_code',
 '注册地址':'registered_address','住所':'registered_address','注册住所':'registered_address',
 '通讯地址':'address','联系地址':'address','公司地址':'address',
 '联系电话':'phone','电话':'phone','传真':'fax','传真号码':'fax','企业邮箱':'email','电子邮箱':'email','邮箱':'email',
 '法定代表人':'legal_name','法人':'legal_name','法人姓名':'legal_name',legal_person:'legal_name','法定代表人职务':'legal_title',
 '开户行':'bank_name','开户银行':'bank_name','银行名称':'bank_name','银行账号':'bank_account','账号':'bank_account'
};
export const PROFILE_FIELDS:[string,string][]=[['registered_address','注册地址'],['address','通讯地址（标书默认）'],['phone','联系电话'],['fax','传真'],['email','企业邮箱'],['legal_name','法定代表人姓名'],['legal_title','法定代表人职务'],['bank_name','开户银行'],['bank_account','银行账号']];
export function Companies({overview,dirty,onDirty,onSaved,onError}:Shared){
 const [selected,setSelected]=useState(overview.companies[0]?.id??''),[creating,setCreating]=useState(false);
 const company=overview.companies.find(c=>c.id===selected);
 return <div className="split company-split"><section className="list-pane"><div className="list-heading"><strong>投标主体</strong><button disabled={dirty} onClick={()=>{setCreating(true);setSelected('')}}>＋ 新增</button></div>
 {overview.companies.map(c=><button disabled={dirty} className={'record '+(selected===c.id?'selected':'')} key={c.id} onClick={()=>{setCreating(false);setSelected(c.id)}}><b>{c.name}</b><span className="record-sub">{c.credit_code||'统一社会信用代码待补充'}</span><p>{c.note}</p><div className="record-tags"><Tag>{PROFILE_FIELDS.filter(([key])=>c.profile[key]).length} 项基础信息</Tag></div></button>)}
 </section><section className="detail-pane">{company||creating?<CompanyDetail key={(company?.id??'new')+':'+(company?.revision??0)} company={company} onDirty={onDirty} onSaved={async(message,id)=>{await onSaved(message);setCreating(false);setSelected(id)}} onError={onError}/>:<div className="empty">选择主体查看，或新增投标主体。</div>}</section></div>
}
function CompanyDetail({company:initialCompany,onDirty,onSaved,onError}:{company?:Company;onDirty:(v:boolean,saving?:boolean)=>void;onSaved:(message:string,id:string)=>void|Promise<void>;onError:(e:any)=>void}){
 const {base:company,fail,recovery,isActive,blocked}=useConflictRecovery(initialCompany,async()=>{const r=await api<Overview>('/library/overview');const latest=r.companies.find(c=>c.id===initialCompany?.id);if(!latest)throw new Error('主体已不存在');return latest},onError,(c):Record<string,string>=>c?{'公司全称':c.name,'统一社会信用代码':c.credit_code,...Object.fromEntries(PROFILE_FIELDS.map(([key,label])=>[label,c.profile[key]??''])),'备注':c.note}:{});
 const [name,setName]=useState(company?.name??''),[code,setCode]=useState(company?.credit_code??''),[note,setNote]=useState(company?.note??''),[profile,setProfile]=useState(company?.profile??{}),[busy,setBusy]=useState(false),[suggestions,setSuggestions]=useState<{key:string;label:string;value:string;source:string;id:string;revision:number}[]|null>(null);
 const dirty=name!==(company?.name??'')||code!==(company?.credit_code??'')||note!==(company?.note??'')||JSON.stringify(profile)!==JSON.stringify(company?.profile??{});
 useEffect(()=>{onDirty(dirty||busy,busy);return()=>onDirty(false)},[dirty,busy]);
 const clearSource=(key:string)=>setProfile(old=>{const next={...old};for(const prefix of ['source:','source-id:','source-revision:'])delete next[prefix+key];return next});
 const reset=()=>{setName(company?.name??'');setCode(company?.credit_code??'');setNote(company?.note??'');setProfile(company?.profile??{})};
 const save=async()=>{setBusy(true);try{const result=await api('/library/companies','POST',{id:company?.id,revision:company?.revision??0,name,credit_code:code,note,profile});if(!isActive())return;await onSaved('主体基础信息已保存，可在标书制作前自动读取。',result.id)}catch(e){fail(e)}finally{if(isActive())setBusy(false)}};
 return <><div className="detail-head"><div><h2>{company?'主体基础信息':'新增投标主体'}</h2><p>公司常用信息一次维护，制作时按选定主体读取</p></div><Tag>资料库维护</Tag></div><div className="detail-scroll">{recovery}
 <div className="form-grid"><label>公司全称<input disabled={busy} aria-label="公司全称" value={name} onChange={e=>{setName(e.target.value);clearSource('name')}}/></label><label>统一社会信用代码<input disabled={busy} aria-label="统一社会信用代码" value={code} onChange={e=>{setCode(e.target.value);clearSource('credit_code')}} placeholder="依据营业执照填写"/></label></div>
 <div className="section-head"><h3>联系信息与法定代表人</h3>{company?<button disabled={busy} onClick={async()=>{try{const r=await api('/library/companies/'+company.id+'/candidates').then(r=>({suggestions:r.items.flatMap((i:any)=>Object.entries({...i.metadata.fields,...i.metadata.extra}).map(([key,v]:[string,any])=>({key:PROFILE_ALIASES[key]??key,label:key,value:v.value,source:i.file_name+' · '+(v.source??'未标注出处'),id:i.id,revision:i.revision})).filter((x:any)=>['name','credit_code'].includes(x.key)||PROFILE_FIELDS.some(([key])=>key===x.key)))}));setSuggestions(r.suggestions)}catch(e){onError(e)}}}>从已核对资料取值</button>:null}</div>
 <p className="hint">地址、电话、传真、邮箱从这里读取，制作过程中不重复询问已有信息。传真没有时可填写“无”。</p>
 {suggestions!==null?<div className="suggestions"><b>资料中的候选值 · 逐项采用</b>{!suggestions.length?<p>没有已核对并归属本主体的资料。先到公司资料核对并保存。</p>:suggestions.map((x,i)=><div className="suggestion" key={i}><span><b>{PROFILE_FIELDS.find(([key])=>key===x.key)?.[1]??x.label}：{x.value}</b><small>{x.source} · 证件可能反映历史信息，请核对现状</small></span><button disabled={busy} onClick={()=>{if(x.key==='name'){setName(x.value);setProfile(v=>({...v,'source:name':x.source,'source-id:name':x.id,'source-revision:name':String(x.revision)}))}else if(x.key==='credit_code'){setCode(x.value);setProfile(v=>({...v,'source:credit_code':x.source,'source-id:credit_code':x.id,'source-revision:credit_code':String(x.revision)}))}else setProfile(v=>({...v,[x.key]:x.value,['source:'+x.key]:x.source,['source-id:'+x.key]:x.id,['source-revision:'+x.key]:String(x.revision)}))}}>采用此值</button></div>)}</div>:null}
 <div className="form-grid profile-grid">{PROFILE_FIELDS.map(([key,label])=><label key={key}>{label}<input disabled={busy} aria-label={label} value={profile[key]??''} onChange={e=>setProfile(v=>{const next={...v,[key]:e.target.value};delete next['source-id:'+key];delete next['source-revision:'+key];delete next['source:'+key];return next})} placeholder={key==='fax'?'没有传真可填“无”':'尚未维护'}/></label>)}</div>
 <label className="full-field">备注<textarea disabled={busy} rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label>
 <div className="inline-note">公司资料保存的是每份证件的识别结果；主体基础信息保存的是核对后的常用信息。原件和历史识别值始终保留，不自动覆盖。</div>
 </div><div className="save-bar"><span>{dirty?'有未保存修改':'修改后可供制作读取'}</span><button disabled={!dirty||busy} onClick={reset}>取消修改</button><button className="primary" disabled={busy||blocked||!name.trim()} onClick={()=>void save()}>{busy?'保存中…':'保存主体信息'}</button></div></>
}
