import type {DirectoryData} from './lib/directoryTree';
import type {AnalysisProgress} from '../shared/analysis-progress.js';
export const BASE='/api/bidv4';
export type Stage='new'|'parsed'|'analyzed'|'outlined'|'drafting'|'delivered';
export interface Task {id:string;title:string;created_at:string;stage:Stage;last_activity_at?:string}
export interface SourceFile {name:string;size:number;modified_at:string}
export interface WorkFile {path:string;content:string;hash:string;registry?:DirectoryData['registry']}
export interface WorkEntry {path:string;size:number;mtime:string}
export interface PageQuestion {callId:string;state:'open'|'continued';questions:Array<{id:string;header?:string;question:string;options?:Array<{label:string;description?:string}>;multiSelect?:boolean}>}
export interface Execution {session_id:string;kind:string;sections?:Array<{volume:string;title:string}>;state:'running'|'needs_input'|'completed'|'failed'|'stopped';error?:string;questions:PageQuestion[]}
export interface Artifact {artifact_id:string;display_name:string;kind:string;content_seq:number;updated_at:string}
export interface BodySection {volume:string;title:string;path:string;status:'missing'|'ready'|'stale'|'unverified'|'draft'}
export interface VolumeState {name:string;path:string;artifact_id:string|null;status:'missing'|'ready'|'stale'}
export interface Bidder {company_id?:string;signer_id?:string;sign_date?:string;revision:number;confirmed:boolean;stale:boolean;snapshot:{company:{name:string;profile:Record<string,string>};signer:{name:string};sign_date:string}|null}
export interface Flow {bidder?:Bidder;task:Task;execution:Execution|null;analysis_progress:AnalysisProgress[];files:WorkFile[];directory:{artifact_id:string;content_seq:number;content:DirectoryData}|null;source_selection:{main:string;supplements:Array<{file:string;role:string}>;excluded:string[]};body_files:string[];body_sections:BodySection[];build_preparation:{guide:'ready'|'missing'|'stale';promises:'ready'|'missing'|'stale'};build_preparation_changes?:{guide:string[];promises:string[]};orphan_body_files:string[];volume_states:VolumeState[];input_versions:Record<string,string>}
export class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
export async function request<T>(path:string, options:RequestInit={}):Promise<T> {
  const response=await fetch(BASE+path,{cache:'no-store',...options});
  if(!response.ok){const data=await response.json().catch(()=>null);throw new ApiError(response.status,typeof data?.detail==='string'?data.detail:`请求未完成（HTTP ${response.status}）`)}
  return response.json() as Promise<T>;
}
export const json=(method:string,body:unknown):RequestInit=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export const params=(values:Record<string,string>)=>new URLSearchParams(values).toString();
export const sourceUrl=(tid:string,file:SourceFile)=>`${BASE}/files/${encodeURIComponent(file.name)}/raw?${params({task_id:tid,v:file.modified_at+':'+file.size})}`;
export const bodyUrl=(tid:string,path:string,version:string)=>`${BASE}/workbench/raw?${params({task_id:tid,path,v:version})}`;
export const uploadExtensions=['.docx','.pdf','.png','.jpg','.jpeg','.gif','.webp'];
export const MAX_UPLOAD_BYTES=100*1024*1024;
export function validateUpload(file:Pick<File,'name'|'size'>){const ext=file.name.slice(file.name.lastIndexOf('.')).toLowerCase();if(!uploadExtensions.includes(ext))throw new ApiError(415,'仅支持 DOCX、PDF、PNG、JPG、JPEG、GIF、WebP');if(file.size>MAX_UPLOAD_BYTES)throw new ApiError(413,'文件超过100MB上限')}
