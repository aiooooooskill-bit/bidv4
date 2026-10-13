import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,join,resolve} from 'node:path';
import {business,dataRoot,BusinessError} from './business.mjs';
import {normalizeWorkPath} from './work-paths.mjs';

const planningFiles={'body/写作指引.md':'guide','body/关键事实与承诺.md':'promises'};
const chapterTools=new Set(['docx_section_create','docx_section_revise','docx_material_inject','docx_source_inject','docx_image_insert','docx_comment_add','docx_diagram_insert','docx_html_figure']);
const mutations=new Set([...chapterTools,'write','edit','build_preparation','validate_body','docx_assemble_volume','publish_artifact','assemble_tender']);

// Use the official around-dispatch hook so parent, child and plain file tools
// share one policy. Serialize mutations through their completion per project.
export function installExecutionGuard(ctx,reportPreparationProblem){
 const pending=new Map();
 const seed=ctx.on('agent/pre-step',async({agent,signal,step},next)=>{
  const {cwd,parentSession,origin}=agent.session.header;
  if(step===1&&origin==='subagent'&&parentSession){
   const tid=basename(cwd??'');
   if(resolve(cwd??'')===resolve(join(dataRoot,'workspace',tid))){
    let record;try{record=JSON.parse(await readFile(join(dataRoot,'actions',tid,'latest.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
    if(['body','revise','build','guide','promises'].includes(record?.kind))await business(ctx,'inherit_asset_reads',{task_id:tid,session_id:agent.session.id,from_session_id:parentSession,seed:true},{signal});
   }
  }
  return next();
 },{global:true});
 const guard=ctx.on('tools/execute',async(exec,next)=>{
  if(!exec.agent||(!mutations.has(exec.name)&&!['read','read_image','glob','grep'].includes(exec.name))||(exec.name==='build_preparation'&&(!exec.arguments.stage||exec.arguments.stage==='read')))return next();
  const tid=basename(exec.agent.session.header.cwd??''),cwd=join(dataRoot,'workspace',tid);
  if(resolve(exec.agent.session.header.cwd??'')!==resolve(cwd))return next();
  let record;try{record=JSON.parse(await readFile(join(dataRoot,'actions',tid,'latest.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return next();throw e}
  if(!['body','revise','build','guide','promises'].includes(record.kind))return next();
  let agent=exec.agent;
  while(agent.session.id!==record.session_id&&agent.session.header.origin==='subagent'&&agent.session.header.parentSession){agent=ctx.agents.get(agent.session.header.parentSession);if(!agent)break}
  if(['read','read_image','glob','grep'].includes(exec.name)){
   const raw=exec.arguments.file_path??exec.arguments.path??cwd;
   const target=await ctx.fs.resolve(raw,{cwd:exec.agent.session.header.cwd});
   const access=await business(ctx,'asset_access',{task_id:tid,path:target.targetKey},{signal:exec.signal});
   const result=await next();
   if(access.asset&&!result?.isError)await business(ctx,'record_asset_read',{task_id:tid,session_id:exec.agent.session.id,asset:access.asset},{signal:exec.signal});
   return result;
  }
  if(!agent||agent.session.id!==record.session_id||record.stopped_at)throw new BusinessError(409,'当前制作执行已变化或停止，未写入文件');
  if(record.preparation_error)throw new BusinessError(409,record.preparation_error);
  const previous=pending.get(tid)??Promise.resolve(),done=Promise.withResolvers();pending.set(tid,done.promise);
  await previous;
  try{
   exec.signal.throwIfAborted();
   const state=await business(ctx,'state',{task_id:tid},{signal:exec.signal});
   if(!state.bidder?.confirmed||state.bidder.stale)throw new BusinessError(409,'投标主体信息尚未确认或已变化，请停止后重新核对制作信息');
   const prepared=state.build_preparation.guide==='ready'&&state.build_preparation.promises==='ready';
   let preparationStage,guideBefore;
   if(chapterTools.has(exec.name)||(exec.name==='validate_body'&&exec.arguments.section?.endsWith('.docx'))){
    if(!['body','revise','build'].includes(record.kind)||!prepared)throw new BusinessError(409,'请先完成并校验写作指引和关键事实与承诺，尚未写入章节');
    const raw=exec.name==='validate_body'?exec.arguments.section:exec.arguments.path??exec.arguments.dest;
    const relative=normalizeWorkPath(raw),path=relative.endsWith('.docx')?relative:relative+'.docx';
    if(!record.section_paths.includes(path))throw new BusinessError(409,'仅允许写入本次指定章节，其他章节未改动');
    const target=await ctx.fs.resolve(join(cwd,'work',path),{cwd});
    const work=await ctx.fs.resolve(join(cwd,'work'),{cwd});
    if(target.targetKey!==join(work.targetKey,path))throw new BusinessError(409,'章节路径指向其他文件，未写入');
   }else if(exec.name==='write'||exec.name==='edit'){
    const target=await ctx.fs.resolve(exec.arguments.file_path,{cwd:exec.agent.session.header.cwd});
    const work=await ctx.fs.resolve(join(cwd,'work'),{cwd});
    const entry=Object.entries(planningFiles).map(([path,stage])=>({stage,key:join(work.targetKey,path)})).find(e=>e.key===target.targetKey);
    if(!entry)throw new BusinessError(409,'本次制作的普通文件写入仅用于写作准备，正文请使用本次章节的 DOCX 工具');
    const {stage}=entry;
    preparationStage=stage;
    if(exec.agent!==agent||record.kind==='revise'||(record.kind==='guide'&&stage!=='guide')||(record.kind==='promises'&&stage!=='promises'))throw new BusinessError(409,'共享写作准备由主线程的对应准备步骤维护');
    if(['body','build'].includes(record.kind)&&state.build_preparation[stage]==='ready')throw new BusinessError(409,'当前写作准备已就绪，请直接复用，未重写文件');
    if(stage==='guide'){
     try{guideBefore=createHash('sha256').update(await readFile(target.displayPath)).digest('hex')}
     catch(error){if(error.code!=='ENOENT')throw error}
    }
    if(stage==='promises'&&state.build_preparation.guide!=='ready')throw new BusinessError(409,'请先校验并记录当前写作指引');
    if(stage==='promises'){
     let content=exec.arguments.content;
     if(exec.name==='edit'){
      const current=await readFile(target.displayPath,'utf8'),{old_string:old,new_string:replacement,replace_all:all}=exec.arguments;
      if(!old||!current.includes(old)||(!all&&current.split(old).length!==2))throw new BusinessError(422,'编辑内容与当前承诺清单不匹配，请先读取最新文件');
      content=all?current.split(old).join(replacement):current.replace(old,()=>replacement);
     }
     try{await business(ctx,'check_preparation_write',{task_id:tid,stage,content},{signal:exec.signal})}
     catch(error){if(error.message.startsWith('已有承诺值需要用户处理'))await reportPreparationProblem(tid,record.session_id,error.message);throw error}
    }
   }else if(exec.name==='build_preparation'){
    if(exec.agent!==agent||record.kind==='revise'||!['guide','promises'].includes(exec.arguments.stage)||(record.kind==='guide'&&exec.arguments.stage!=='guide')||(record.kind==='promises'&&exec.arguments.stage!=='promises'))throw new BusinessError(409,'当前操作不允许记录其他准备阶段');
   }else if(exec.name==='validate_body'){
    const section=normalizeWorkPath(exec.arguments.section);
    if(section!=='body/写作指引.md'&&section!=='body')throw new BusinessError(422,'请校验当前写作指引、指定章节或正文目录');
   }else if(exec.name!=='docx_assemble_volume'||record.kind!=='build'||!prepared){
    throw new BusinessError(409,'当前操作不允许发布目录或扩展合册范围');
   }
   const result=await next();
   if(preparationStage==='guide'&&!result?.isError)await business(ctx,'record_guide_write',{task_id:tid,previous_hash:guideBefore??null,replace:exec.name==='write'},{signal:exec.signal});
   return result;
  }finally{done.resolve();if(pending.get(tid)===done.promise)pending.delete(tid)}
 },{global:true});
 return ()=>{guard();seed()};
}
