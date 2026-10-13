import {useEffect,useRef,useState} from 'react';
import {ApiError} from '../../api';

// Refresh the server baseline without remounting or replacing the local draft.
export function useConflictRecovery<T>(initial:T,read:()=>Promise<T>,onError:(e:unknown)=>void,describe:(value:T)=>Record<string,string>){
 const mounted=useRef(true);useEffect(()=>()=>{mounted.current=false},[]);const isActive=()=>mounted.current;
 const [base,setBase]=useState(initial),[conflict,setConflict]=useState(false),[loading,setLoading]=useState(false),[latest,setLatest]=useState<T|null>(null);
 const fail=(error:unknown)=>{if(!isActive())return;if(error instanceof ApiError&&error.status===409){setConflict(true);setLatest(null)}onError(error)};
 const recovery=conflict?<div className="inline-note" role="alert"><p>保存存在版本冲突。当前输入保留，请读取最新值并核对差异。</p>{latest?<><details open><summary>服务器最新保存值</summary><dl className="conflict-values">{Object.entries(describe(latest)).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'未填写'}</dd></div>)}</dl></details><button disabled={loading} onClick={()=>setConflict(false)}>已核对差异，保留当前输入</button></>:null}<button disabled={loading} onClick={async()=>{setLoading(true);try{const value=await read();if(!isActive())return;setBase(value);setLatest(value)}catch(e){if(isActive())onError(e)}finally{if(isActive())setLoading(false)}}}>{loading?'正在读取…':latest?'重新读取最新版本并保留当前输入':'读取最新版本并保留当前输入'}</button></div>:null;
 return {base,fail,recovery,isActive,blocked:conflict||loading};
}
