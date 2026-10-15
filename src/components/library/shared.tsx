import React from 'react';
import {request,json,BASE} from '../../api';
export type Company={id:string;name:string;credit_code:string;note:string;profile:Record<string,string>;revision:number};
export type Representative={id:string;name:string;title:string;phone:string;email:string;note:string;revision:number};
export type Metadata={doc_type:string;statement?:string;questions?:string[];fields?:Record<string,{value:string;source?:string}>;extra?:Record<string,{value:string;source?:string}>;confidence?:number};
export type Kb={id:string;title:string;file_name:string;doc_type:string;company_id:string;review_status:string;parse_status:string;extract_status:string;updated_at:string;error?:string;business:Metadata;suggested:Metadata;ocr:string;original_ocr:string;content:string;original_content:string;revision:number;meta:Record<string,any>;segments:any[]};
export type Overview={companies:Company[];representatives:Representative[];types:{code:string;name:string}[];field_labels:Record<string,string>};
export type Page<T>={items:T[];total:number;page:number;pages:number;page_size:number};
export type Shared={overview:Overview;dirty:boolean;onDirty:(v:boolean,saving?:boolean)=>void;onSaved:(m:string)=>void|Promise<void>;onError:(e:any)=>void;epoch:number};
export const encode=(v:Record<string,unknown>)=>new URLSearchParams(Object.entries(v).map(([k,x])=>[k,String(x??'')])).toString();
export function api<T=any>(path:string,method='GET',body?:unknown):Promise<T>{return request(path,body===undefined?{}:json(method,body))}
export const stamp=(s:string)=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
export const cx=(x:string)=>x==='confirmed'?'已核对':x==='ready'?'已解析':x==='failed'?'解析失败':x==='pending'?'待识别':x==='parsing'?'正在识别':'待核对';
export function Tag({children,tone=''}:{children:React.ReactNode;tone?:string}){return <span className={'tag '+tone}>{children}</span>}

export function CompanySelect({value,onChange,companies,all=false,unassigned=false,disabled=false,label='所属主体'}:{value:string;onChange:(v:string)=>void;companies:Company[];all?:boolean;unassigned?:boolean;disabled?:boolean;label?:string}){return <select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{all?<option value="all">全部主体</option>:null}{unassigned?<option value={all?'unassigned':''}>{all?'待确认归属':'请选择所属主体'}</option>:null}{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}
