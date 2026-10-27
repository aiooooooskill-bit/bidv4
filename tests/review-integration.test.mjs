import test from 'node:test';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
const title='单轮审核全链路：解析、要点、引用、报告、停止和冷恢复';
if(process.env.BIDV4_REVIEW_PIPELINE_FIXTURE==='1')test(title,{timeout:180000},async()=>{await import('./fixtures/review-host.mjs')});
else test(title,{timeout:200000},()=>runIsolatedTest('review-integration.test.mjs','BIDV4_REVIEW_PIPELINE_FIXTURE',new RegExp(title),190000));
