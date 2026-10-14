# ooo-bidpliot 招投标工作台

以dsh插件嵌入原页面。灵燕的技能、目录/正文角色与业务工具已接入dsh官方Agent循环和子Agent；聊天入口只读展示，操作仍在页面。

同一个插件同时注册页面入口和可在 dsh 聊天中选择的 `ooo-bidpliot` Agent 预设。独立聊天 Agent 查询项目、执行状态、已有文档链接和整册下载；页面内部的 `ooo-bidpliot-execution` 预设负责解读、制作及目录/正文子 Agent，`ooo-bidpliot-review` 预设负责单轮审核。两者读取同一套项目数据。交付验收分别检查页面与这两类预设。

插件名称为 `ooo-bidpliot`，描述为「招投标工作台：AI + 招投标平台。」。发行版本暂未设置，完整测试通过后再确定。采用固定本地目录安装；数据库与生成文件保存在该目录的 `data/`。交付组成与验收见 [交付核对](docs/PLUGIN-DELIVERY-2026-10-13.md)。

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

白名单携带运行代码、完整前端资源、技能与角色、基础 Word 模板、依赖锁、说明和测试；排除业务数据、备份、缓存、Node/Python 本机环境。收件人仍需执行目录准备。当前版本留空，所以不运行 npm/tgz 发行，也不填写占位版本。

## 页面流程

原上传/列表 → 智能解读（解析和八份解读MD）→ 标书制作（目录弹窗配置、自动写作准备、逐章生成、Word预览与合册下载）→ 标书审查（外部投标文件或平台正文的完整要点对照、原文证据及问题处理）。细节见 [页面流程](docs/UI-FLOW.md)。

招标原件和公司资料支持 DOCX、PDF、PNG、JPG、JPEG、GIF、WebP，单文件100MiB；受审投标文件支持同样格式且不设固定大小上限。写作素材按灵燕原方法收DOCX，Word版式收DOCX且20MiB。Word复用原预览，PDF使用本地打包的分页组件，图片直接显示原件。GIF解析取首帧；原动画保留。

数字DOCX/PDF使用原确定性解析器；扫描页与图片由dsh同一模型转写。扫描页逐页渲染识别，无128页硬上限；单张图片2000万像素预算保留。识别输出必须齐备，不换模型、不把部分OCR标成成功。大文件范围与审核方法见 [当前审核实现](docs/REVIEW-CURRENT.md)。

解读、目录与规划直接展示原生文件，隐藏内部来源编号并保留关联。手动保存/取消、冲突和草稿保护沿用现有页面。错误集中到顶部操作提示；只有实际缺少具体值才出现页面选项，无结果确认门或聊天“回复继续”。

## 存储与运行

```text
data/
  app.db                       # 任务、产物版本、资料和素材索引、Word版式默认项
  dsh/sessions/                # 官方dsh JSONL执行会话
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

插件以独立Cordis Context组装官方业务组件，业务事件和会话与宿主分离。模型、默认选择、子进程及附件服务复用宿主实例；图片存于宿主配置的 `DSH_HOME/attachments/v1`，与官方模型适配器读取位置一致。业务侧挂载官方 `session-checkpoint-policy`，请求和顶层工具执行前必须完成落盘。没有修改或覆盖dsh官方源码。

重启从官方执行会话读取状态和具体问题。中断执行保留已有文件，未知写入结果不自动重复；不承诺恢复旧引擎检查点。历史用户数据库与文件保留，没有转换或清空。

## 工程检查与来源

```sh
npm run verify
npm run verify:delivery
```

`verify` 先检查类型和构建，再运行Node与Python回归，任一步失败即停止。对已启用目录应在隔离副本执行。`verify:delivery` 从空临时目录重新准备 Node/Python 环境，调用官方安装/卸载接口，验收页面业务、独立聊天循环、原位更新、重启、卸载重装和数据保留；并验证缺资源/依赖拒绝、关闭尾事件和其他宿主Agent正常。模型请求仅发送到本机确定性夹具。

`node scripts/verify-delivery.mjs --keep-open` 会在通过后保留临时宿主供浏览器验收；只使用临时项目，不读取正式模型凭证或修改用户数据。输出的本机 `/login` 地址用于该临时宿主。测试结果写入 `docs/evidence/plugin-delivery-validation-20261013.json`。

当前结果与验证范围记录在 [交付核对](docs/PLUGIN-DELIVERY-2026-10-13.md)。记录是带日期的快照；代码变化后重新执行受影响的检查，不沿用旧结果作为通过依据。检查不审核模型生成内容，双插件调整按用户要求暂缓。

原灵燕MIT版权保留于 [business/LICENSE](business/LICENSE)，源码与改动来源见 [UPSTREAM](docs/UPSTREAM.md)。
