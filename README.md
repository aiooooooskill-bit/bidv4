# ooo-bidpliot 招投标工作台

以dsh插件嵌入原页面。业务技能、目录/正文角色与工具已接入dsh官方Agent循环和子Agent；对话与工作台共用项目和业务流程。

插件只注册一个客户可选择的 `ooo-bidpliot` Agent 预设。每个项目持久绑定一个主会话：从对话创建时绑定当前会话，从页面首次执行时创建并绑定；后续解析、解读、制作、审查与页面自动流程都在该主会话继续。原有目录／正文写手与图片识别子任务、业务方法和校验保留，不暴露独立业务执行或审查模式。

插件名称为 `ooo-bidpliot`，描述为「招投标工作台：AI + 招投标平台。」。当前发行版本为 **0.1.1**，修改内容见 [版本说明](CHANGELOG.md)。采用固定本地目录安装；数据库与生成文件保存在该目录的 `data/`。交付组成与验收见 [交付核对](docs/PLUGIN-DELIVERY-2026-10-13.md)。

## 项目 Agent 对话

解读、制作与审查页面的「Agent 对话」均打开该项目绑定的 DSH 原生 Chat。消息、工具参数与结果、对话／轨迹、子任务入口和实时回复全部使用 DSH 原有展示；没有新增对话页签或自定义聊天组件。刷新和重启后沿用原生历史读取，不重新执行模型。

在原生新会话中选择 `ooo-bidpliot`，上传招标文件并说明要解读、制作、审查或自动完成全部流程。Agent 使用真实附件创建或关联项目，区分招标来源与受审投标文件；对话中的项目、选项、进度和成果与工作台共用。可在对话提供公司资料、签字代表和日期，或选择资料库已有主体。最终回复读取真实成果正文并提供文件链接。

工作台的「自动完成」按解析解读、目录、写作准备与正文合册、审查连续执行，并复用仍有效的成果。缺少主体信息或具体承诺时暂停，用户在任一入口补充后继续；失败和停止保留已有文件。完成后可查看报告或下载整册。自动流程状态位于 `data/workflows/`，执行记录仍只有宿主原生日志一份。此改动不转换此前私有存储中的历史会话。

## GitHub 安装包安装

在 DeepSeek Harness 客户端的「插件 → 添加插件」中填写以下发布附件地址：

```text
https://github.com/aiooooooskill-bit/bidv4/releases/download/v0.1.1/ooo-bidpliot-0.1.1.tgz
```

宿主下载包并安装 Node 依赖；安装脚本调用 uv 根据锁文件准备 Python 业务环境。若宿主提示构建脚本待授权，按提示允许本插件的安装脚本后重试。需要本机已有 Node.js 24+、Python 3.12+ 和 uv，安装时可联网访问依赖仓库。安装后检查插件版本、页面入口和同名 Agent 预设均正常。

桌面客户端内置 pnpm `11.7.0` 时，重复解析压缩包 URL 可能出现 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`，也可能在依赖安装完成后未结束安装任务。本机已通过同一 GitHub 地址完成安装并验证页面和 Agent；具体过程与边界见 [0.1.1 发布验收](docs/RELEASE-0.1.1-ACCEPTANCE.md)。完整包的 SHA-256 可在发布页核对。前述错误需处理宿主包管理器状态，不能据此认定安装包损坏。

URL 安装的业务数据在宿主管理的插件安装目录内；卸载或更换 URL 版本前先备份该目录的 data 及宿主会话／附件。需要自行掌握固定目录及原位更新时，可使用下述 ZIP 解压安装。

## 本地目录安装

已验证环境为 macOS arm64、Node.js 24.15.0、Python 3.13.13、uv 和 dsh `0.2.0-rc.2`。准备要求 Node.js 24+ 和 Python 3.12+。Linux尚未验收；Windows的文件锁和Python路径不支持。模型和凭证使用现有宿主配置。

将交付目录放在固定且可写的位置，例如自己的应用目录。不要放入 dsh profile 的 `node_modules`，也不要把新目录切换当成更新。关闭使用该目录的宿主后，在插件目录执行：

```sh
node scripts/prepare.mjs
node scripts/doctor.mjs
dsh plugin --profile web add "link:$(pwd)"
```

也可以在 dsh 的「添加插件」中选择本地目录并填写准备完成的绝对路径。安装后启用 `ooo-bidpliot`，确认侧边页面入口和聊天 Agent 预设均存在。`doctor` 会检查完整资源、技能/角色/模板、Node/Python 依赖和 dsh 版本；缺环境明确失败，插件启用时不会隐式下载。

页面入口为宿主侧边栏的「ooo-bidpliot」。开发环境可用 `npm start` 启动 `http://127.0.0.1:3080/`。所有生成、资料抽取、图片/扫描页OCR都使用dsh当前默认模型与已有凭证；主子Agent继承同一模型。没有单独的模型或Key设置。OCR要求该模型支持图片，并在已有dsh模型声明中包含 `input: [text, image]`。

