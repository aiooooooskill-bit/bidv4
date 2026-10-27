import {fork,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
export async function analysisFixture(home){
 const temporary=!home;home??=await mkdtemp(join(tmpdir(),'bidv4-analysis-host-'));
 const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',BID_DELIVERY_INSTALL:root};delete env.NODE_TEST_CONTEXT;delete env.DSH_TOOLS_MODE;
 const cli=join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js');
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'plugin','--profile','web','add','link:'+root],{env,cwd:root,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('close',code=>code?reject(Error(output)):resolve())});
 const child=fork(join(root,'tests/helpers/delivery-host.mjs'),[],{env,cwd:root,stdio:['ignore','pipe','pipe','ipc']});let output='',ready,stopped=false;
 const requests=new Map();child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
 const readyPromise=new Promise((resolve,reject)=>{ready={resolve,reject}});
 child.on('message',message=>{if(message.ready){ready.resolve(message.result);return}const pending=requests.get(message.id);if(pending){requests.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error(message.error.stack)):pending.resolve(message.result)}});
 child.on('exit',code=>{stopped=true;const error=Error('Isolated analysis host exited '+code+'\n'+output);ready.reject(error);for(const pending of requests.values()){clearTimeout(pending.timer);pending.reject(error)}});
 const command=(command,args)=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{requests.delete(id);reject(Error(command+' timed out\n'+output))},['chatFull','fullWorkflow','waitWorkflow','nativeAnswer'].includes(command)?120000:45000);requests.set(id,{resolve,reject,timer});child.send({id,command,args})});
 const state=await readyPromise;
 const login=await fetch(state.loginUrl,{redirect:'manual'}),authenticated=await fetch(login.headers.get('location'),{redirect:'manual'});
 const cookie=authenticated.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
 const api=(path,options={})=>fetch(state.base+'/api/bidv4'+path,{...options,headers:{Cookie:cookie,Origin:state.base,...options.headers}});
 return {state,home,command,api,async kill(){if(stopped)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited},async close(retainHome=false){try{if(stopped)return;await command('close');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve)})}finally{if(child.exitCode===null)child.kill('SIGTERM');if(temporary&&!retainHome)await rm(home,{recursive:true,force:true})}}};
}
