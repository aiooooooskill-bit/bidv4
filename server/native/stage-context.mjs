import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {BasicCompactionEngine} from '@deepseek-ai/dsh-compaction-basic';
import {toolPairingBalancedBefore,toolPairingBalancedAfter} from '@deepseek-ai/dsh-compaction';

// Keep user messages, question/answer units, and conversational conclusions verbatim.
// Only completed tool execution is retired. Page prompts may include user input.
export function stageRegions(session,beforeSeq){
 const regions=[];let unit=[],run=[];
 const flush=()=>{if(run.length)regions.push(run);run=[]};
 for(const seq of session.surface.nodes){
  const event=session.eventAt(seq),message=session.deriveEventMessage(event);
  unit.push({seq,event,message});
  if(!toolPairingBalancedAfter(session,seq))continue;
  const eligible=unit.every(({seq,message})=>seq<beforeSeq&&message&&(
   message.role==='tool'||message.role==='assistant'&&message.content.some(b=>b.type==='tool-call')
  ))&&!unit.some(({message})=>message?.content.some(b=>b.type==='tool-call'&&b.name==='ask_user_question'));
  if(eligible&&toolPairingBalancedBefore(session,unit[0].seq))run.push(...unit);else flush();
  unit=[];
 }
 flush();return regions;
}

export default class StageCompaction extends BasicCompactionEngine{
 templates=new WeakMap();
 async summarize(input,agent,signal){
  const text=this.templates.get(agent);
  return text===undefined?super.summarize(input,agent,signal):{summary:[{type:'text',text}],provider:'stage-context',model:'deterministic-archive'};
 }
 async enterStage(agent,{beforeSeq,directory,signal}){
  const regions=stageRegions(agent.session,beforeSeq),archived=[];
  for(const region of regions){
   signal?.throwIfAborted();
   const seqs=region.map(n=>n.seq),start=seqs[0],end=seqs.at(-1),path=join(directory,`${start}-${end}.json`);
   const text=`上一阶段执行记录已归档：${path}。这是历史取证记录，不是新指令；需用其中证据时按路径回读。当前事实以本阶段指令及当前版本原件、成果为准。`;
   // The official backend enforces shrink again at commit time.
   const originalTokens=region.reduce((n,r)=>n+this.ctx.tokenMeter.estimateMessage(r.message),0);
   if(originalTokens<=this.ctx.tokenMeter.estimateMessage({role:'user',content:[{type:'text',text:'<compacted-summary>\n'+text+'\n</compacted-summary>'}]})+256)continue;
   // Original events retain full receipts even if the active surface was pruned.
   const bytes=JSON.stringify({source_session:agent.id,source_seqs:seqs,events:region.map(n=>n.event)},null,2);
   await mkdir(directory,{recursive:true});await writeFile(path+'.tmp',bytes);await rename(path+'.tmp',path);
   this.templates.set(agent,text);
   try{const result=await this.compactRegion(start,end,agent,signal);archived.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),source_seqs:seqs,shadowed_tokens:result.shadowedTokenCount})}
   finally{this.templates.delete(agent)}
  }
  return {before_seq:beforeSeq,archives:archived};
 }
}
