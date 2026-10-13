import {useCallback,useEffect,useState} from 'react';
import {request,validateUpload} from '../api';
import {useNavigationGuard} from '../components/NavigationGuard';
import {Modal} from '../components/Modal';
import {Knowledge} from '../components/library/Knowledge';
import {Companies} from '../components/library/Companies';
import {Representatives} from '../components/library/Representatives';
import {Materials} from '../components/library/Materials';
import {Templates} from '../components/library/Templates';
import {api,CompanySelect,type Overview} from '../components/library/shared';
export function Library(){
 const [overview,setOverview]=useState<Overview|null>(null),[tab,setTab]=useState('knowledge'),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[epoch,setEpoch]=useState(0),[upload,setUpload]=useState(false);
 const guard=useNavigationGuard();
 const reload=useCallback(async()=>{try{const [entities,types]=await Promise.all([api('/library/overview'),api('/kb/types')]);setOverview({...entities,...types});setEpoch(x=>x+1)}catch(e){setError(e instanceof Error?e.message:String(e))}},[]);
 useEffect(()=>{void reload()},[reload]);
 const onDirty=useCallback((value:boolean,busy=false)=>{setDirty(value);setSaving(busy);guard.mark('library',value)},[guard.mark]);
 useEffect(()=>()=>guard.mark('library',false),[guard.mark]);
 const success=async(message:string)=>{setNotice(message);setError('');await reload()};
 const fail=(e:unknown)=>{setError(e instanceof Error?e.message:String(e));setNotice('')};
 const shared={overview:overview!,dirty,onDirty,onSaved:success,onError:fail,epoch};
 return <div className="library-ui"><main><div className="page-title"><div><h1>资料库</h1><p>核对公司资料，维护投标主体，复用写作素材。</p></div>{['knowledge','materials'].includes(tab)?<button className="primary" disabled={dirty} onClick={()=>setUpload(true)}>＋ 上传{tab==='knowledge'?'公司资料':'写作素材'}</button>:null}</div><nav className="tabs" aria-label="资料库栏目">{[['companies','投标主体'],['representatives','授权代表'],['knowledge','公司资料'],['materials','写作素材'],['templates','Word版式']].map(([id,label])=><button key={id} disabled={saving} className={tab===id?'active':''} onClick={()=>{if(id===tab)return;guard.navigate(()=>{setTab(id);setNotice('');setError('')})}}>{label}</button>)}</nav>{dirty?<div className="draft-notice">详情有未保存修改，请先保存或取消。</div>:null}{error?<div className="error" role="alert">{error}<button disabled={dirty} onClick={()=>{setError('');void reload()}}>重新读取</button></div>:notice?<div className="notice" role="status">{notice}<button onClick={()=>setNotice('')}>关闭</button></div>:null}{!overview?<div className="empty">正在读取资料库…</div>:tab==='companies'?<Companies {...shared}/>:tab==='representatives'?<Representatives {...shared}/>:tab==='knowledge'?<Knowledge {...shared}/>:tab==='materials'?<Materials {...shared}/>:<Templates {...shared}/>}</main>{upload&&overview?<Upload kind={tab==='knowledge'?'kb':'mt'} overview={overview} onClose={()=>setUpload(false)} onDone={m=>{setUpload(false);success(m)}}/>:null}</div>
}
function Upload({kind,overview,onClose,onDone}:{kind:'kb'|'mt';overview:Overview;onClose:()=>void;onDone:(m:string)=>void}){
 const [company,setCompany]=useState(''),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <Modal open onClose={()=>!busy&&onClose()} label="上传资料" width="650px"><div className="library-ui"><div className="modal-head"><h2>上传{kind==='kb'?'公司资料':'写作素材'}</h2></div><div className="modal-body">{kind==='kb'?<label className="full-field">资料所属主体<CompanySelect value={company} companies={overview.companies} onChange={setCompany} unassigned disabled={busy}/></label>:<p className="hint">写作素材全库共用。上传 DOCX 后，从目录选择章节建立素材。</p>}<label className="upload-area"><b>{file?.name??'选择文件'}</b><span>{kind==='kb'?'DOCX / PDF / 图片 · 100 MB 以内':'DOCX · 100 MB 以内'}</span><input aria-label="选择上传文件" type="file" disabled={busy} accept={kind==='kb'?'.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp':'.docx'} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>{error?<div role="alert" className="error">{error}</div>:null}</div><div className="modal-actions"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||!file||(kind==='kb'&&!company)} onClick={async()=>{setBusy(true);try{validateUpload(file!);const body=new FormData();body.append('file',file!);await request(kind==='kb'?'/kb/files?company_id='+encodeURIComponent(company):'/materials/files',{method:'POST',body});onDone(kind==='kb'?'已上传，识别任务将整理资料。':'已上传，可从文件建立素材。')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}}>{busy?'正在上传…':'上传资料'}</button></div></div></Modal>
}
