import ReactMarkdown,{type Components} from 'react-markdown';
import {markdownPlugins,markdownText} from '../../shared/markdown.js';
import {evidenceIds,evidenceReferenceIds,isCitationColumn,isEvidenceReferenceList,normalizeEvidenceId} from '../../shared/evidence-references.js';
import {resolveEvidenceCitation,type EvidenceReference} from '../../shared/evidence-citation.js';
import type {Root,PhrasingContent,TableCell} from 'mdast';
import type {DirectoryData} from '../lib/directoryTree';
export const businessText=(text:string)=>text.replace(evidenceIds,'').replace(/\b(?:unknown|conflicting)\b/g,m=>m==='unknown'?'原文未明确':'原文存在冲突');
const evidenceLink='#evidence:';
const evidenceColumns=/^(依据|原文依据)(?:\s*[（(][^）)]*[）)])?$/;

/** 只展开编号本身，业务文字及 Markdown 格式留在原来的节点中。 */
function evidenceCell(cell:TableCell,registry:DirectoryData['registry']){
 const citations:string[]=[];
 const resolve=(id:string):PhrasingContent=>{
  const entry=registry?.[normalizeEvidenceId(id)],label=entry?.text?.trim();
  if(!label)return {type:'text',value:'依据未关联，请核对文档来源'};
  const citation=entry?.出处?.trim();
  if(citation)citations.push(citation);
  return {type:'text',value:label+(citation?`（出处：${citation}）`:'（出处未提供）')};
 };
 const raw=markdownText(cell);
 if(isEvidenceReferenceList(raw)){
  const ids=evidenceReferenceIds(raw),missing=ids.filter(id=>!registry?.[id]?.text?.trim());
  const values=ids.filter(id=>registry?.[id]?.text?.trim()).map(resolve);
  if(missing.length)values.push({type:'text',value:`${missing.length} 项依据未关联，请核对文档来源`});
  cell.children=values.flatMap((value,index)=>index?[{type:'break'} as PhrasingContent,value]:[value]);
 }
 else {
  const replace=(node:PhrasingContent):PhrasingContent[]=>{
   if(node.type==='text'||node.type==='inlineCode'){
    const matches=[...node.value.matchAll(evidenceIds)];if(!matches.length)return [node];
    const children:PhrasingContent[]=[];let at=0;
    for(const match of matches){if(match.index>at)children.push({...node,value:node.value.slice(at,match.index)});children.push(resolve(match[0]));at=match.index+match[0].length}
    if(at<node.value.length)children.push({...node,value:node.value.slice(at)});
    return children;
   }
   if('children'in node)node.children=node.children.flatMap(child=>replace(child)) as typeof node.children;
   return [node];
  };
  cell.children=cell.children.flatMap(replace);
 }
 return citations;
}
function appendEvidenceLinks(cell:TableCell,references:EvidenceReference[]){
 const citations=[...new Set(references.map(reference=>reference.citation))];
 for(const [index,citation] of citations.entries())cell.children.push({type:'break'},{type:'link',url:evidenceLink+encodeURIComponent(citation),children:[{type:'text',value:citations.length===1?'查看依据':`查看依据 ${index+1}`} ]});
}
function reader(options:{registry?:DirectoryData['registry'];onEvidence?:boolean;sourceNames:string[]}){return(tree:Root)=>{
 let hidden=0;
 tree.children=tree.children.filter(node=>{if(node.type==='heading'){if(hidden&&node.depth<=hidden)hidden=0;const title=markdownText(node);if(/coverage\s*声明|来源标注|来源登记/.test(title)){hidden=node.depth;return false}if(/待澄清登记/.test(title))node.children=[{type:'text',value:'补充说明'}]}return !hidden});
 const walk=(node:any)=>{
  if(node.type==='table'){
   const headers=node.children[0].children.map((cell:TableCell)=>markdownText(cell).trim());
   const anchors:(string|null)[]=headers.map(()=>null);
   for(const row of node.children.slice(1))for(const [index,cell] of (row.children as TableCell[]).entries()){
    const header=headers[index]??'',raw=markdownText(cell);
    const citation=resolveEvidenceCitation(raw,isCitationColumn(header)?anchors[index]:null,options.sourceNames);
    if(isCitationColumn(header))anchors[index]=citation.source;
    const expanded=evidenceColumns.test(header)?evidenceCell(cell,options.registry):[];
    if(options.onEvidence){
     const references=[...citation.references,...expanded.flatMap(text=>resolveEvidenceCitation(text,null,options.sourceNames).references)];
     appendEvidenceLinks(cell,references);
    }
   }
   const removed=headers.map((header:string,index:number)=>/^(编号|ID|来源编号|理由来源)$/.test(header)?index:-1);
   for(const row of node.children)row.children=row.children.filter((_:TableCell,index:number)=>!removed.includes(index));
  }
  if(node.type==='text'||node.type==='code'||node.type==='inlineCode')node.value=businessText(node.value);
  node.children?.forEach(walk);
 };
 walk(tree);
}}
export function MarkdownDocument({content,onEvidence,registry,sourceNames=[]}:{content:string;onEvidence?:(citation:string)=>void;registry?:DirectoryData['registry'];sourceNames?:string[]}){
 const components:Components={table:({children})=><div className="ly-table-scroll" role="region" aria-label="文档表格" tabIndex={0}><table>{children}</table></div>,a:({href,children})=>href?.startsWith(evidenceLink)?<button className="ly-text-button ly-evidence-button" onClick={()=>onEvidence?.(decodeURIComponent(href.slice(evidenceLink.length)))}>{children}</button>:<a href={href} target="_blank" rel="noreferrer">{children}</a>,img:({alt})=><span className="ly-image-note">图片说明：{alt||'请查看原件'}</span>};
 return <div className="ly-markdown"><ReactMarkdown skipHtml remarkPlugins={[...markdownPlugins,[reader,{registry,onEvidence:!!onEvidence,sourceNames}]]} components={components}>{content}</ReactMarkdown></div>
}
