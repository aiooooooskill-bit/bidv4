# dsh 接入契约

锁定本机 `@deepseek-ai/dsh 0.2.1-rc.2`，接口依据随包源码与类型，来源仓库为 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

- `cordis.patch.yml`注册页面服务，业务运行时注册唯一客户预设 `ooo-bidpliot`（定义位于 `server/native/preset.mjs`），包含原角色方法、文件／搜索／技能／具体提问及原Python业务工具。没有独立执行或审查预设。
- 正式服务与`cordis.patch.yml`均声明`webServer`、`connection`、`agents`、`llm`、`agentDefaultModel`、`subprocess`、`attachments`依赖。`/api/bidv4`由当前插件处理，经`connection.admit`验证dsh登录；没有引擎HTTP代理。
- 业务子插件复用宿主官方 `agents/sessions/sessionPersistence/sessionQuery/agentLoop/agentPresets/subagents` 等服务。每个项目只绑定一个客户主会话及真实主 Agent，目录／正文与OCR沿用内部子任务，由原生会话控制器直接观察；不桥接、复制或重组消息。执行技能在对应预设中挂载，工具在 Agent 作用域限制为现有业务与文件工具，不将业务能力注入普通宿主会话。
- 上下文计量复用宿主 `tokenMeter`；自动摘要和工具回执裁剪在客户预设的官方隔离组内挂载 `dsh-compaction-basic` 与 `dsh-compaction-tool-result-pruner`，沿用官方标准预设的归属方式。摘要预留及输出预算为8192 tokens，主会话、恢复会话和继承预设的子任务共用该策略，不修改普通宿主预设。Web／桌面宿主关闭全局压缩后端，因此仅声明依赖或复用宿主 Agent 不会自动启用压缩。`tests/preset-compaction.test.mjs` 使用完整官方Web配置验证自动摘要、裁剪、超限恢复及冷恢复；隔离底层组件测试不能替代此项验证。已发布0.1.1漏挂这组组件，该修复合并到0.1.2发布包。
- 业务执行现在参与宿主官方事件策略与落盘屏障，不再建立独立事件总线。插件卸载停止自己发起的工作并释放所持句柄，宿主保留原生历史与会话生命周期。
- 文件预设显式依赖`attachments`与`llm`，保证官方`read_image`注册；OCR只允许该工具，使用父级provider/model。原图片转写提示、PDF分页和转换文件契约保留。
- 主会话与原有子任务均位于宿主当前配置的官方会话存储；图片复用宿主配置的`DSH_HOME/attachments/v1`，不建立第二个私有附件库；业务输出位于各项目`work`。fs默认完整访问，业务工具落盘仍按项目/章节契约。
- 本地子Agent失败时，插件读取公开`localAgent`终态日志补足结果中缺失的诊断；目录/正文、OCR及知识整理均保留具体原因。
- 页面状态投影为`running/needs_input/completed/failed/stopped`。具体选项按session_id、call_ids与结构化batches对账；单阶段停止请求同时校验 session_id/action_id，全流程停止校验 workflow_id，整批验证后提交官方`userQuestions.answer`。结束轮次却缺少阶段必需文件按失败展示。
- 项目绑定持久化在 `data/conversations/<task_id>.json`，不同项目不共享客户主会话。阶段使用独立 `action_id`、开始／结束事件范围和结束状态；审查报告与批次按会话及轮次存储，避免后续轮次污染历史结果。
- 审查处理记录同时校验 `session_id` 和已有报告的 `created_at`；同一主会话重新审查后，旧报告页面不能保存备注到新报告，问题选择、页码与备注按报告版本重置。
- 动作request_id回执防止重复启动；上游输入版本防止陈旧动作。写工具回执防止重复副作用，不确定结果先读实际文件。产物和DOCX写锁使用操作系统文件锁，支持短生命周期工具进程。
- 解读、制作和审查工作台均提供项目 `session_id` 的直达入口，先经工作台草稿离开保护，再调用官方 `uiWorkspace.openSession` 打开原生 Chat。没有注册 `conversation.view`、聊天节点或独立主面板；全部对话、工具和轨迹沿用 DSH 原有组件。
- 实时更新、刷新、重连和历史分页由宿主官方 Session Controller、Client Sessions 和 Conversation 链路提供。所有 Agent 对话均使用 DSH 原生界面与上传、输入、工具和结果展示，没有只读输入限制或自定义聊天渲染。
- 聊天预设通过 project/status/run/answer/read 工具复用工作台业务服务。导入仅接受当前会话原始用户事件中真实附件的 attachmentId，使用官方附件读取接口导入项目；不接收任意本地路径。公司、代表、来源、问题回答均调用同一业务校验，不伪造承诺。
- 自动流程复用 `BusinessRuntime.action` 依次执行 analyse/outline/build/review，已有有效成果先验证复用。阶段、session_id、暂停和继续状态保存在独立 `data/workflows/<task_id>.json`，不混入动作回执或复制会话。两个入口共享任务与主会话并互斥执行，错误和停止不得推进到下一阶段。
- 冷历史可以由官方控制器恢复一个空闲 Agent，以保留原生服务能力；查看不会派发模型，也不创建业务动作。业务运行时复用已恢复的同一 Agent。此前私有日志不自动迁移。
- 客户端继续使用原 sidebar/footer/overlay 扩展点，工作台的自动流程入口与报告/文件展示复用现有组件。宿主会话列表的更新通知工作台刷新项目，业务 Agent 和页面显示同一份真实数据。

随包依据：`dsh-agent-default-model`、`dsh-agent-preset-registry`、`dsh-subagent`、`dsh-subagent-spawn-in-process`、`dsh-session-persistence-jsonl`、`dsh-session-checkpoint-policy`、`dsh-attachment-local`、`dsh-tool-fs`、`dsh-tool-ask-user`。使用未修改的官方`dsh-scope@0.2.1-rc.2`；本地vendor覆盖和依赖override已取消，不保留替换加载器或运行时补丁。

当前工程验证见 [合入验收](MERGE-ACCEPTANCE.md)。双插件整理按用户决定暂缓。

0.2.1 子任务使用 `startActivation` 和 `childId`。四种内部角色使用官方 spawn provider 的命名实例，通过官方持久 descriptor.provider 恢复角色，继续只公开一个 `ooo-bidpliot` 预设。Agent 作用域的角色提示与工具白名单在创建/冷恢复时重装。父调用取消后显式 dispose 并等待子任务收尾；目录写入约束在派发前按保留的 childId 注册。阶段工具白名单必须在第一条模型请求前完成激活。

官方组件只声明为宿主 peer，开发 SDK 提供独立目录验证环境；自有运行依赖保留在 dependencies。doctor 检验 engines.dsh 与 Cordis/loader 的精确版本，浏览器 React/客户端注入模块不作 Node 包必需检查。0.2.0 合成会话只作为只读原始字节的恢复测试材料，不提供旧宿主运行兼容。
