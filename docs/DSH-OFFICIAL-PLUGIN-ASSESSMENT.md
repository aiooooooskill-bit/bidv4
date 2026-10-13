# 官方插件承接灵燕运行引擎的评估

日期：2026-10-11。依据用户截图中的8项官方插件、本机 `@deepseek-ai/dsh 0.2.0-rc.2` 实现与官方开源仓库。遵循 [AGENTS.md](../AGENTS.md)。本文记录此前只读评估；随后隔离运行的实际结果见 [DSH-NATIVE-VERIFICATION.md](DSH-NATIVE-VERIFICATION.md)，没有修改正式宿主配置。

## 结论与反证

优先组合：**dsh原生Agent循环 + 原生子智能体 + 现有模型/技能/工具/附件/持久会话服务 + 灵燕业务源码**。这能承接运行机制，仍需将灵燕业务技能、工具及页面接口接入。不能把打开插件开关当成业务迁移完成。

反对直接采用“智能体团队”的主要证据：它引入长期成员、共享任务板和成员间消息，超出当前单册目录/逐章写作执行单元需求；官方组合包还禁用普通subagent委派工具，整体启用会影响现有组合。增加第二套任务板并不能自动解决DOCX并发写入或章节绑定。

支持团队模式的条件：确实需要同一批成员长期驻留、跨轮次互发消息、共享带依赖的任务分配，且普通可续接子Agent无法满足。现在没有这一需求证据。若后续出现这些条件，再做独立对比，不默认并用两套协调机制。

最大未知项仍为项目内会话/附件作用域、页面驱动的执行会话、原工具在子级的组合，以及实际停止/恢复。源码证明接口存在，不能证明这些项目场景已经通过。

## 截图中8项插件

| 官方入口 | 实际能力与源码 | 对应灵燕职责 | 本次选择 |
|---|---|---|---|
| Agent循环 | [dsh-agent-loop实现](../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js)：真正的模型/工具循环、并行安全调用、事件和会话；[设置卡片](../node_modules/@deepseek-ai/dsh-client-ui-settings-agent-loop/lib/client.js)只提供已有服务配置 | 主Agent执行、工具调度、执行状态、停止与原生会话恢复 | **核心复用**。删除DeepAgents/LangGraph循环；通过公开ctx.agents接口驱动，不调用循环私有实现 |
| 子智能体 | [subagent服务](../node_modules/@deepseek-ai/dsh-subagent/lib/index.js)、[spawn](../node_modules/@deepseek-ai/dsh-subagent-spawn-in-process/lib/index.js)、[fork](../node_modules/@deepseek-ai/dsh-subagent-fork-in-process/lib/index.js)、[委派工具](../node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js)；截图卡片配置层级、容量及可选模型策略 | 原目录写手、正文写手、分册/分章委派与收集 | **核心复用，先spawn**。原角色提示词和完整输入保持；子级默认继承父级同一模型，不增设子模型选择 |
| 智能体团队 | [官方组合patch](../node_modules/@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml)、[团队服务](../node_modules/@deepseek-ai/dsh-experimental-agent-team/lib/index.js)：长期成员、持久mailbox、共享任务板、任务依赖与owner | 若未来出现常驻成员和跨轮次团队协作，可承接协调；当前不是必要条件 | **本轮不用**。实验性；组合包禁用普通subagent工具。任务文件重叠仅警告，不是文件锁；不能替代业务范围保护 |
| 终端 | [bash工具](../node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js)及执行器：子进程、输出、信号与后台任务；截图是命令时长/输出等设置 | 原Python解析、DOCX、图表等成熟库所需的工具运行 | **按需复用执行能力**。优先固定参数的业务工具调用，检查现有执行器/子进程接口；不因此给Agent开放任意shell，不靠长驻终端维持第二个引擎 |
| 网页搜索 | [DeepSeek搜索实现](../node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js)调用专用Messages搜索端点；[HTTP抓取](../node_modules/@deepseek-ai/dsh-web-fetch-http/lib/index.js)另属抓取能力 | 公共资料检索和原fetch_url的部分职责，不能替代本地公司资料检索 | **按需求接入，非首切片必需**。搜索有独立DeepSeek路由/凭证解析，不等于使用当前任意模型；保持宿主既有配置，不新增本项目搜索模型配置 |
| 自动授权审查 | [auto-review实现](../node_modules/@deepseek-ai/dsh-experimental-auto-review/lib/index.js)在tools/pre-execute前额外调用当前Agent模型，判断工具动作是否获授权 | 执行权限审查，不是标书内容审查，也不负责原灵燕检查工具 | **不引入本轮**。无新授权流程需求，会增加模型调用和审批交互；执行Agent按用户要求默认完整文件权限，聊天展示角色仅开放查询工具 |
| 自动化任务 | [schedule服务](../node_modules/@deepseek-ai/dsh-schedule/lib/index.js)、[组合patch](../node_modules/@deepseek-ai/dsh-experimental-schedule-bundle/cordis.patch.yml)：到期向原会话投递followup，支持定时/周期 | 将来明确需要定时提醒或定时业务动作时可用 | **本轮不用**。用户按页面点击推进；定时投递不等于生成流水线、子任务队列或检查点续跑 |
| 语音输入 | [语音组合patch](../node_modules/@deepseek-ai/dsh-experimental-voice-input-bundle/cordis.patch.yml)、[SenseVoice实现](../node_modules/@deepseek-ai/dsh-experimental-speech-to-text-sensevoice/lib/index.js)：本地音频转文字 | 没有对应引擎职责 | **本轮不用**。不能承接文档OCR；不增加语音依赖或下载识别模型 |

