import {createReadStream,createWriteStream} from 'node:fs';
import {stat,mkdir,rm} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import Busboy from 'busboy';
import {createBusinessScope} from './native/scope.mjs';
import {BusinessRuntime} from './native/runtime.mjs';
import {business,root,dataRoot,BusinessError} from './native/business.mjs';
import {assertInstallation,claimHost} from './installation.mjs';
export const name='ooo-bidpliot';
export const inject=['webServer','connection','agents','llm','agentDefaultModel','subprocess','attachments','sessions','sessionPersistence','sessionQuery','agentPresets','sessionTitle','sessionProjections','agentLoop','tools','skills','userQuestions','fs','systemPrompt','subagents'];
async function input(req,unlimitedUpload=false){
 const type=req.headers['content-type']??'';
 if(type.startsWith('multipart/form-data')){
  const dir=join(dataRoot,'uploads',randomUUID());await mkdir(dir,{recursive:true});let upload,fields={},writes=[],failure;
  try{
   const parser=Busboy({headers:req.headers,defParamCharset:'utf8',limits:{files:1,...(unlimitedUpload?{}:{fileSize:100*1024*1024+1}),fields:8,fieldSize:65536}});
   parser.on('file',(_name,stream,info)=>{const path=join(dir,'file');upload={path,filename:info.filename};stream.on('limit',()=>{failure=new BusinessError(413,'文件超过100MB上限')});writes.push(pipeline(stream,createWriteStream(path)).catch(e=>{failure=e}))});
   parser.on('field',(name,value)=>{fields[name]=value});parser.on('filesLimit',()=>{failure=new BusinessError(422,'每次只能上传一个文件')});
   await pipeline(req,parser);await Promise.all(writes);if(!unlimitedUpload&&upload&&(await stat(upload.path)).size>100*1024*1024)failure=new BusinessError(413,'文件超过100MB上限');if(failure)throw failure;return {body:fields,upload,cleanup:()=>rm(dir,{recursive:true,force:true})};
  }catch(e){await Promise.all(writes);await rm(dir,{recursive:true,force:true});throw e}
 }
 let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)throw new BusinessError(413,'操作内容超过1MB上限');chunks.push(chunk)}
 try{return {body:bytes?JSON.parse(Buffer.concat(chunks).toString()):{},cleanup:async()=>{}}}catch{throw new BusinessError(422,'操作参数不是有效JSON')}
}
function send(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
async function file(res,path,name,media,head=false){const info=await stat(path);res.writeHead(200,{'Content-Type':media??'application/octet-stream','Content-Length':info.size,'X-Content-Type-Options':'nosniff',...(name?{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`}:{})});if(head)res.end();else await pipeline(createReadStream(path),res)}
export async function apply(ctx){
 await assertInstallation(root);
 const releaseHost=await claimHost(root);let scope,runtime,routes;
 try{scope=await createBusinessScope(ctx);runtime=new BusinessRuntime(scope.ctx);await runtime.init();routes=await business(scope.ctx,'routes')}
 catch(error){try{await runtime?.close()}finally{try{await scope?.close()}finally{await releaseHost()}}throw error}
 ctx.reflect.provide('bidBusiness',runtime);
 const requests=new Set();let closing=false;
 ctx.effect(function*(){
  // Collect the exact scope disposer into this ordered transaction. Cordis
  // otherwise disposes sibling effects concurrently with the session drain.
  yield releaseHost;
  yield scope.dispose;
  yield async()=>{
   closing=true;
   try{for(const request of requests){request.controller.abort();if(!request.req.complete)request.req.destroy()}await Promise.all([...requests].map(request=>request.done.promise))}
   finally{await runtime.close()}
  };
  yield ctx.webServer.register({kind:'prefix',path:'/api/bidv4',async handler(req,res){
  if(closing){send(res,{detail:'ooo-bidpliot 正在关闭，请重新启用后继续'},503);return}
  const admission=ctx.connection.admit(req);if('rejection'in admission){send(res,{detail:'请重新打开本地dsh登录入口'},admission.rejection);return}
  const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort()});let parsed;
  const request={req,controller,done:Promise.withResolvers()};requests.add(request);
  try{
   const url=new URL((req.url??'/').slice('/api/bidv4'.length)||'/', 'http://localhost');const path=url.pathname,method=req.method??'GET',query=Object.fromEntries(url.searchParams);
   if(path.startsWith('/assets/')){if(!['GET','HEAD'].includes(method))throw new BusinessError(405,'操作不支持');const dir=resolve(root,'dist'),asset=resolve(dir,decodeURIComponent(path.slice('/assets/'.length)));if(!asset.startsWith(dir+sep))throw new BusinessError(404,'文件不存在');const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm'};await file(res,asset,null,mime[extname(asset)],method==='HEAD');return}
   parsed=['POST','PUT','PATCH','DELETE'].includes(method)?await input(req,method==='POST'&&(path==='/materials/files'||/^\/materials\/files\/[^/]+\/replace$/.test(path)||(path==='/files'&&query.purpose==='bid'))):{body:{},cleanup:async()=>{}};
   const body=parsed.body;
   if(path==='/tasks'&&method==='GET'){send(res,await runtime.tasks());return}
   if(path==='/tasks'&&method==='POST'){send(res,await business(scope.ctx,'create_task',body),201);return}
   let match;
   if((match=path.match(/^\/tasks\/([^/]+)$/))&&method==='DELETE'){await runtime.assertIdle(match[1]);send(res,await business(scope.ctx,'archive_task',{task_id:match[1]}));return}
   if((match=path.match(/^\/page-flow\/([^/]+)(?:\/(action|sources|checks|export|stop|answer|workflow|accept-section|review-input|review-decision))?$/))){
    const [,tid,operation]=match;
    if(!operation&&method==='GET'){send(res,await runtime.state(tid));return}
    if(operation==='workflow'&&method==='POST'){send(res,await runtime.workflows.start(tid,body),202);return}
    if(operation==='workflow'&&method==='DELETE'){send(res,await runtime.workflows.stop(tid,{workflow_id:body.workflow_id}));return}
    if(operation==='action'&&method==='POST'){send(res,await runtime.action(tid,body),202);return}
    if(operation==='review-input'&&method==='PUT'){send(res,await runtime.saveReviewInput(tid,body));return}
    if(operation==='review-decision'&&method==='PUT'){send(res,await runtime.reviewDecision(tid,body));return}
    if(operation==='sources'&&method==='PUT'){send(res,await runtime.saveSources(tid,body));return}
    if(operation==='stop'&&method==='POST'){if(typeof body.session_id!=='string'||typeof body.action_id!=='string')throw new BusinessError(409,'当前执行已变化');send(res,runtime.workflows.active(tid)?await runtime.workflows.stop(tid,{session_id:body.session_id,action_id:body.action_id}):await runtime.stop(tid,body.session_id,body.action_id));return}
    if(operation==='answer'&&method==='POST'){const result=await runtime.answer(tid,body.session_id,body);const workflow=await runtime.workflows.snapshot(tid);if(workflow?.state==='needs_input')void runtime.workflows.start(tid,{resume:true}).catch(e=>console.error(e.message));send(res,result);return}
    if(operation==='checks'&&method==='GET'){send(res,await business(scope.ctx,'checks',{}, {taskId:tid,signal:controller.signal}));return}
    if(operation==='accept-section'&&method==='POST'){const state=await runtime.assertIdle(tid);if(body.input_version!==state.input_versions.revise)throw new BusinessError(409,'章节依据已变化，请读取最新内容');send(res,await business(scope.ctx,'accept_section',{task_id:tid,volume:body.volume,title:body.title}));return}
    if(operation==='export'&&method==='POST'){const state=await runtime.assertIdle(tid);if(body.input_version!==state.input_versions.revise)throw new BusinessError(409,'合册依据已变化，请刷新页面后继续');send(res,await business(scope.ctx,'export',{}, {taskId:tid,signal:controller.signal}));return}
    throw new BusinessError(405,'操作不支持');
   }
   if(path==='/render/pending'&&method==='GET'){send(res,await business(scope.ctx,'render_pending'));return}
   if(path==='/render/figure'&&method==='POST'){send(res,await business(scope.ctx,'render_fulfill',{request_id:body.request_id,file:parsed.upload?.path}));return}
   if(method==='PUT'&&(match=path.match(/^\/projects\/([^/]+)\/bidder$/))){send(res,await runtime.saveBidder(match[1],body));return}
   if(query.task_id&&method!=='GET')await runtime.assertIdle(query.task_id);
   const route=routes.find(r=>r.method===method&&new RegExp('^'+r.path.replace(/\{\w+\}/g,'[^/]+')+'$').test(path));if(!route)throw new BusinessError(404,'操作不存在');
   if((match=path.match(/^\/kb\/items\/([^/]+)(?:\/(replace|retrigger))?$/))&&method!=='GET'&&runtime.knowledge.has(match[1]))throw new BusinessError(409,'该资料正在识别，请处理结束后再操作');
   const value=await business(scope.ctx,'route',{method,path,query,body,upload:parsed.upload},{signal:controller.signal});
   if(value?.file_path){await file(res,value.file_path,value.file_name,value.media_type);return}
   if(value?.bytes){res.writeHead(200,{'Content-Type':value.media_type,'X-Content-Type-Options':'nosniff'});res.end(Buffer.from(value.bytes,'base64'));return}
   send(res,value,route.status);
   if(path==='/kb/files'&&method==='POST'&&value.id)void runtime.ingestKnowledge(value.id).catch(e=>console.error('ooo-bidpliot knowledge:',e.message));
   if((match=path.match(/^\/kb\/items\/([^/]+)\/(?:retrigger|replace)$/))&&method==='POST')void runtime.ingestKnowledge(match[1]).catch(e=>console.error('ooo-bidpliot knowledge:',e.message));
  }catch(error){if(!res.headersSent)send(res,{detail:error.message},error.status??500);else res.destroy()}
  finally{try{await parsed?.cleanup()}finally{requests.delete(request);request.done.resolve()}}
  }})
 },'ooo-bidpliot: HTTP drain, execution sessions and host claim');
}
