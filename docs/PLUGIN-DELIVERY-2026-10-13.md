# ooo-bidpliot 插件交付核对

核对日期：2026-10-13（上海时间）。本地目录交付清单已完成：最终干净环境生命周期验收 **23/23 项通过**，工程回归 **Node 119/119、Python 448/448**、类型检查与完整构建通过；页面与独立 Agent 的浏览器实际文档打开和下载通过。证据见 [验收汇总](evidence/plugin-delivery-summary-20261013.json) 与 [最终交付报告](evidence/plugin-delivery-final-validation-20261013.json)。插件发行版本继续留空，尚未发布。

## 交付约定与已测范围

用户在 2026-10-12 明确要求将整个项目作为 dsh 插件交付，先采用本地目录安装，数据库与生成文件留在同一插件目录。本轮名称统一为 `ooo-bidpliot`，描述为「招投标工作台：AI + 招投标平台。」；`package.json`、`package-lock.json` 及其根包记录均未设置插件版本，`private: true` 保留。Python 工具项目的元数据版本不代表插件发行版本。

已测试环境为 **macOS arm64、Node.js 24.15.0、Python 3.13.13、dsh 0.2.0-rc.2**；准备要求 Node.js 24+、Python 3.12+ 和 uv。Linux 尚未验收；Windows 当前的 Unix 文件锁与 Python 路径不支持。

安装根为固定、可写且独立于宿主 profile 的目录，通过官方本地目录 / `link:` 挂载。业务数据唯一根为 `<插件目录>/data`，包括数据库、原件、MD/DOCX 成果、业务执行 JSONL 会话及动作回执。OCR 图片由宿主附件服务存储于 `DSH_HOME/attachments/v1`，公开聊天 Agent 的会话也由宿主管理；完整备份仍须同时保留对应宿主数据。换目录不作为自动升级或迁移。

## 页面与 Agent 的完整组成

| 组成 | 注册与入口 | 验收结果 |
|---|---|---|
| 页面和后端 | `ooo-bidpliot` 插件行；`server/plugin.mjs`、`dist/client.js` | 官方挂载后页面 API 与资源可访问；上传、解读、目录、规划、正文、修订、合册与下载通过 |
| 独立聊天 Agent | 宿主公开预设 `ooo-bidpliot`；`cordis.patch.yml`、`server/agent.mjs`、`./agent` export | 实际 Agent 只提供 `ooo_bidpliot_status`；创建、恢复、切换、工具回复和浏览器实际文档打开/原生下载通过 |
| 页面业务执行 Agent | 私有预设 `ooo-bidpliot-execution`；`server/native/runtime.mjs` | 页面动作调度官方 Agent 循环、文件/技能/提问和 Python 工具；同会话具体问题作答、停止与冷恢复通过 |
| 目录、正文及辅助子 Agent | `server/native/roles.json`、`server/native/tools.mjs` 和完整技能引用 | 委派、OCR 图片读取、正文工具执行及取消通过；模型与附件复用宿主服务 |

独立聊天 Agent 查询和展示页面的同一套数据；上传、生成和编辑仍由页面触发。公开预设与私有执行预设均随安装、更新、卸载重装和重启验收，页面可用不替代 Agent 验收。

## 交付清单完成情况

| 清单项 | 已完成内容与证据 |
|---|---|
| 目录准备与自检 | [prepare](../scripts/prepare.mjs) 顺序执行 `npm ci`、`uv sync --locked`、类型检查、完整构建与安装检查；[doctor](../scripts/doctor.mjs) 检查 Node/Python、锁定宿主版本、运行依赖、资源、技能、角色和基础模板。空 Node/Python 环境实际准备通过；启用时不隐式下载 |
| 宿主兼容与依赖契约 | [manifest](../package.json) 声明 23 个私有业务组件为固定版本运行依赖，10 个宿主共享 API/页面模块为 peer；保留完整开发准备环境。manifest/lock 一致，官方兼容版本接受、不兼容版本拒绝，doctor 提供清晰版本提示 |
| 干净交付文件集 | `files` 白名单和 [delivery export](../scripts/delivery.mjs) 携带代码、完整 dist、Python 源码/锁、技能/角色、DOCX 基础模板、许可证、说明及测试；排除 data、backups、缓存、Node/Python 本机环境，拒绝交付源码中的符号链接。空交付目录的文件集与实际资源请求通过 |
| 完整资源构建 | [build](../scripts/build.mjs) 在临时目录完成 client、renderer/chunks、PDF worker/cmaps/fonts/wasm 后再交换完整 dist；后段构建失败保留原 client 和 renderer，半成品清理通过 |
| 原位更新与失败恢复 | [delivery update](../scripts/delivery.mjs) 在同磁盘隔离目录重新准备、检查及构建，再替换固定安装根并保留原 data；交换后复查 Python 和资源。准备失败保持原目录，交换后验证失败恢复原代码与 data；EACCES 阻止回滚时保留唯一数据库、原代码和明确恢复路径。对应 [8 项交付故障测试](../tests/delivery.test.mjs) 全部通过 |
| 活宿主保护与关闭 | [installation](../server/installation.mjs) 登记宿主 PID，准备、构建和更新拒绝活宿主/业务执行锁。关闭先停止新请求、等待已接收请求与冷恢复/提交完成，取消活跃 Agent/子 Agent，等待执行结束并 flush 后释放句柄和作用域；最终 flush 失败明确报错并释放 Agent |
| 官方安装、更新、卸载重装 | [完整交付验证脚本](../scripts/verify-delivery.mjs) 从独立空目录准备，通过官方 `dsh plugin add/remove` 安装、更新后重启、真正卸载与原目录重装；相应代码变化、页面/预设状态及数据保留均通过 |
| 说明与支持范围 | [README](../README.md) 已说明准备固定目录、官方安装、启用、自检、隔离原位更新、卸载重装、导出白名单及备份范围，并注明已测试平台与模型验收边界 |

