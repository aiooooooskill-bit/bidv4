import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {dataRoot} from '../server/native/business.mjs';
import {reserveBodyAssignment,bodyAssignment,BodyTaskSlots} from '../server/native/body-assignments.mjs';
let serial=0;
async function fixture({status='draft',active=true,live=false,failDrain=false,changed=false}={}){
 const tid='required-recovery-'+(++serial),dir=join(dataRoot,'actions',tid),writers=join(dir,'writers');
 await mkdir(writers,{recursive:true});
 const record={action_id:'one',session_id:'parent',kind:'build',section_paths:['body/A.docx']};
 await writeFile(join(dir,'latest.json'),JSON.stringify(record));
 await writeFile(join(writers,'old.json'),JSON.stringify({action_id:'one',parent_id:'parent',section_paths:record.section_paths,status:active?'active':'released'}));
 const parent={},agents=new Map([['parent',parent]]);if(live)agents.set('old',{});
 let drains=0;
 const ctx={agents,subagents:{async drainChildren(p,ids){assert.equal(p,parent);assert.deepEqual(ids,['old']);drains++;if(failDrain)throw Error('drain rejected');if(changed)await writeFile(join(dir,'latest.json'),JSON.stringify({...record,stopped_at:1}));}},subprocess:{spawn(){return {stdin:{on(){},end(){}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:JSON.stringify({result:{body_sections:[{path:'body/A.docx',status,validated_action_ids:['one']}]}})})}},terminate(){},waitForExit(){}}}}};
 const reserve=()=>reserveBodyAssignment(ctx,tid,'new','parent',record.section_paths,new AbortController().signal);
 return {ctx,tid,reserve,drains:()=>drains,dir};
}
test('C04: nonresident stale owner drains before recovery; draft may resume',async()=>{const f=await fixture();const release=await f.reserve();assert.equal(f.drains(),1);assert.equal((await bodyAssignment(f.tid,'old')).status,'released');await release()});
test('C04: live owner is never stolen',async()=>{const f=await fixture({live:true});await assert.rejects(f.reserve(),/未结束/);assert.equal(f.drains(),0);assert.equal((await bodyAssignment(f.tid,'old')).status,'active')});
test('C04: failed drain retains ownership',async()=>{const f=await fixture({failDrain:true});await assert.rejects(f.reserve(),/drain rejected/);assert.equal((await bodyAssignment(f.tid,'old')).status,'active')});
test('C04: action stopped during drain cannot acquire',async()=>{const f=await fixture({changed:true});await assert.rejects(f.reserve(),/变化或停止/);assert.equal(await bodyAssignment(f.tid,'new'),null)});
test('C07: same-action ready chapter cannot replay after normal release',async()=>{const f=await fixture({status:'ready',active:false});await assert.rejects(f.reserve(),/不能重复派发/);assert.equal(await bodyAssignment(f.tid,'new'),null)});
test('C07: stale active owner with ready chapter drains but cannot rewrite',async()=>{const f=await fixture({status:'ready'});await assert.rejects(f.reserve(),/不能重复派发/);assert.equal(f.drains(),1)});
test('C07: explicit new action may revise previously ready chapter',async()=>{const f=await fixture({status:'ready',active:false});const rec=JSON.parse(await readFile(join(f.dir,'latest.json')));await writeFile(join(f.dir,'latest.json'),JSON.stringify({...rec,action_id:'two'}));await(await f.reserve())()});
test('same-action old ready without current proof remains resumable',async()=>{const f=await fixture({status:'ready',active:false});f.ctx.subprocess.spawn=()=>({stdin:{on(){},end(){}},done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:JSON.stringify({result:{body_sections:[{path:'body/A.docx',status:'ready',validated_action_ids:['older']}]}})})}},terminate(){},waitForExit(){}});const release=await f.reserve();await release()});
