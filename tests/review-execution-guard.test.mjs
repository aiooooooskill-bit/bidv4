import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {dataRoot} from '../server/native/business.mjs';
import {installExecutionGuard} from '../server/native/execution-guard.mjs';

const title='审查OCR子任务可读图片，原件和前序成果不可写，停止后禁止继续';
if(process.env.BIDV4_REVIEW_GUARD_FIXTURE!=='1')test(title,()=>runIsolatedTest('review-execution-guard.test.mjs','BIDV4_REVIEW_GUARD_FIXTURE',new RegExp(title)));
else test(title,async()=>{
 const tid='review-guard',cwd=join(dataRoot,'workspace',tid),action=join(dataRoot,'actions',tid);
 await mkdir(action,{recursive:true});
 const record={kind:'review',session_id:'review-main'};
 await writeFile(join(action,'latest.json'),JSON.stringify(record));
 const main={session:{id:'review-main',header:{cwd}}},child={session:{id:'review-ocr',header:{cwd,origin:'subagent',parentSession:'review-main'}}};
 let handler;const ctx={on(name,fn){if(name==='tools/execute')handler=fn;return()=>{}},agents:new Map([['review-main',main]]),fs:{async resolve(path){return {targetKey:resolve(path)}}}};
 installExecutionGuard(ctx,()=>{});
 let passed=0;const run=(agent,name,file)=>handler({agent,name,arguments:{file_path:join(cwd,file)}},async()=>{passed++;return {content:[]}});
 await run(child,'read_image','work/review/parse/bid-0/page.png');
 await run(main,'write','work/review/analysis/evaluation.md');
 assert.equal(passed,2);
 for(const [agent,name,path] of [[main,'write','sources/招标.docx'],[main,'edit','work/analysis/evaluation.md'],[child,'write','work/review/analysis/evaluation.md'],[main,'docx_section_revise','work/body/正文.docx']])await assert.rejects(run(agent,name,path));
 await writeFile(join(action,'latest.json'),JSON.stringify({...record,stopped_at:1}));
 await assert.rejects(run(child,'read_image','work/review/parse/bid-0/page.png'),/变化或停止/);
 assert.equal(passed,2);
});
