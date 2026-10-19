import test from 'node:test';
import assert from 'node:assert/strict';
import {transcribe} from '../server/native/tools.mjs';
test('model without image declaration is rejected before reading or sending an OCR page',async()=>{
 const ctx={llm:{async resolveModelInfo(provider,model){assert.equal(provider,'fictional');assert.equal(model,'text-only');return {inputModalities:['text']}}},subprocess:{spawn(){assert.fail('OCR page must not be read without image support')}},subagents:{startActivation(){assert.fail('No image may be sent to an unsupported model')}}};
 await assert.rejects(transcribe(ctx,{needs_ocr:true,pages:[{page:1,path:'/unused-fictional.png'}]},{agent:{session:{requestHeader(){return {config:{provider:'fictional',model:'text-only'}}}}},signal:new AbortController().signal}),/未声明图片输入能力/);
});