截图中的“官方插件”同时包含可选组合包和已有核心服务的设置页，不能一律按“关闭/未安装运行能力”理解。实际加载以宿主配置及服务注册为准；当前只核对本机包与默认组合，没有改变用户profile，也未据截图推断每个服务的在线状态。

## 不是截图开关，但迁移必须复用的宿主能力

| 能力 | 现有实现 | 项目职责 |
|---|---|---|
| 模型/能力/默认选择 | dsh-llm、agent-default-model及宿主提供方 | 唯一模型来源；主子Agent/辅助调用/OCR同一选择；不复制Key |
| 预设/persona/技能 | agent-preset、agent-preset-registry、persona、skill与现有加载工具 | 执行角色和灵燕业务技能；只读展示作用域与执行作用域分开 |
| 工具与文件权限 | dsh-tools及现有文件/执行服务 | 注册灵燕业务工具、默认完整文件访问；按业务任务/章节定位与版本约束，不加来源只读或跨目录沙箱 |
| 图片附件 | dsh-attachment、attachment-local与模型ImageBlock | OCR视觉输入与持久引用，PDF仍须使用现有库分页；模型不支持图片不能当成识别成功 |
| 会话/状态/持久化 | dsh-agent、session、session-persistence-jsonl | 运行唯一真值、流式状态、取消与重启；不保留agent.db或双写旧run状态 |
| 具体用户问题 | dsh-user-questions | 由原页面承接必要业务选择与输入；不引入泛化结果确认门，子Agent不挂起提问 |

这些能力仍不能替代灵燕的解析契约、招标解读方法、目录来源关联、写作规划、DOCX生成/修订/素材注入/合册、检查函数和公司资料检索。应继续提取和复用这些源码，而不是另找一个通用官方插件冒充完整招投标后端。

## 源码发现转为验证门槛

1. **模型继承与预设组合**：[child-agent实现](../node_modules/@deepseek-ai/dsh-subagent/lib/types/child-agent.js)读取父级最新请求路由，composeFrom组合父级预设，再加persona/toolFilter。验证灵燕工具实际出现在目录/正文子级，不以“父级能调用”推断子级能调用。
2. **并发数量的准确含义**：当前maxActiveSubagents容量池面向可续接子级；一次性/外部运行不受该池限制。Agent循环的maxParallelToolCalls限制并行安全工具组，也不是全项目所有子Agent的总上限。先单任务，再验证两章并行和取消；不能靠设置卡片宣称已经限制全部章节并发。需要批次时按原灵燕执行单元与原生能力收敛，不自建通用队列。
3. **写入保护**：Team的writeScopeWarnings只告警，原生并行调用也不提供业务文件锁。保留章节/册范围、版本、碰撞检测和必要提交原子性。
4. **恢复语义**：原生resume用于持久会话，不是LangGraph节点重启。通过工具未执行/已执行但无结果等故障注入验证，不盲目重复副作用。
5. **页面承接**：官方团队/子Agent自带聊天UI不代表原业务详情页已接入。验证页面按钮、进度、具体选项、解读/目录/DOCX与下载；不新增团队任务板替代页面流程。
6. **数据根**：会话root与附件dshHome需要验证项目范围绑定；cwd不决定所有存储，不能修改其他dsh项目的全局根。
7. **设置与源码版本**：当前在线官方master的spawn实现已与本机版本不同，运行验证以本机锁定包为准，逐项对照公开接口；不无理由升级dsh，也不引入兼容层。

