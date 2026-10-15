import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSummary} from '../server/native/chat-tools.mjs';
test('Agent状态使用当前正式报告的分类统计，计入程序检查，不沿用旧版或未完成报告',()=>{
 const state={status:'reviewed',input_version:'current',report:{completed:true,input_version:'current',report:{requirements:[{},{}],issues:[{risk_type:'disqualification'},{risk_type:'scoring'},{risk_type:'confirmation'}],document_issues:[{risk_type:'suggestion'},{risk_type:'suggestion'}],summary_items:['正式报告摘要']}}};
 assert.deepEqual(reviewSummary(state),{status:'reviewed',report_ready:true,completed:true,reviewed_items:2,issue_counts:{'可能废标':1,'评分失分风险':1,'需确认':1,'建议修改':2},total_issues:5,summary_items:['正式报告摘要']});
 assert.equal(reviewSummary({...state,status:'running'}).completed,false);
 assert.equal(reviewSummary({...state,input_version:'changed'}).report_ready,false);
 assert.equal(reviewSummary({...state,report:{...state.report,completed:false}}).total_issues,0);
 assert.equal(reviewSummary({status:'unreviewed',input_version:'current',report:null}).reviewed_items,0);
});
