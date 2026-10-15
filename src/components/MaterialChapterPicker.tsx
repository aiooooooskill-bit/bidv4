import {useCallback,useState} from 'react';
import {BASE} from '../api';
import {DocxViewer,type BookmarkLocation,type LocationStatus} from './DocxViewer';
import {MaterialBlocks,type MaterialChapter} from './MaterialBlocks';

export function MaterialChapterPicker({fid,fileName,onChanged,onBusyChange}:{fid:string;fileName:string;onChanged:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}){
 const [chapter,setChapter]=useState<MaterialChapter|null>(null),[location,setLocation]=useState<BookmarkLocation>(),[status,setStatus]=useState<LocationStatus>('loading'),[revision,setRevision]=useState(0);
 const navigate=useCallback((node:MaterialChapter)=>{
  setChapter(node);setStatus('loading');
  setLocation(old=>({bookmark:`bid_${fid}_${node.start_line}`,requestId:(old?.requestId??0)+1}));
 },[fid]);
 const reparsed=useCallback(()=>{setChapter(null);setLocation(undefined);setRevision(n=>n+1)},[]);
 const message=chapter?(status==='loading'?`正在打开原文：${chapter.标题}…`:status==='located'?`当前原文：${chapter.标题}`:status==='failed'?'原文加载失败，请在左侧重试。':'未找到该章节位置，请重新解析文件后再试。'):undefined;
 return <div className="library-material-layout"><div className="material-source-preview"><DocxViewer key={revision} src={`${BASE}/materials/files/${fid}/preview?revision=${revision}`} fitWidth location={location} onLocationChange={setStatus}/></div><MaterialBlocks fid={fid} defaultTitle={fileName.replace(/\.docx$/i,'').slice(0,120)} onChanged={onChanged} onBusyChange={onBusyChange} onNavigate={navigate} activeLine={chapter?.start_line} navigationStatus={message} onReparsed={reparsed}/></div>;
}