## 采用的最小组合

先保留宿主已存在的核心服务，增加项目执行预设和灵燕业务工具/技能；原生spawn按原目录与正文角色组合persona及工具过滤。原页面调用宿主业务入口，展示Agent只读同一成果。数字文档本地解析、扫描页走同模型ImageBlock；DOCX等需要Python时只调用受控业务函数。

按 [隔离验证方案](DSH-NATIVE-VALIDATION.md) 的V0—V5推进，不全局打开8项插件，不创建第二套工作流产品；不改动用户现有服务/模型/数据。源码评估完成不代表新引擎已通过测试。

## 官方来源与版本

已访问[官方仓库](https://github.com/deepseek-ai/deepseek-harness)，并读取固定commit `d743267388641bc76f17c45ce8b4c231aed1d32c` 的 [spawn源码](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/subagent/subagent-spawn-in-process/src/index.ts) 与 [child-agent源码](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/subagent/subagent/src/child-agent.ts)。各项评估主要以本文链接的本机发布实现、官方bundle patch和随包README为依据；没有把在线master的内部机制直接套进当前安装版本。

## 2026-10-12：本地目录交付检查与修订方案

用户明确当前先使用“添加插件 → 本地目录路径”。本轮检查和隔离实验没有修改运行代码、正式宿主配置或官方源码。结果追加到[当前工程验收记录](evidence/runtime-fix-acceptance.json)的 `localDirectoryDeliveryAudit`；本节是待实施方案。

### 结论

现有 `package.json` 的 bundle/client 声明、`cordis.patch.yml`、服务器入口、业务 Agent 与前端注册组成了可运行的 dsh 插件。Python 是受控短进程工具；模型和凭证复用宿主，HTTP 接口挂载宿主，业务会话隔离。此前模型作用域和附件修复符合插件嵌入目标，应保留；没有理由重写整个招投标业务。

此前“隔离副本先构建，再运行回归并断言资源”的方案解决开发验收缺口，但没有覆盖目录准备、官方安装、版本约束和目录替换后的数据归属。应扩大这一验收边界，而不是仅调整 `verify` 中命令的顺序。

### 实测事实与风险

| 检查 | 实际结果 | 对交付的影响 |
|---|---|---|
| 官方安装接口添加绝对目录 | 临时 profile 安装退出 0，生成 `link:<目录>`，安装路径 realpath 指向原目录 | 插件依赖原目录持续存在；安装器这次没有为链接目录准备 Node/Python 环境或执行构建 |
| 有前端构建、无 Node 环境的目录 | 安装退出 0；宿主加载报 `ERR_MODULE_NOT_FOUND: busboy` | 安装成功不能作为业务可用的判断 |
| 补齐 Node 环境但缺 Python 环境 | 插件激活报 `.venv/bin/python ENOENT`；客户端路径仍能被发现 | 只验证前端资源也不能判断业务可用 |
| 已准备的目录，经官方安装接口挂载 | 六阶段 HTTP 业务、子 Agent 取消、宿主存活、重载与原件哈希检查通过；client、renderer、PDF worker 均 HTTP 200 | 当前机器的本地目录交付链路成立；正向测试复用已安装的 Node 依赖和 Python 环境，不能据此宣称全新机器准备已验收 |
| 同一 profile 从目录 A 换为目录 B | A 有 2 个夹具项目，B 的任务接口 HTTP 200 但返回 0 个；A 数据库哈希未变化 | `dataRoot = <代码目录>/data` 导致换目录后读取另一套数据，不是实验中数据被删除 |
| 官方版本门禁 | 当前仅 `engines.dsh`，官方兼容检查对模拟 0.3.0 不拒绝；声明固定版本的 dsh peer 后正确报告不兼容 | 版本声明应使用官方实际执行的 peer 契约；未测试不同版本运行时崩溃，不能声称一定崩溃 |
| 官方模块依赖精简候选 | 源码/patch 直接引用 24 个官方包，未声明为运行依赖或 peer。临时改为全部 peer、只保留本地 busboy 后，执行预设的 5 行组件显示 never started；恢复完整 Node 环境后同一候选六阶段通过 | 不能把所有官方包一概改成 peer 再删除本地依赖；需要分别验证宿主 API 与私有业务组件的解析和启动 |
| 对已启用目录直接构建 | 前次隔离故障注入证明 client 已替换、renderer 被删除后构建失败，renderer 请求 HTTP 500 | 本地安装链接的是活目录；回归构建必须使用临时副本，更新已启用目录不能只覆盖部分产物 |

正向卸载回归观察到 `flush on a closed handle` 日志；重载后的业务文件和停止状态检查通过。本轮未定位该日志，也没有验证所有会话尾事件，因此不能将其推断为数据丢失或认定完全无害。

`npm pack --dry-run` 另行确认：197 个文件，不包含 dist、.venv 或 data。用户当前采用本地目录路径，这不是当前安装方式的阻断项；未来发行 npm/tgz 时再处理文件白名单、预编译资源和发布元数据。

### 最小改造顺序

1. **先完善目录准备与实际安装验收。** 保留现有 `npm ci`、`uv sync --locked` 和构建能力，统一为明确的准备流程。先在临时副本构建，再用官方安装接口加入临时 profile；检查激活状态、执行预设、前端模块和必要资源，再运行业务回归。增加缺 Node、缺 Python、缺 dist 的拒绝检查。暂不精简已通过的 Node 环境，不增加激活时隐式下载或第二套安装器。
2. **按用户最新偏好保留同一插件文件夹下的业务数据。** 用户希望数据库与生成文件和插件包在同一路径及文件夹中，因此保留现有唯一根 `<插件目录>/data`，不改到宿主 home，不新增保存位置选择或用户账号系统。代码和数据使用不同子目录，安装根保持固定；更新包不携带或覆盖用户 data，更新验收须验证同一目录内更新后任务、原件、成果和会话仍可读。此前目录 A 切换到 B 的空列表实测仍然成立，所以不把换目录安装当作升级或自动迁移。不引入双路径 fallback，也不移动现有正式数据。模型图片附件仍由宿主附件服务管理，不宣称插件文件夹已经包含全部恢复依赖。
3. **整理依赖与兼容契约。** 按实际引用区分宿主提供的 peer 与私有业务组件需要的运行依赖，锁定本次验证的官方版本。先保留完整准备环境验证声明变化，再单独验证依赖精简。未通过候选不得进入正式目录。
4. **再更新安装与更新说明。** 用户操作是准备目录、在现有 dsh 的添加插件中填写绝对路径、启用并检查业务；`npm start` 仅作为开发调试。更新时先在隔离目录完成检查，避免对正在读取的 dist 做失败的部分覆盖。当前不扩展 npm/GitHub 发布流程。

| 修改职责 | 预计涉及位置 |
|---|---|
| 准备、兼容声明、验收入口 | `package.json`；最小准备/验收脚本 |
| 隔离构建、官方本地安装、资源与拒绝检查 | `tests/helpers/isolated-app.mjs`、`tests/plugin-lifecycle.test.mjs`；按是否需要输出参数决定调整 `scripts/build.mjs` |
| 同一安装根下保留 data 的更新规则 | 保留 `server/native/business.mjs` 的现有路径；目录准备/更新脚本排除用户 data，安装回归补齐原位更新保留数据的检查；不为此改造 Python 业务或宿主数据根 |
| 用户安装说明 | `README.md` |

源码/资源目录与数据目录分开，保留成熟 Python 业务库、技能和 DOCX 模板。当前没有需要修改整个 React 业务流程或官方 dsh 源码的证据。

同一插件目录目前共用一套业务数据库，项目通过 task_id 划分；没有按 dsh 会话或账号拆成独立数据库。原件和生成的 MD/DOCX 存于 `data/workspace/<task_id>`，业务执行会话在 `data/dsh/sessions`；OCR 模型图片附件在宿主 `DSH_HOME/attachments/v1`。整目录移动后的技能链接、会话绝对路径与附件恢复尚未验证，不能把目录可复制等同于已经验证的完整迁移。

验收边界仍有三项未知：全新机器从零准备依赖、截图桌面宿主的实际安装操作、其他操作系统。当前实测宿主是本机 `0.2.0-rc.2` 的完整官方 base/web 配置，不把它等同于上述场景已通过。
