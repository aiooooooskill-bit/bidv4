# DSH 上游更新与插件不兼容排查

检查日期：2026-10-27（北京时间）。范围为官方发布标签、完整源码差异、本机桌面 ASAR 运行时、Web profile 与插件清单。此次只做检查，未改插件、用户 profile 或版本豁免。

## 结论

本机桌面 DSH 已是 `0.2.1-rc.3`。投标插件与 Office 插件仍将 `engines.dsh` 精确声明为 `0.2.1-rc.2`，官方检查函数因此拒绝。已在已安装 App 的真实 ASAR 中直接调用官方函数复现，不是根据报错文字猜测。

取消精确锁定可以解决这次声明层面的阻断，但不能只删除一个字段，更不能据此声称未来任意版本均可运行：

1. 官方门禁优先检查 `engines.dsh`；有这个字段时，不再用 DSH peer 判断。
2. 删除该字段后，门禁会检查 `@deepseek-ai/dsh` 及 `@deepseek-ai/dsh-*` peer。本项目这些 peer 同样精确锁在 rc.2，因此仍会拒绝 rc.3。
3. 本项目 `server/installation.mjs` 的 doctor 还有 `actual !== required` 检查。只改清单为范围，doctor 也不会正确处理范围。
4. 开发 SDK、lockfile 和验收脚本仍使用 rc.2。开发环境可重复安装与插件支持的宿主范围是两件事，不能把开发依赖可重复安装也一并取消。

工程上优先使用明确的宿主支持范围，统一门禁声明与 doctor 的判断。若决定完全不声明宿主版本，则需要同时移除门禁所读取的 DSH peer 版本限制与自有版本硬校验，并接受未来接口变化只能在运行/验收中发现。这里记录决策影响，尚未实施其中任何一种方案。

## 本机实际版本

| 对象 | 实际情况 | 判断 |
| --- | --- | --- |
| 已安装桌面 App、dsh、app-boot | 0.2.1-rc.3 | 从 App 内部 package.json 与官方 getDshRuntimeVersion 读取 |
| 桌面 Cordis / loader | 4.0.5 / 1.0.6 | 与当前项目要求相同 |
| 桌面投标插件 | ooo-bidpliot 0.1.10，engines.dsh 为 rc.2 | 官方函数拒绝，未启用豁免 |
| Web profile 投标插件 | link 到本工作区，package.version 为 0.1.6，engines.dsh 为 rc.2 | 对 rc.3 做官方检查也拒绝 |
| Office 插件 | @local/dsh-office 0.2.0，engines.dsh 为 rc.2 | 对 rc.3 做官方检查拒绝 |
| 本工作区开发 SDK | @deepseek-ai/dsh 0.2.1-rc.2 | 不能代表已安装 App 版本 |
| 本机已有 npx 缓存 | @deepseek-ai/dsh 0.2.1-rc.2 | 缓存不代表实时运行版本 |

检查时未发现独立 Web CLI 宿主进程，因此不把桌面 rc.3 写成“正在运行的 Web CLI 版本”。当前 shell 也没有全局 `dsh` 命令；项目 npm script 可使用本地 node_modules/.bin。

桌面与 Web 的投标插件不是同一份安装。对工作区源码的判断不能直接当作桌面 0.1.10 的业务验收结果。

## rc.2 到 rc.3 更新了什么

官方 rc.3 发布于 **2026-10-23 23:26:39（北京时间）**，发布标签提交 `1f81c047fc48fa190a683e469daa699857e9afe8`，标记为 prerelease。

完整发布比较为 6 个提交、640 个差异文件，其中 349 个是 package.json。GitHub compare API 的 files 列表在 300 项处截断，本次另取完整 `.diff`，没有把前 300 个文件当作全部改动。

| 变化 | 源码核对与对本项目的意义 |
| --- | --- |
| 三处导航“更多”菜单 | 左侧栏、会话视图、右侧栏提供浏览插件和创建插件入口；Web bundle 新挂载 ui-entry-customization。创建入口准备草稿，用户发送后才执行。并不是自动为本投标插件替换入口。 |
| 新会话保留草稿 | startSession 改为复用工作区中符合条件的空白会话；指定 preset 时跳过其他 preset 的空白会话。增加 whenDraftExists 的 keep/replace/append 策略。项目目前使用的 uiWorkspace.openSession 入口仍在。 |
| DeepSeek API Key 模型列表 | 官方源、内置模型目录使用 /models 动态列表，与账号登录路线共用列表解析/缓存能力；自定义源或自定义模型目录不套用这一模式。默认列表请求期限 5 秒、缓存年龄 10 分钟。不是更换本插件的模型编排引擎。 |
| 其他界面调整 | 菜单图标、Tooltip 定位、视图显隐状态，以及桌面导航/预设选择相关产品事件。 |

