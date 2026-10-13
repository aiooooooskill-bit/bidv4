import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {decodeString} from 'micromark-util-decode-string';

export const markdownPlugins=[[remarkGfm,{singleTilde:false}]];
const parser=unified().use(remarkParse).use(markdownPlugins);
export const parseMarkdown=content=>parser.parse(content);
export function markdownText(node){
 if(node.type==='image')return node.alt??'';
 if('value'in node)return node.value;
 if(node.type==='break')return '\n';
 return (node.children??[]).map(markdownText).join('');
}

/** Decoded AST text mapped to its original source spans, including escapes/entities. */
export function markdownSourceMap(node,content){
 let text='';const positions=[];
 const append=(value,offsets)=>{text+=value;for(const position of offsets)positions.push(position)};
 const walk=n=>{
  if(n.type==='text'){
   const start=n.position.start.offset,raw=content.slice(start,n.position.end.offset);
   let value='',offsets=[],at=0;
   const add=(decoded,a,b)=>{value+=decoded;for(let i=0;i<decoded.length;i++)offsets.push({start:start+a,end:start+b})};
   for(const match of raw.matchAll(/\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi)){
    for(;at<match.index;at++)add(raw[at],at,at+1);
    add(decodeString(match[0]),match.index,match.index+match[0].length);at=match.index+match[0].length;
   }
   for(;at<raw.length;at++)add(raw[at],at,at+1);
   append(value,offsets);
  }else if(n.children)n.children.forEach(walk);
  else {
   const value=markdownText(n),start=n.position?.start.offset,end=n.position?.end.offset;
   if(start===undefined||end===undefined)return;
   // Code and image syntax is one source unit; keep its association intact.
   append(value,Array.from({length:value.length},()=>({start,end})));
  }
 };
 walk(node);return {text,positions};
}
