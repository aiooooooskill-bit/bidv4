import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRegions} from '../server/native/stage-context.mjs';

const msg=(role,content)=>({role,content});
const text=text=>({type:'text',text});
const call=(name,id)=>({type:'tool-call',name,id,arguments:'{}'});
function fixture(messages){
 const events=messages.map((message,seq)=>({seq,type:message.role==='tool'?'tool/result':message.role+'/message',data:message.role==='user'?message:{message}}));
 return {surface:{nodes:events.map(e=>e.seq),replaceGeneration:0},eventAt:seq=>events[seq],deriveEventMessage:e=>e.type==='user/message'?e.data:e.data.message};
}
test('跨阶段仅归档旧工具：保留用户原话、富文本、问答和结论，不拆并行工具对',()=>{
 const rich=msg('user',[text('只投包3；服务期按我确认的三年。'),{type:'image',attachment:'unchanged-image'}]);
 const messages=[msg('system',[text('系统')]),rich,msg('assistant',[call('read','a'),call('read','b')]),msg('tool',[text('完整证据A')]),msg('tool',[text('完整证据B')]),msg('assistant',[text('请确认三年是否包括准备期？')]),msg('assistant',[call('ask_user_question','q'),call('read','c')]),msg('tool',[text('问题及选项')]),msg('tool',[text('证据C')]),msg('user',[text('包括准备期。')]),msg('user',[text('生成的旧页面指令')]),msg('assistant',[call('read','d')]),msg('tool',[text('完整证据D')]),msg('assistant',[call('read','current')]),msg('tool',[text('当前阶段证据')])];
 const s=fixture(messages),regions=stageRegions(s,13);
 assert.deepEqual(regions.map(r=>r.map(n=>n.seq)),[[2,3,4],[11,12]]);
 assert.equal(s.deriveEventMessage(s.eventAt(1)),rich);
 assert.deepEqual(stageRegions(s,3).map(r=>r.map(n=>n.seq)),[],'截点处未收齐并行结果不可归档');
 assert.deepEqual(stageRegions(s,0),[]);
});
test('未完成工具、摘要中的确认信息和未知来源用户消息均保留',()=>{
 const s=fixture([msg('user',[text('既有压缩摘要：已确认包3')]),msg('assistant',[call('read','x')])]);
 assert.deepEqual(stageRegions(s,100),[]);
});