官方兼容门禁读取 dsh peer。无插件版本且宿主不兼容时，官方检查会因缺少用于不兼容身份的版本而拒绝；doctor 同时给出要求版本与实际版本。没有为此填写占位发行版本或加入兼容 fallback。

## 最终验收证据

[最终交付报告](evidence/plugin-delivery-final-validation-20261013.json) 的 `passed` 为 `true`，23 个阶段在一次完整运行中全部通过。新 Node/Python 环境与 dist 是独立安装和构建的实际目录，不链接开发机的 node_modules、.venv 或 dist；包管理器可以使用本机下载缓存，不据此宣称另一台机器或其他平台已验收。

- 页面完成上传与 OCR、八份解读、目录发布、写作指引、关键事实与承诺、正文子 Agent、修订与合册；另一临时任务完成需要具体问题作答的整本制作，并验证答复沿用同一执行会话。
- 独立聊天预设走完整模型 → `ooo_bidpliot_status` 工具 → 回复链路，返回页面实际 task_id、执行状态、Markdown 文档及整册下载；文档 HTTP 200，DOCX 下载字节与页面产物一致。浏览器同一公开聊天会话连续查询两个项目，工具参数及结果匹配当前请求的 task_id；普通宿主 Agent 的工具及聊天仍正常。
- 官方卸载后 profile 依赖与 bundle 注册移除，页面 HTTP 404、公开预设消失、宿主正常；官方包管理器可以保留物理链接，因此不将残留链接误判为仍安装。原固定目录保留，重装后页面成果和公开 Agent 冷恢复通过。
- 更新、卸载、重装及缺环境拒绝前后按对应快照比对数据库逻辑内容、原件/成果/业务会话文件、宿主聊天会话和图片附件；原件、DOCX 下载哈希及已记录会话事件保持一致。
- 缺完整 dist、Node 依赖、Python 环境、Python 运行模块和不支持的宿主版本均明确拒绝；恢复环境后再启动可读取原成果。页面停止取消子 Agent 并清理执行锁。
- 历史 `flush on a closed handle` 日志上下文不足，不能唯一归因于本次修复。本轮实际复现并修复了关闭时冷恢复/并发请求未排空的竞态；最终完整关闭阶段诊断为空，回归验证活动子 Agent 的停止、会话尾事件落盘、冷恢复和 flush 失败的明确报错。

独立干净环境的 `npm run verify` 已通过 TypeScript 检查、完整构建和 Python **448/448**。最后的聊天链接与客户端点击修复后，重新完成类型检查、完整构建及全部 Node **119/119**，无失败或跳过；本次链接改动不涉及 Python。最终 Node 日志为 `/private/tmp/ooo-bidpliot-final-links.log`，Python 日志为 `/private/tmp/ooo-bidpliot-final-regression.log`。日志与最终交付报告是本次源码的日期快照，代码改变后应重新执行受影响的检查。

聊天返回的链接使用官方 webServer 实际端口的绝对 HTTP URL；客户端只对本插件同源的 `workbench/content` 与 `artifacts/:id/file` 两类链接保留浏览器原生导航，避免宿主侧边浏览器拒绝访问自身应用来源。普通宿主链接行为保持原样。浏览器实际点击 `structure.md` 在新标签中显示已有文档内容 JSON，整册原生下载 **37,908 字节**，SHA-256 为 `ce85d3a82f661dcc4997e727858f0ead6a0245eee73ece6cb013417e3a380d05`，与页面已发布产物逐字节一致。

临时官方宿主的浏览器证据见 [交付页面截图](evidence/delivery-page-20261013.jpg)、[独立 Agent 查询截图](evidence/delivery-agent-20261013.jpg) 和 [聊天文档实际打开截图](evidence/delivery-agent-document-20261013.jpg)。模型请求仅发送到本机确定性夹具；该夹具按最新请求的 task_id 选择查询参数，不证明通用自然语言理解、真实模型输出质量、整册耗时或最终内容准确性。本轮未重启正式 3080 宿主、调用正式模型或修改用户项目。

## 历史发现与已解决事项

首次交付审计发现原打包遗漏 dist 却收进备份和测试产物、仅使用 engines 未触发官方版本门禁、全部组件一概声明 peer 后精简环境失败、活目录分步构建可能破坏资源。这些问题已分别由干净白名单、peer/运行依赖分类、完整准备环境及隔离完整构建解决。

独立 Agent 补查曾发现查询工具被空 allow 过滤、Markdown 链接误指向只接受 DOCX 的接口，以及浏览器将相对链接当成本地文件、侧边浏览器拒绝同源 HTTP 链接。现已修复并纳入实际挂载、原生导航和下载验收。此前仅复用开发环境的 103 项回归属于历史证据，当前结论以本轮 23 项交付验收与 119/448 项工程回归为准。历史评估见 [本地目录交付评估](DSH-OFFICIAL-PLUGIN-ASSESSMENT.md#2026-10-12本地目录交付检查与修订方案)。

## 发行状态

本地目录安装、原位更新、卸载重装、页面与独立 Agent、浏览器文档打开/下载、数据保留的当前交付范围已完成验收。发行版本继续未设置，未发布带版本的 npm/tgz 包；后续由用户确定版本和发布渠道。跨平台支持、通用自然语言理解和真实模型内容质量不属于本次已通过结论。
