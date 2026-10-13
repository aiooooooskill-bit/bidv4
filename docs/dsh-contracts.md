# dsh 接入契约

锁定本机 `@deepseek-ai/dsh 0.2.0-rc.2`，接口依据随包源码与类型，来源仓库为 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

- `cordis.patch.yml`注册页面服务和聊天只读预设`ooo-bidpliot`。私有项目执行作用域注册`ooo-bidpliot-execution`，包含原角色方法、文件/搜索/技能/具体提问及22个Python业务工具。
- 正式服务与`cordis.patch.yml`均声明`webServer`、`connection`、`agents`、`llm`、`agentDefaultModel`、`subprocess`、`attachments`依赖。`/api/bidv4`由当前插件处理，经`connection.admit`验证dsh登录；没有引擎HTTP代理。
- 插件在独立Cordis Context中组装官方会话、JSONL持久化、循环、子Agent、问题、工具、预设和fs服务；独立事件总线隔离宿主的全局监听。复用宿主`llm`、`agentDefaultModel`、`subprocess`和`attachments`实例；新动作读取`agentDefaultModel.currentSelection()`。子Agent通过父级预设组合，再应用原角色persona和工具范围。
- 业务运行时挂载官方`session-checkpoint-policy`，请求前缀和顶层工具调用落盘失败时不得继续派发。宿主其他事件策略不会自动成为业务策略。
- 文件预设显式依赖`attachments`与`llm`，保证官方`read_image`注册；OCR只允许该工具，使用父级provider/model。原图片转写提示、PDF分页和转换文件契约保留。
- 会话位于项目`data/dsh/sessions`；图片复用宿主配置的`DSH_HOME/attachments/v1`，不建立第二个私有附件库；业务输出位于各项目`work`。fs默认完整访问，业务工具落盘仍按项目/章节契约。
- 本地子Agent失败时，插件读取公开`localAgent`终态日志补足结果中缺失的诊断；目录/正文、OCR及知识整理均保留具体原因。
- 页面状态投影为`running/needs_input/completed/failed/stopped`。具体选项按session_id、call_ids与结构化batches对账，整批验证后提交官方`userQuestions.answer`。结束轮次却缺少阶段必需文件按失败展示。
- 动作request_id回执防止重复启动；上游输入版本防止陈旧动作。写工具回执防止重复副作用，不确定结果先读实际文件。产物和DOCX写锁使用操作系统文件锁，支持短生命周期工具进程。
- 聊天Agent仅调用`bidBusiness`读取状态/产物，不上传、编辑或生成。客户端继续使用原sidebar/footer/overlay扩展点。

随包依据：`dsh-agent-default-model`、`dsh-agent-preset-registry`、`dsh-subagent`、`dsh-subagent-spawn-in-process`、`dsh-session-persistence-jsonl`、`dsh-session-checkpoint-policy`、`dsh-attachment-local`、`dsh-tool-fs`、`dsh-tool-ask-user`。使用未修改的官方`dsh-scope@0.2.0-rc.2`；本地vendor覆盖和依赖override已取消，不保留替换加载器或运行时补丁。

当前工程验证见 [合入验收](MERGE-ACCEPTANCE.md)。双插件整理按用户决定暂缓。
