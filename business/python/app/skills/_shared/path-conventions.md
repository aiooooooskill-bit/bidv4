# 文件路径约定

以运行时提供的「当前任务绝对路径」「全局工作区绝对路径」和「业务技能绝对路径」为准；主会话可以从任意宿主工作目录发起，不能依赖当前会话的相对目录。

- 普通文件工具 `read`、`read_image`、`write`、`edit`、`glob`、`grep` 使用绝对路径。本文档中的 `work/…`、`sources/…`、`_meta/…` 均相对当前任务，例如读取 `work/analysis/structure.md` 时传 `<当前任务绝对路径>/work/analysis/structure.md`。工具返回的绝对路径直接使用，不再添加任务 ID。
- `skills/…` 表示业务技能根目录下的文件，例如 `skills/_shared/evidence-rules.md` 对应 `<业务技能绝对路径>/_shared/evidence-rules.md`；`references/…` 相对当前技能目录。通过 `skill` 工具加载的技能也遵循其返回的资源根目录。
- DOCX 工具的 `path`、`dest` 和 `validate_body.section` 使用相对任务 `work/` 的路径，例如 `body/技术册/实施方案.docx`；`docx_format_rule.evidence_path` 使用 `parse/<文件名>/<文件名>.md`。这些业务参数不加任务绝对路径、任务 ID 或 `work/`。
- `parse_document.file_name`、`docx_source_inject.source` 只传原文件名（含扩展名）。`publish_artifact.draft_path` 使用 `<当前任务绝对路径>/_meta/staging/<草稿名>.json`。
- `docx_image_insert.image` 的知识库图源为 `knowledge/parse/<文件名>/images/<图片名>` 或 `knowledge/files/<原文件名>`，相对全局工作区；本任务图源为 `sources/<原文件名>`，相对当前任务。这些是图片业务工具的参数。普通文件工具查看同一知识库图片时使用 `<全局工作区绝对路径>/knowledge/parse/…`，查看本任务原件时使用 `<当前任务绝对路径>/sources/…`。
- 公司资料位于数据根目录的 `workspace/knowledge/`，写作素材位于 `workspace/materials/`，用户 Word 版式位于 `templates/`。三者跨任务共享；版式查询使用 `list_templates`，公司资料与素材使用对应检索工具。宿主会话和附件由宿主当前配置管理，不从插件数据目录推测其位置。

向子代理派发时提供当前任务绝对路径、输入与输出的绝对路径；正文另提供 DOCX 工具使用的 `body/…` 相对路径。目录的输出 `fragment_path` 由程序注入，并随 `task` 的 JSON 回执返回主线程，合并按回执的 `response_file` 对账册序、按 `fragment_path` 读取，不从册名推测文件名。文件系统路径与业务参数分别沿用程序返回值。

响应文件的册名是业务名称，须逐字保留采购原文；目录片段、正文册目录与整册 Word 共用程序返回的唯一册目录键，清洗或截断后追加原册名摘要，再返回真实路径。册名含斜杠、冒号或超长不构成招标歧义，不登记“落盘命名待裁决”等待澄清项，不要求用户改册名或决定文件系统路径。
