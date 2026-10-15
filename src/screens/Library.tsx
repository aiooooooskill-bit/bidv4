import {useCallback,useEffect,useState} from 'react';
import {useNavigationGuard} from '../components/NavigationGuard';
import {Upload} from '../components/library/Upload';
import {Knowledge} from '../components/library/Knowledge';
import {Companies} from '../components/library/Companies';
import {Representatives} from '../components/library/Representatives';
import {Materials} from '../components/library/Materials';
import {Templates} from '../components/library/Templates';
import {api,type Overview} from '../components/library/shared';
export function Library(){
 const [overview,setOverview]=useState<Overview|null>(null),[tab,setTab]=useState('knowledge'),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[epoch,setEpoch]=useState(0),[upload,setUpload]=useState(false),[materialFile,setMaterialFile]=useState('');
 const guard=useNavigationGuard();
 const reload=useCallback(async()=>{setEpoch(x=>x+1);try{const [entities,types]=await Promise.all([api('/library/overview'),api('/kb/types')]);setOverview({...entities,...types})}catch(e){setError(e instanceof Error?e.message:String(e))}},[]);
 useEffect(()=>{void reload()},[reload]);
 const onDirty=useCallback((value:boolean,busy=false)=>{setDirty(value);setSaving(busy);guard.mark('library',value)},[guard.mark]);
 useEffect(()=>()=>guard.mark('library',false),[guard.mark]);
 const success=async(message:string)=>{setNotice(message);setError('');await reload()};
 const fail=(e:unknown)=>{setError(e instanceof Error?e.message:String(e));setNotice('')};
 const shared={overview:overview!,dirty,onDirty,onSaved:success,onError:fail,epoch};
 return <div className="library-ui"><main><div className="page-title"><div><h1>资料库</h1><p>核对公司资料，维护投标主体，复用写作素材。</p></div>{['knowledge','materials','templates'].includes(tab)?<button className="primary" disabled={dirty} onClick={()=>setUpload(true)}>＋ 上传{tab==='knowledge'?'公司资料':tab==='materials'?'写作素材':' Word 版式'}</button>:null}</div><nav className="tabs" aria-label="资料库栏目">{[['companies','投标主体'],['representatives','授权代表'],['knowledge','公司资料'],['materials','写作素材'],['templates','Word版式']].map(([id,label])=><button key={id} disabled={saving} className={tab===id?'active':''} onClick={()=>{if(id===tab)return;guard.navigate(()=>{setTab(id);setNotice('');setError('')})}}>{label}</button>)}</nav>{dirty?<div className="draft-notice">详情有未保存修改，请先保存或取消。</div>:null}{error?<div className="error" role="alert">{error}<button disabled={dirty} onClick={()=>{setError('');void reload()}}>重新读取</button></div>:notice?<div className="notice" role="status">{notice}<button onClick={()=>setNotice('')}>关闭</button></div>:null}{!overview?<div className="empty">正在读取资料库…</div>:tab==='companies'?<Companies {...shared}/>:tab==='representatives'?<Representatives {...shared}/>:tab==='knowledge'?<Knowledge {...shared}/>:tab==='materials'?<Materials {...shared} uploadedFileId={materialFile} onUploadHandled={()=>setMaterialFile('')}/>:<Templates {...shared}/>}</main>{upload&&overview?<Upload kind={tab==='knowledge'?'kb':tab==='materials'?'mt':'template'} overview={overview} onClose={()=>setUpload(false)} onDone={async(m,id)=>{setUpload(false);if(id)setMaterialFile(id);await success(m)}}/>:null}</div>
}
