// Deterministic comparison fixture over the actual parsed synthetic documents.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
export function reviewSequence(installation){
 const headers=JSON.parse(execFileSync(join(installation,'business/python/.venv/bin/python'),['-c','import sys,json;sys.path.insert(0,sys.argv[1]);from app.tools.validate_analysis import _REQUIRED_HEADERS;print(json.dumps(_REQUIRED_HEADERS))',join(installation,'business/python')],{encoding:'utf8'}));
 const call=(name,args)=>({name,args});
 return async(request,cwd,step)=>{
  if(step===0)return [call('prepare_review_documents',{})];
  const parsed=request.messages.find(m=>m.role==='tool'&&String(m.content).includes('outline_path'));
  const docs=parsed?JSON.parse(parsed.content).documents:[];if(!docs.length)throw Error('Review fixture parse failed: '+request.messages.filter(m=>m.role==='tool').map(m=>String(m.content)).join('\n').slice(-2500));
  if(step===1)return [...docs.flatMap(d=>[call('read',{file_path:d.outline_path}),call('read',{file_path:d.path})]),call('review_basis',{})];
  if(step===2){
   const tender=docs.find(d=>d.kind==='tender'),content=await readFile(tender.path,'utf8');
   const lines=content.split('\n'),index=lines.findIndex(l=>l.includes('投标文件须包含'));if(index<0)throw Error('Synthetic tender requirement missing');
   return Object.entries(headers).map(([key,tables])=>{
    let markdown='';for(const header of tables){markdown+='| '+header.join(' | ')+' |\n| '+header.map(()=> '---').join(' | ')+' |\n';if(key!=='clarifications')markdown+='| '+header.map((h,i)=>/出处/.test(h)?tender.name+' L'+(index+1):i===0&&key!=='requirements-business'?'1':lines[index]).join(' | ')+' |\n';markdown+='\n'}
    if(key!=='clarifications')markdown+='## coverage 声明\n已检查：合成材料全部文字；未检查：签字和原件真实性\n';if(key==='disqualification')markdown+='反查词表：废标、无效、否决\n';
    return call('write',{file_path:join(cwd,'work/review/analysis',key+'.md'),content:markdown});
   });
  }
  if(step===3)return [call('review_basis',{stage:'validate'})];
  if(step===4)return [call('review_batch',{})];
  const last=request.messages.findLast(m=>m.role==='tool');let value;try{value=JSON.parse(last.content)}catch{}
  const batch=value?.next??value;
  if(value?.saved&&Number.isInteger(value.requirements)&&request.tools?.some(t=>(t.function?.name??t.name)==='ooo_bidpliot_read'))return [call('ooo_bidpliot_read',{task_id:cwd.split('/').pop(),report:true})];
  if(batch?.complete)return [call('finish_review_report',{limitations:['仅为确定性技术验收合成材料，真实性需人工确认。']})];
  if(batch?.batch_id)return [call('save_review_batch',{batch_id:batch.batch_id,results:batch.requirements.map(r=>({slot:r.slot,tender:r.tender.map(({document_id,start,end})=>({document_id,start,end})),status:'uncertain',applicability:'uncertain',applicability_reason:'合成投标正文未包含完整响应细节，具体履约范围待确认。',bid_facts:[],conflicts:[],assessment:'已读取合成投标正文，本夹具仅验证流程与保存，响应情况待确认。',bid:[],problems:[{risk_type:'confirmation',title:'响应细节需确认',explanation:'合成投标正文未覆盖本项要求。',suggestion:'补充真实业务材料后核查。'}]}))})];
  return [];
 };
}
