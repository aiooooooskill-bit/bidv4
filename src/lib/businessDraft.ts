import {parseMarkdown,markdownText,markdownSourceMap} from '../../shared/markdown.js';
import {evidenceIds,evidenceReferenceIds,isCitationColumn,isEvidenceReferenceList} from '../../shared/evidence-references.js';
import {evidenceCitationSpans} from '../../shared/evidence-citation.js';
import type {RootContent,TableCell} from 'mdast';

export interface DraftField {start:number;end:number;value:string;label:string;table?:boolean}
const protectedFragments=/\b(?:MAND|REQ|TPL|SCORE|CLAR)-[A-Za-z0-9_-]+\b|<!--[^]*?-->|\b(?:unknown|conflicting)\b|(?<![^\s()[\]（）【】|，,；;：:])[^\s()[\]（）【】|，,；;：:]+\.(?:docx|pdf|png|jpe?g|gif|webp)[^\n|，,；;]*?\bL\d+(?:\s*[-–~]\s*L?\d+)?|\bL\d+(?:\s*[-–~]\s*L?\d+)?/gi;
const technicalColumns=/^(编号|ID|来源编号|理由来源)(?:\s*[（(][^）)]*[）)])?$/i;
const evidenceColumns=/^(依据|原文依据)(?:\s*[（(][^）)]*[）)])?$/;
function cellText(cell:TableCell){return markdownText(cell)}
/** 仅编辑业务片段；隐藏列、来源关联及元信息留在原文的原始位置。 */
export function businessDraft(content:string,sourceNames:string[]=[]):DraftField[]{
 const tree=parseMarkdown(content);
 const fields:DraftField[]=[];let heading='正文',hidden=0;
 const collect=(node:RootContent|TableCell,label:string,evidence=false)=>{
  let start=node.position?.start.offset,end=node.position?.end.offset;if(start===undefined||end===undefined)return;
  if(node.type==='tableCell'){
   // GFM cell.position 包含分隔管线；子节点位置才是可替换的业务内容。
   const first=node.children[0],last=node.children.at(-1);
   if(first&&last){start=first.position!.start.offset!;end=last.position!.end.offset!}
   else {
    if(content[start]==='|')start++;
    if(content[end-1]==='|')end--;
    while(start<end&&/\s/.test(content[start]))start++;
    fields.push({start,end:start,value:'',label,table:true});return;
   }
  }
  const raw=content.slice(start,end);let at=0;const add=(a:number,b:number)=>{const value=raw.slice(a,b);if(value.trim()&&(!evidence||/[\p{L}\p{N}]/u.test(value)))fields.push({start:start!+a,end:start!+b,value,label,table:node.type==='tableCell'})};
  const ranges=[...raw.matchAll(protectedFragments)].map(match=>({start:match.index,end:match.index+match[0].length}));
  const mapped=markdownSourceMap(node,content);
  const semantic=[...evidenceCitationSpans(mapped.text,sourceNames),...[...mapped.text.matchAll(evidenceIds)].map(match=>({start:match.index,end:match.index+match[0].length}))];
  for(const range of semantic){const first=mapped.positions[range.start],last=mapped.positions[range.end-1];if(first&&last)ranges.push({start:Math.max(start,first.start)-start,end:Math.min(end,last.end)-start})}
  ranges.sort((a,b)=>a.start-b.start);
  for(const range of ranges){if(range.start>at)add(at,range.start);at=Math.max(at,range.end)}add(at,raw.length);
 };
 for(const node of tree.children){
  if(node.type==='heading'){
   const title=markdownText(node);if(hidden&&node.depth<=hidden)hidden=0;
   if(/coverage\s*声明|来源标注|来源登记/.test(title)){hidden=node.depth;continue}heading=title;
  }
  if(hidden||node.type==='html'||node.type==='thematicBreak')continue;
  if(node.type==='table'){
    const headers=node.children[0].children.map(cell=>cellText(cell).trim());
   node.children.slice(1).forEach((row,i)=>row.children.forEach((cell,j)=>{const header=headers[j]??'',evidence=evidenceColumns.test(header);if(technicalColumns.test(header)||isCitationColumn(header)&&!evidence)return;if(evidence&&isEvidenceReferenceList(cellText(cell)))return;collect(cell,`${heading} · 第${i+1}行 · ${header||'内容'}`,evidence&&evidenceReferenceIds(cellText(cell)).length>0)}));
  }else collect(node,heading);
 }
 return fields;
}
export function joinBusinessDraft(original:string,fields:DraftField[]){
 let result='',at=0;
 for(const field of fields){const unchanged=field.value===original.slice(field.start,field.end);const value=field.table&&!unchanged?field.value.replace(/\r?\n/g,' ').replace(/(?<!\\)\|/g,'\\|'):field.value;result+=original.slice(at,field.start)+value;at=field.end}
 return result+original.slice(at);
}
