import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {root,dataRoot} from '../server/native/business.mjs';
import {installExecutionGuard} from '../server/native/execution-guard.mjs';
const title='原生read/glob/grep阻止祖先目录绕过，允许当前主体原件并记录版本';
if(process.env.BIDV4_GUARD_FIXTURE!=='1')test(title,()=>runIsolatedTest('company-read-guard.test.mjs','BIDV4_GUARD_FIXTURE',new RegExp(title)));
else test(title,async()=>{
 const script=`import os,sys,asyncio,json
sys.path.insert(0,'${root}/business/python');os.environ['DATA_DIR']='${dataRoot}'
from app import db,company_store as cs,artifact_store
from app.services import company_library as lib,bidder
db.init_db();c=asyncio.run(lib.save_company(lib.CompanyBody(name='甲公司',profile={'legal_name':'法人'})))
t=db.create_task('原生读取校验');artifact_store.ensure_task_skeleton(t['id'])
asyncio.run(bidder.save_bidder(t['id'],bidder.BidderBody(company_id=c['id'],signer_id='legal',sign_date='2026-10-12')))
i=db.kb_insert_item(file_name='甲公司.png',file_hash='own',title='资质',ext='.png');cs.attach_asset(i['id'],c['id'])
print(json.dumps({'tid':t['id'],'kid':i['id']}))`;
 const {tid,kid}=JSON.parse(execFileSync(join(root,'business/python/.venv/bin/python'),['-c',script],{encoding:'utf8'}));
 const cwd=join(dataRoot,'workspace',tid),action=join(dataRoot,'actions',tid);await mkdir(action,{recursive:true});await writeFile(join(action,'latest.json'),JSON.stringify({kind:'body',session_id:'s1'}));
 const subprocess={spawn(options){const p=spawn(options.argv[0],options.argv.slice(1),{cwd:options.cwd,stdio:'pipe'});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);const done=new Promise((r,j)=>{p.on('error',j);p.on('close',exitCode=>r({exitCode}))});return {stdin:p.stdin,done,collected:{stdout:{readFrom:()=>({text:stdout})},stderr:{readFrom:()=>({text:stderr})}},terminate(){if(p.exitCode===null)p.kill()},waitForExit(){return done}}}};
 let handler;const ctx={subprocess,on(name,fn){if(name==='tools/execute')handler=fn;return ()=>{}},fs:{async resolve(path){return {targetKey:resolve(path)}}}};installExecutionGuard(ctx,()=>{});
 const agent={session:{id:'s1',header:{cwd}}};let calls=0;
 for(const name of ['read','glob','grep']){
  await assert.rejects(handler({name,agent,arguments:{file_path:join(dataRoot,'workspace')},signal:new AbortController().signal},()=>{calls++;return 'foreign text'}),/上级目录/);
 }
 assert.equal(calls,0);
 const own=join(dataRoot,'workspace/knowledge/files/甲公司.png');
 assert.equal(await handler({name:'read',agent,arguments:{file_path:own},signal:new AbortController().signal},()=>{calls++;return 'own text'}),'own text');
 const state=JSON.parse(execFileSync(join(root,'business/python/.venv/bin/python'),['-c',`import json;print(open('${cwd}/work/body/.build-state.json').read())`],{encoding:'utf8'}));
 assert.equal(state.asset_reads.s1.assets[kid].revision,1);assert.equal(calls,1);
});
