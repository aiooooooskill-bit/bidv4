// Real documents and the user's configured local model, in the existing isolated worktree.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import YAML from 'yaml';
import {root,dataRoot} from '../server/native/business.mjs';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {runProfile} from '@deepseek-ai/dsh/profile-boot';
if(!root.includes('/.codex/worktrees/'))throw Error('Run inside the isolated worktree');
const originalHome='/Users/ooo/.dsh',original=YAML.parse(await readFile(join(originalHome,'profiles/web/cordis.patch.yml'),'utf8'));
const find=id=>original.find(p=>p.id===id)?.config;
const selected=find('agent-default-model'),provider=find('llm-pi-ai').providers[selected.provider];
assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(provider.baseURL).hostname),'Verification is limited to the configured local model');
const home=await mkdtemp(join(tmpdir(),'bid-review-real-'));process.env.DSH_HOME=home;process.env.DSH_TELEMETRY_DISABLED='1';process.env.REAL_REVIEW_KEY='local-model-no-auth';
const sourceRoot='/Users/ooo/Library/Application Support/lingyan.ddmdj.com/workspace/t_af73e19413ef/sources';
const filenames=await readdir(sourceRoot),bid='万野.docx',tender=filenames.find(n=>n!==bid&&n.endsWith('.docx'));
assert.ok(tender&&filenames.includes(bid));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),requests=[],evidencePath=join(root,'docs/evidence/review-real-20261013.json');
let ctx,taskId,sessionId,proxy,finished=false;
const evidence={scope:'Original Hangzhou-pei documents + actual configured local model; no fabricated model responses',model:selected,originalModelEndpoint:provider.baseURL,requests};
const save=()=>writeFile(evidencePath,JSON.stringify(evidence,null,2));
proxy=createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/login'&&ctx){res.writeHead(302,{Location:ctx.connection.authenticatedUrl('http://127.0.0.1:'+ctx.webServer.port)});res.end();return}
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw),entry={index:requests.length+1,startedAt:new Date().toISOString(),model:body.model,tools:body.tools?.map(t=>t.function?.name??t.name)};requests.push(entry);console.log('MODEL '+entry.index+' start');await save();
  const cancel=new AbortController();res.on('close',()=>{if(!res.writableFinished)cancel.abort()});
  const upstream=await fetch(provider.baseURL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:raw,signal:cancel.signal});
  if(!upstream.ok){const text=await upstream.text();entry.status=upstream.status;entry.error=text.slice(0,500);evidence.modelError='Actual model HTTP '+upstream.status+' '+entry.error;await save();res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(text);return}
  res.writeHead(200,{'Content-Type':'text/event-stream'});let tail='',calls=new Map();
  for await(const bytes of upstream.body){res.write(bytes);tail+=Buffer.from(bytes).toString();const lines=tail.split('\n');tail=lines.pop();for(const line of lines)if(line.startsWith('data: {')){try{const d=JSON.parse(line.slice(6));if(d.usage)entry.usage=d.usage;for(const c of d.choices??[]){if(c.finish_reason)entry.finishReason=c.finish_reason;for(const t of c.delta?.tool_calls??[]){if(t.function?.name)calls.set(t.index,t.function.name)}}}catch{}}}
  res.end();entry.elapsedMs=Date.now()-Date.parse(entry.startedAt);entry.calledTools=[...calls.values()];console.log('MODEL '+entry.index+' done '+entry.elapsedMs+'ms '+entry.calledTools.join(','));await save();
 }catch(error){evidence.modelError=error.message;await save();res.destroy(error)}
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
try{
 const profile=join(home,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});await symlink(root,join(profile,'node_modules/ooo-bidpliot'),'dir');await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),'dir');
 await writeFile(join(profile,'package.json'),JSON.stringify({name:'real-review-isolated-profile',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
 const activeProvider={...provider,baseURL:'http://127.0.0.1:'+proxy.address().port+'/v1',apiKeyEnv:'REAL_REVIEW_KEY'};delete activeProvider.apiKey;
 await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:selected},{id:'llm-pi-ai',config:{providers:{[selected.provider]:activeProvider}}},{id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},{id:'session-title-llm',disabled:true}]));
 ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
 const runtime=ctx.get('bidBusiness'),base='http://127.0.0.1:'+ctx.webServer.port,login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
 async function api(path,body,method=body?'POST':'GET'){const r=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const value=await r.json();assert.ok(r.ok,JSON.stringify({path,status:r.status,value}));return value}
 const retry=process.argv.find(a=>a.startsWith('--retry-task='))?.split('=')[1];
 const task=retry?{task:{id:retry}}:await api('/tasks',{title:'杭州-pei · 真实文件审查验证',request_id:randomUUID()});taskId=task.task.id;evidence.taskId=taskId;evidence.base=base;evidence.loginUrl='http://127.0.0.1:'+proxy.address().port+'/login';evidence.files=[];
 for(const name of [tender,bid]){const bytes=await readFile(join(sourceRoot,name));if(!retry){const form=new FormData();form.append('file',new Blob([bytes]),name);await api('/files?task_id='+taskId,form);}evidence.files.push({name,bytes:bytes.length,sha256:sha(bytes)});console.log((retry?'REUSED ':'UPLOADED ')+name+' '+bytes.length)}
 let s=await api('/page-flow/'+taskId);if(!retry){s=await api('/page-flow/'+taskId+'/sources',{main_file:tender,supplements:[],input_version:s.input_versions.analyse},'PUT');s=await api('/page-flow/'+taskId+'/review-input',{bids:[bid],input_version:s.input_versions.review},'PUT');}
 const run=await api('/page-flow/'+taskId+'/action',{kind:'review',request_id:randomUUID(),input_version:s.input_versions.review});sessionId=run.session_id;evidence.sessionId=sessionId;await save();console.log('REAL_LOGIN '+evidence.loginUrl);console.log('REAL_SESSION '+sessionId);
 const handle=runtime.handles.get(sessionId);let timeout;const deadline=new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Real review exceeded 45 minutes')),2700000));
 try{await Promise.race([handle.agent.whenIdle(),deadline]);await runtime.settling.get(taskId)}finally{clearTimeout(timeout)}
 s=await api('/page-flow/'+taskId);evidence.execution=s.execution;evidence.reviewStatus=s.review.status;
 const events=handle.agent.session.snapshotEvents(),names=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data.callId,e.data.name]));
 evidence.toolResults=events.filter(e=>e.type==='tool/result').map(e=>({tool:names.get(e.data.message.toolCallId),isError:e.data.message.isError,returnedTextChars:e.data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').length}));
 evidence.trace_note='Source excerpts omitted from tracked metadata; full native events remain in isolated ignored data/dsh sessions.';
 for(const f of evidence.files){assert.equal(sha(await readFile(join(sourceRoot,f.name))),f.sha256);assert.equal(sha(await readFile(join(dataRoot,'workspace',taskId,'sources',f.name))),f.sha256)}
 evidence.originalAndUploadedBytesUnchanged=true;
 if(s.review.report){const report=s.review.report.report;evidence.report={requirements:report.requirements.length,issues:report.issues.length,severity:Object.fromEntries(['high','medium','low'].map(k=>[k,report.issues.filter(i=>i.severity===k).length])),categories:report.coverage,limitations:report.limitations};evidence.reportPath=join(dataRoot,'workspace',taskId,'work/review/runs',sessionId+'.json')}
 await save();assert.equal(s.execution.state,'completed',s.execution.error);assert.equal(s.review.status,'reviewed');assert.ok(requests.length>1);finished=true;console.log('REAL_PASS '+JSON.stringify(evidence.report));
 if(process.argv.includes('--keep-open'))await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve)});
}catch(error){evidence.failure=error.message;await save();console.error(error);throw error}
finally{if(!finished&&ctx&&taskId&&sessionId&&ctx.get('bidBusiness').handles.get(sessionId)?.agent.status==='running'){try{await ctx.get('bidBusiness').stop(taskId,sessionId)}catch{}}await ctx?.fiber.dispose();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await rm(home,{recursive:true,force:true})}