## 原位更新与卸载重装

先关闭使用该目录的宿主，再从新的干净交付目录运行：

```sh
node scripts/delivery.mjs update /absolute/new-delivery /absolute/fixed-install
```

更新先在同一磁盘的临时目录重新安装锁定依赖、检查并完整构建，再替换固定安装目录，保留原 `data/`；完成后重新启动宿主加载新代码。准备或验证失败会恢复原代码和数据；若文件系统连回滚也拒绝，保留恢复目录并报告路径，不删除尚未恢复的数据。宿主运行标记或执行锁仍有效时拒绝准备、构建和更新。

卸载只使用官方命令解除插件注册，保留固定目录：

```sh
dsh plugin --profile web remove ooo-bidpliot
dsh plugin --profile web add link:/absolute/fixed-install
```

重装必须指向原固定目录。不要删除该目录或覆盖 `data/`。官方包管理器可能保留物理链接，以 profile 的依赖/bundle 注册和实际功能卸载状态为准。

## 创建干净交付目录

源码目录构建完成后运行：

```sh
npm run build
node scripts/delivery.mjs export /absolute/new-delivery
```

白名单携带运行代码、完整前端资源、技能与角色、基础 Word 模板、依赖锁、说明和测试；排除业务数据、备份、缓存、Node/Python 本机环境。收件人仍需执行目录准备。GitHub [v0.1.1 发布页](https://github.com/aiooooooskill-bit/bidv4/releases/tag/v0.1.1) 提供完整插件安装包（客户端 URL 安装用 TGZ / 本地目录安装用 ZIP）与 SHA-256 校验文件。下载并解压到固定目录后，按上面的本地目录安装步骤准备环境并注册插件；GitHub 自动生成的 Source code 压缩包不包含已构建的 dist，请使用发布页附件。安装包包含 DSH Agent 预设、原生 Chat 接入、页面和后端、完整 PDF/图表资源、Python 业务工具、全部技能与角色及 Word 模板。Node/Python 运行环境和依赖由准备脚本安装，不携带本机环境或模型凭证。

## 页面流程

原上传/列表 → 智能解读（解析和八份解读MD）→ 标书制作（目录弹窗配置、自动写作准备、逐章生成、Word预览与合册下载）→ 标书审查（外部投标文件或平台正文的完整要点对照、原文证据及问题处理）。细节见 [页面流程](docs/UI-FLOW.md)。

招标原件和公司资料支持 DOCX、PDF、PNG、JPG、JPEG、GIF、WebP，单文件100MiB；受审投标文件支持同样格式且不设固定大小上限。写作素材收DOCX，Word版式收DOCX且20MiB。Word复用原预览，PDF使用本地打包的分页组件，图片直接显示原件。GIF解析取首帧；原动画保留。

数字DOCX/PDF使用原确定性解析器；扫描页与图片由dsh同一模型转写。扫描页逐页渲染识别，无128页硬上限；单张图片2000万像素预算保留。识别输出必须齐备，不换模型、不把部分OCR标成成功。大文件范围与审核方法见 [当前审核实现](docs/REVIEW-CURRENT.md)。

解读、目录与规划直接展示原生文件，隐藏内部来源编号并保留关联。手动保存/取消、冲突和草稿保护沿用现有页面。错误集中到顶部操作提示；只有实际缺少具体值才出现页面选项，无结果确认门或聊天“回复继续”。

## 存储与运行

```text
data/
  app.db                       # 任务、产物版本、资料和素材索引、Word版式默认项
  conversations/<task_id>.json # 项目与唯一客户主会话的绑定
  workflows/<task_id>.json     # 自动流程阶段、暂停和继续状态
  actions/<task_id>/           # 页面动作回执、输入版本、执行session_id
  tool-receipts/<task_id>/      # 写入工具结果回执
  locks/                       # 正在执行的项目
  knowledge-jobs/             # 资料处理进程回执，崩溃后显示重新解析
  file-locks/                  # 跨工具进程的文件写锁
  renders/                     # 临时插图回执
  workspace/<task_id>/sources/  # 原件
  workspace/<task_id>/work/     # parse、analysis、outline、body、artifacts
  workspace/archive/           # 用户归档项目文件
  workspace/knowledge/         # 公司资料
  workspace/materials/         # 手工素材块
  workspace/templates/         # Word版式
```

Python仅作为短生命周期的业务工具进程，既不提供HTTP服务，也不调用模型或编排Agent。旧独立引擎、3188代理及其设置、DeepAgents/LangGraph/FastAPI/uvicorn已删除。执行Agent按授权拥有完整文件访问权限；任务路径用于业务归属。

业务执行复用宿主官方 Agent、会话、JSONL 持久化、循环和子 Agent 服务，执行预设中的技能及工具保持作用域隔离。执行会话保存到宿主当前配置的会话存储，图片存于 `DSH_HOME/attachments/v1`；工作台数据和成果继续保存于插件 `data/`。请求和顶层工具执行沿用宿主官方落盘屏障与策略。没有修改或覆盖 dsh 官方源码。

重启从官方执行会话读取状态和具体问题。阶段操作使用独立 action_id 和事件范围，后续轮次不覆盖历史阶段状态；审查回执按轮次保存，旧问题和停止请求不能作用于新阶段。中断执行保留已有文件，未知写入结果不自动重复；不承诺恢复旧引擎检查点。历史用户数据库与文件保留，没有转换或清空。

## 工程检查与来源

```sh
npm run verify
npm run verify:delivery
```

`verify` 先检查类型和构建，再运行Node与Python回归，任一步失败即停止。对已启用目录应在隔离副本执行。`verify:delivery` 从空临时目录重新准备 Node/Python 环境，调用官方安装/卸载接口，验收页面业务、独立聊天循环、原位更新、重启、卸载重装和数据保留；并验证缺资源/依赖拒绝、关闭尾事件和其他宿主Agent正常。模型请求仅发送到本机确定性夹具。

`node scripts/verify-delivery.mjs --keep-open` 会在通过后保留临时宿主供浏览器验收；只使用临时项目，不读取正式模型凭证或修改用户数据。输出的本机 `/login` 地址用于该临时宿主。测试结果写入 `docs/evidence/plugin-delivery-validation-20261013.json`。

0.1.1 修改内容与验证范围见 [版本说明](CHANGELOG.md)；历史交付结果记录在 [交付核对](docs/PLUGIN-DELIVERY-2026-10-13.md)。记录是带日期的快照；代码变化后重新执行受影响的检查，不沿用旧结果作为通过依据。检查不审核模型生成内容，双插件调整按用户要求暂缓。

原灵燕MIT版权保留于 [business/LICENSE](business/LICENSE)，源码与改动来源见 [UPSTREAM](docs/UPSTREAM.md)。
