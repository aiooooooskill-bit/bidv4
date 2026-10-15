import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Modal} from './Modal';
const Context=createContext<{mark:(key:string,dirty:boolean)=>void;navigate:(fn:()=>void)=>void;hasDirty:boolean}>({hasDirty:false,mark:()=>{},navigate:fn=>fn()});
export const useNavigationGuard=()=>useContext(Context);
export function NavigationGuard({children}:{children:ReactNode}){
 const dirty=useRef(new Set<string>()),[hasDirty,setHasDirty]=useState(false),[next,setNext]=useState<{run:()=>void}|null>(null);
 const mark=useCallback((key:string,value:boolean)=>{if(value)dirty.current.add(key);else dirty.current.delete(key);setHasDirty(dirty.current.size>0)},[]);
 const navigate=useCallback((fn:()=>void)=>{if(dirty.current.size)setNext({run:fn});else fn()},[]);
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirty.current.size){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler)},[]);
 return <Context.Provider value={{mark,navigate,hasDirty}}>{children}<Modal open={!!next} onClose={()=>setNext(null)} label="未保存修改" role="alertdialog" width="460px"><div className="bp-confirm-dialog"><div className="bp-confirm-heading"><span aria-hidden="true">!</span><h2>当前有未保存修改</h2></div><p>离开会丢弃本次编辑，已保存文件保留。</p><div className="bp-confirm-actions"><button className="bp-btn" data-kind="danger" onClick={()=>{const action=next?.run;dirty.current.clear();setHasDirty(false);setNext(null);action?.()}}>丢弃修改并离开</button><button className="bp-btn" data-kind="primary" data-modal-autofocus onClick={()=>setNext(null)}>继续编辑</button></div></div></Modal></Context.Provider>
}
