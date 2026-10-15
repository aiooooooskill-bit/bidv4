import {join} from 'node:path';
import {root} from './business.mjs';
export const presetDefinition={id:'ooo-bidpliot',name:'ooo-bidpliot',description:'页面操作，dsh运行业务，Agent展示真实进度与文档',plugins:[
 // Web/desktop hosts disable global compaction; each preset owns its backend.
 {id:'compaction',name:'cordis:group',group:true,isolate:{compaction:true,toolResultPruner:true},config:[
  {id:'tool-result-pruner',name:'@deepseek-ai/dsh-compaction-tool-result-pruner',config:{}},
  {id:'compaction-basic',name:'@deepseek-ai/dsh-compaction-basic',config:{headroomTokens:8192}},
 ]},
 {name:'@deepseek-ai/dsh-persona',config:{prefix:'你是招投标Agent。用户对话与工作台共用一个项目、一个连续会话；阶段由你在主会话执行；目录、正文和图片识别保留原有内部子任务。客户无需切换Agent模式。先用ooo_bidpliot_project列真实附件、创建项目、导入并区分招标与投标文件、配置来源和主体；已有资料直接复用，不编造编号、承诺或公司。ooo_bidpliot_run启动单阶段或full流程，返回当前阶段指令后由你在本会话直接执行，不等待其他Agent，不重复调用run。每一步严格遵循技能；使用当前任务的绝对路径访问文件，来源在sources，成果在work，技能在skills。只有缺少必要事实才用ask_user_question一次提问，pending后停轮；用户文字回答时用ooo_bidpliot_answer提交真实问题的具体答复。自动流程在阶段结束后自动继续，无需用户回复继续。审查只读原件和制作成果，仅保存本轮依据、比较批次与报告，事实与条件不清楚列需确认，不虚构冲突或得分，不做独立复审。完成后用ooo_bidpliot_read读取真实最终内容并直接展示，用ooo_bidpliot_status取得真实下载链接。审查数量只使用ooo_bidpliot_status返回的review.summary_items、issue_counts和reviewed_items，优先逐字引用summary_items，不自行统计、不沿用对话中的旧数字；完整报告按需再读取。会话轮次结束不等于业务完成；只按工具结果判断。不要输出MAND/REQ/TPL/SCORE内部编号。',includeRuntimeContext:true}},
 {name:'@deepseek-ai/dsh-tool-fs',inject:['tools','fs','systemPrompt','attachments','llm'],config:{}},
 {name:'@deepseek-ai/dsh-tool-fs-search',config:{sampleOverCapGlobResults:false}},
 {name:'@deepseek-ai/dsh-tool-skill',config:{}},{name:'@deepseek-ai/dsh-tool-ask-user',config:{mode:'timed',timeout:1}},
 {name:'@deepseek-ai/dsh-skill-filesystem',config:{includeDefaultRoots:false,customSkillDirs:[join(root,'business/python/app/skills')],watch:false}},
 {name:'ooo-bidpliot/tools',config:{}},{name:'ooo-bidpliot/agent',config:{}},
]};
