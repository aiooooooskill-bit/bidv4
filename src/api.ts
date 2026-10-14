import type {DirectoryData} from './lib/directoryTree';
import type {AnalysisProgress} from '../shared/analysis-progress.js';
export const BASE='/api/bidv4';
export type Stage='new'|'parsed'|'analyzed'|'outlined'|'drafting'|'delivered';
export interface Task {id:string;title:string;created_at:string;stage:Stage;last_activity_at?:string;review_status?:ReviewState['status'];review_mode?:'platform'|'external'}
export interface SourceFile {name:string;size:number;modified_at:string}
export interface WorkFile {path:string;content:string;hash:string;registry?:DirectoryData['registry']}
export interface WorkEntry {path:string;size:number;mtime:string}
export interface PageQuestion {callId:string;state:'open'|'continued';questions:Array<{id:string;header?:string;question:string;options?:Array<{label:string;description?:string}>;multiSelect?:boolean}>}
export interface Execution {session_id:string;kind:string;sections?:Array<{volume:string;title:string}>;state:'running'|'needs_input'|'completed'|'failed'|'stopped';error?:string;questions:PageQuestion[]}
export interface Artifact {artifact_id:string;display_name:string;kind:string;content_seq:number;updated_at:string}
export interface BodySection {volume:string;title:string;path:string;status:'missing'|'ready'|'stale'|'unverified'|'draft'}
export interface VolumeState {name:string;path:string;artifact_id:string|null;status:'missing'|'ready'|'stale'}
export interface Bidder {company_id?:string;signer_id?:string;sign_date?:string;revision:number;confirmed:boolean;stale:boolean;snapshot:{company:{name:string;profile:Record<string,string>};signer:{name:string};sign_date:string}|null}
export interface ReviewEvidence {document_id:string;start:number;end:number;quote:string}
export type ReviewRiskType = 'disqualification'|'scoring'|'confirmation'|'suggestion';
export interface ReviewReport {summary:string;requirements:Array<{id:string;category:string;text:string;status:'responded'|'missing'|'uncertain'|'conflict'|'informational';tender:ReviewEvidence[];bid:ReviewEvidence[]}>;issues:Array<{id:string;requirement_id:string;risk_type:ReviewRiskType;title:string;explanation:string;suggestion:string}>;coverage:Array<{category:string;note:string}>;limitations:string[]}
export type ReviewPreviousFlow = {mode:'external';note:string}|{mode:'platform';directory:Flow['directory'];analysis_files:Array<{key:string;path:string;sha256:string}>;analysis_note:string;planning:Array<{kind:'guide'|'promises';status:'ready'|'missing'|'stale';path:string;changes:string[]}>;chapters:BodySection[];orphan_body_files:string[];bidder:{confirmed:boolean;stale:boolean;snapshot:Bidder['snapshot']}};
export interface ReviewState {mode:'platform'|'external';bids:string[];status:'unreviewed'|'running'|'needs_input'|'reviewed'|'stale'|'failed'|'stopped';input_version:string;report:{audit:{batches:number;requirements:number;assessments:Record<string,string>};method:{name:string;source_commit:string;version:string};analysis:{previous_flow:ReviewPreviousFlow;clarifications:string[];validation:string;reused_platform_analysis:boolean;catalog:Array<{id:string;category:string;text:string}>};checks:Array<{name:string;status:string;detail:string}>;session_id:string;created_at:string;input_version:string;report:ReviewReport;documents:Array<{id:string;name:string;kind:'tender'|'bid'}>;decisions:Record<string,{status:'pending'|'confirmed'|'fixed'|'ignored';note:string}>}|null}
export interface Flow {review:ReviewState;bidder?:Bidder;task:Task;execution:Execution|null;analysis_progress:AnalysisProgress[];files:WorkFile[];directory:{artifact_id:string;content_seq:number;content:DirectoryData}|null;source_selection:{main:string;supplements:Array<{file:string;role:string}>;excluded:string[]};body_files:string[];body_sections:BodySection[];build_preparation:{guide:'ready'|'missing'|'stale';promises:'ready'|'missing'|'stale'};build_preparation_changes?:{guide:string[];promises:string[]};orphan_body_files:string[];volume_states:VolumeState[];input_versions:Record<string,string>}
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
export function validateUpload(file:Pick<File,'name'|'size'>,purpose:'source'|'bid'='source'){const ext=file.name.slice(file.name.lastIndexOf('.')).toLowerCase();if(!uploadExtensions.includes(ext))throw new ApiError(415,'仅支持 DOCX、PDF、PNG、JPG、JPEG、GIF、WebP');if(purpose==='source'&&file.size>MAX_UPLOAD_BYTES)throw new ApiError(413,'文件超过100MB上限')}
