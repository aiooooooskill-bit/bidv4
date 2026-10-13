import {useEffect,useState} from 'react';
import {NavigationGuard,useNavigationGuard} from './components/NavigationGuard';
import {TenderList,type ListMode} from './screens/TenderList';
import {ProjectWorkbench} from './screens/ProjectWorkbench';
import {NoticeButton,TaskNoticeHost,setNoticeScope} from './components/NoticeCenter';
import {Library} from './screens/Library';
const nav=[{key:'analysis',label:'智能解读'},{key:'build',label:'标书制作'},{key:'review',label:'标书审查'},{key:'library',label:'资料库'}] as const;
function WorkbenchApp({onClose}:{onClose:()=>void}){
 const {navigate}=useNavigationGuard();
 const [mode,setMode]=useState<ListMode|'library'>('analysis'),[tid,setTid]=useState<string|null>(null);
 useEffect(()=>{const close=(event:Event)=>navigate(()=>{onClose();(event as CustomEvent<{afterClose?:()=>void}>).detail?.afterClose?.()});window.addEventListener('ooo-bidpliot:request-close',close);return()=>window.removeEventListener('ooo-bidpliot:request-close',close)},[navigate,onClose]);
 useEffect(()=>setNoticeScope(tid??(mode==='library'?'library':'list')),[tid,mode]);
 return <div className="bp-root ly-root"><div className="bp-top"><div className="bp-nav">{nav.map(n=><button className="bp-nav-btn" data-active={mode===n.key} key={n.key} onClick={()=>navigate(()=>{setMode(n.key);setTid(null)})}>{n.label}</button>)}</div><span className="bp-spacer"/><NoticeButton/><button className="bp-btn" onClick={()=>navigate(onClose)}>关闭</button></div>{mode==='library'?<Library/>:tid?<ProjectWorkbench key={tid} tid={tid} mode={mode} onBack={()=>navigate(()=>setTid(null))} onMode={value=>navigate(()=>setMode(value))}/>:<TenderList key={mode} mode={mode} onOpen={(id,target)=>{setTid(id);setMode(target)}}/>}<TaskNoticeHost/></div>
}

export default function App(props:{onClose:()=>void}){return <NavigationGuard><WorkbenchApp {...props}/></NavigationGuard>}