发布差异中，Agent loop、scope、subagent、compaction、session persistence、app-boot 兼容门禁、host plugin-manager 和 HMR 没有实现源码变动；相关版本清单升级不等于 API 被重写。session-controller 客户端此处只有注释更新。

本项目使用的 `sidebar.footer.action` 与 `shell.overlay` 未在这次发布中被删除。不能把新增“更多”菜单直接解释为原插件入口失效。

## 已执行验证与边界

- 在已安装 rc.3 App 的 Electron Node 模式下，直接调用官方 `evaluatePluginCompatibility`：桌面投标发行包、工作区投标源码、Office 插件均因 engines.dsh=rc.2 被拒绝。
- 只在内存副本中将 engines.dsh 改为 rc.3，三个检查均通过；未写回安装清单。这证明当前门禁拒绝的直接原因，不证明业务完整兼容。
- 在同一真实 ASAR 中导入本工作区静态使用的 7 个官方包，核对 11 个导出符号均存在：scopeChainOf、scopeOf、defineTool、validateJsonSchemaValue、ToolArgsError、createUserMessage、spawn provider apply、foldSubagentDescriptor、BasicCompactionEngine、toolPairingBalancedBefore/After。
- 本项目 doctor：传入 rc.2 时通过；传入 rc.3 时只报告 DSH 版本不匹配，复现自有第二道限制。
- 未执行新版宿主的完整业务生成、历史恢复、子任务取消、压缩恢复和浏览器交互验收；不把接口存在写成端到端通过。

升级验收应覆盖：插件启停与重新加载、入口和原生 Chat 打开、原项目历史恢复、主子任务执行/取消、压缩、一个完整业务阶段及产物下载。现有真实模型验收是否覆盖 rc.3 仍待确认。

## 上游开源项目情况

官方项目为 MIT 许可证，仓库未归档且持续维护。README 明确定位为 developer preview，并说明会出现破坏兼容性的变化。因此，版本从 rc.2 到 rc.3 很小本身不是兼容保证。

官方 CONTRIBUTING 说明目前不接受外部 PR，问题反馈走 GitHub Discussions。仓库关闭 Issues/外部 PR 不等于停止维护，但依赖方不能假设能通过外部补丁快速获得官方合入。

本次读到的 master 提交为 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。官方比较返回 master 相比 rc.3 领先 1533 个提交，包含开发历史与合并；不能把这些变化都算进已发布 rc.3，也不能用 master 的同名包版本号代表发布内容。适配应以发布标签和实际安装产物为准。

还有一个分发差异：本次 `npm view` 在官方 registry 返回 latest/next 仍是 rc.2，但显式查询 rc.3 版本存在；直接读取 registry 的 latest 端点也返回 rc.2。因此 `npx @deepseek-ai/dsh web` 与已升级桌面 App 可能选择不同宿主版本。该观察不推断为 npm 冷却策略、撤回或发布故障，原因未确认。

## 决策判断

先反对“完全取消约束就万事大吉”：它消除了提前拒绝能力，无法消除真实接口变化；主线迭代很快，而本项目同时依赖会话、子任务、压缩和客户端服务，未来故障可能直到恢复历史或生成文档时才暴露。只删除 engines 甚至不能解决当前拒绝。

支持“取消精确锁定”的证据更强：本次相关核心实现未变，11 个导出均存在，版本门禁拒绝已准确复现；每次候选补丁发布都强迫重发插件，会增加维护成本。因此本次更合理的方向是取消单版本精确限制，用统一的支持范围与实际宿主验收承接升级。

最大未知是 rc.3 的完整运行验收。如果发现历史恢复、子任务生命周期、压缩或界面接入的行为变化，便需要实际适配，不能靠扩大版本范围解决。完全无版本门禁是可选产品策略，但“未来任意版本兼容”不是本次证据支持的结论。

## 原始依据

- [官方 rc.3 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3)
- [rc.2 到 rc.3 完整比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.2...dsh-v0.2.1-rc.3)
- [rc.3 官方兼容检查实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/boot/app-boot/src/plugin-compatibility.ts)
- [rc.3 导航菜单说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-entry-customization/README.zh.md)
- [rc.3 工作区导航实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-workspace/src/client/navigation.ts)
- [rc.3 API Key 模型列表实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/llm/llm-deepseek-api-key/src/index.ts)
- [官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/README.md)、[贡献规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/CONTRIBUTING.md)
- [npm latest 查询端点](https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest)
- 本地证据：`outputs/dsh-upstream-audit-20261027/` 下完整 diff、文件清单、官方 ASAR 函数检查结果和上游查询摘要。
