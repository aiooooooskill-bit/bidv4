/** Resolve citation syntax against the actual parsed-source names; never infer a source. */
const lineRange=/(?<![\p{L}\p{N}_])L(\d+)(?:\s*[-–—~～至]\s*L?(\d+))?(?![\p{L}\p{N}_.])/giu;
const filenameEnd=/\.[A-Za-z][A-Za-z0-9]{1,7}(?=\s|[（(，,；;、/]|$)/g;
const sourceBoundary=/[\p{L}\p{N}_.-]/u;

function sourceMatches(text,names){
 const matches=[];
 for(const name of [...new Set(names)].sort((a,b)=>b.length-a.length)){
  if(!name)continue;
  for(let start=text.indexOf(name);start>=0;start=text.indexOf(name,start+1)){
   const end=start+name.length;
   if(sourceBoundary.test(text[start-1]??'')||sourceBoundary.test(text[end]??''))continue;
   if(matches.some(match=>start<match.end&&end>match.start))continue;
   matches.push({start,end,source:name});
  }
 }
 return matches.sort((a,b)=>a.start-b.start);
}

function splitTopPositions(text,separators,names){
 const protectedNames=sourceMatches(text,names),parts=[];
 let depth=0,start=0;
 for(let i=0;i<text.length;i++){
  const name=protectedNames.find(match=>match.start===i);
  if(name){i=name.end-1;continue}
  const ch=text[i];
  if('（(['.includes(ch))depth++;
  else if('）)]'.includes(ch))depth=Math.max(0,depth-1);
  else if(depth===0&&separators.includes(ch)){parts.push({text:text.slice(start,i),start,end:i});start=i+1}
 }
 parts.push({text:text.slice(start),start,end:text.length});return parts;
}
function splitTop(text,separators,names){return splitTopPositions(text,separators,names).map(part=>part.text)}

function citationEvents(segment,names){
 const events=names.map(match=>({...match,type:'source'}));
 for(const match of segment.matchAll(/同文件/g))if(!names.some(name=>match.index>=name.start&&match.index<name.end))events.push({type:'same',start:match.index,end:match.index+match[0].length});
 // Unknown filenames invalidate the anchor rather than reusing an earlier file.
 for(const match of segment.matchAll(filenameEnd))if(!names.some(name=>match.index>=name.start&&match.index<name.end))events.push({type:'unknown',start:match.index,end:match.index+match[0].length});
 for(const match of segment.matchAll(lineRange))if(!names.some(name=>match.index>=name.start&&match.index<name.end))events.push({type:'range',start:match.index,end:match.index+match[0].length,first:Number(match[1]),last:Number(match[2]??match[1])});
 return events.sort((a,b)=>a.start-b.start);
}

/**
 * A top-level semicolon starts an independent anchor; slash segments inherit their
 * preceding segment. “同文件” uses only the caller's same-table, same-column anchor.
 * The returned source also records explicit filename-only segments for later rows.
 */
export function resolveEvidenceCitation(text,priorSource,sourceNames){
 let lastSource=sourceNames.includes(priorSource)?priorSource:null;
 const references=[];
 for(const part of splitTop(text,'；;\n',sourceNames)){
  let source=null;
  for(const raw of splitTop(part,'/',sourceNames)){
   const segment=raw.trim();if(!segment)continue;
   const names=sourceMatches(segment,sourceNames);
   const events=citationEvents(segment,names);
   const pending=new Set();
   for(const event of events){
    if(event.type==='range'){
     const start=event.first,end=event.last;
     const label=source??`出处未明确：${segment.replace(lineRange,'').trim()}`;
     references.push({source,start,end,citation:`${label}（L${start}${end===start?'':`-L${end}`}）`});
     if(!source)lastSource=null;
     pending.clear();
    }else{
     const next=event.type==='source'?event.source:event.type==='same'?lastSource:null;
     pending.add(next);
     source=pending.size===1?next:null;
     lastSource=source;
    }
   }
  }
 }
 return {references,source:lastSource};
}

/** Source association spans for business-only editing, leaving surrounding prose editable. */
export function evidenceCitationSpans(text,sourceNames){
 const spans=[];
 for(const part of splitTopPositions(text,'，,。；;\n',sourceNames)){
  let inherited=false;
  for(const segment of splitTopPositions(part.text,'/',sourceNames)){
   const raw=segment.text,offset=part.start+segment.start;
   let anchor=inherited?raw.search(/\S/):null;
   if(anchor===-1)anchor=null;
   for(const event of citationEvents(raw,sourceMatches(raw,sourceNames))){
    if(event.type==='source'||event.type==='same'){
     spans.push({start:offset+event.start,end:offset+event.end});
     anchor=anchor===null?event.start:Math.min(anchor,event.start);
     inherited=true;
    }else if(event.type==='unknown'){
     anchor=null;inherited=false;
    }else{
     let end=event.end;
     const closing=raw.slice(end).match(/^\s*[）)\]]+/);
     if(closing)end+=closing[0].length;
     spans.push({start:offset+(anchor??event.start),end:offset+end});
     anchor=null;
    }
   }
  }
 }
 const merged=[];
 for(const span of spans.sort((a,b)=>a.start-b.start||a.end-b.end)){
  const previous=merged.at(-1);
  if(previous&&(span.start<=previous.end||/^[\s、，,；;\/()（）\[\]]*$/.test(text.slice(previous.end,span.start))))previous.end=Math.max(previous.end,span.end);
  else merged.push({...span});
 }
 return merged;
}

/** Only top-level Markdown parse outputs are eligible source evidence. */
function parsedSources(work){return work.map(entry=>({entry,parts:entry.path.split('/')})).filter(({parts})=>parts.length===3&&parts[0]==='parse'&&parts[1]&&parts[2].endsWith('.md'))}
export function evidenceSourceNames(work){return [...new Set(parsedSources(work).map(({parts})=>parts[1]))]}

/** A rendered evidence action must identify exactly one file and one valid range. */
export function locateEvidenceReference(citation,work){
 const {references}=resolveEvidenceCitation(citation,null,evidenceSourceNames(work));
 if(!references.length)throw new Error('此处没有可定位的原文行号');
 if(references.length!==1)throw new Error('此处包含多个原文区段，请逐项查看依据');
 const reference=references[0];
 if(!reference.source)throw new Error('出处未明确对应哪个来源文件，请核对同表的文件名锚');
 if(reference.start<1||reference.end<reference.start)throw new Error('出处行号范围无效，请核对原文引用');
 const candidates=parsedSources(work).filter(({parts})=>parts[1]===reference.source);
 if(candidates.length!==1)throw new Error('此来源文件的解析稿不唯一，无法安全定位原文');
 return {...reference,path:candidates[0].entry.path};
}
