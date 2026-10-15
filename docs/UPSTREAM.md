# 源码来源与改动

灵燕业务基础来自 [joychin/LingYan-Bid-Agent](https://github.com/joychin/LingYan-Bid-Agent)，MIT原版权及许可位于 [business/LICENSE](../business/LICENSE)。保留其解析、目录契约、分析/目录/正文技能、目录/正文角色、DOCX、素材、公司资料、版式、检查和产物方法；删除其Agent运行框架、模型客户端和HTTP服务。

最初Python副本未保存上游commit，不伪造版本。复制前摘要来自原交付记录；当前保留文件摘要见`BUSINESS-FILES.json`，只是交付摘要。新补充的资料索引函数来自固定提交`de909f12572b4c469864b12255e26cc185ada7ec`的`sidecar/app/knowledge/ingest.py`（statement_segment、questions_segment、reindex_item），适配为自动整理状态，不加入内容审查。

原上传、导航、列表、Modal、Word预览、样式和引用辅助来自用户原bidpilot。PDF/目录编辑与编号、插图渲染函数来自灵燕；前端复制前摘要见`SOURCES.json`。插图与UX核对固定于上面的提交，本机App版本0.2.3另记，不声明两者为相同构建。

主要适配：

1. 官方dsh循环、spawn、模型选择、会话、附件、问题和完整fs权限接入项目执行预设；所有模型调用使用宿主配置。
2. Python仅提供业务工具和文件服务函数；取消DeepAgents/LangGraph/FastAPI/uvicorn及独立设置，不保留旧引擎fallback。
3. 原技能和角色工具名适配dsh。页面阶段决定当前动作；只有具体缺值提问，不设通用确认门。
4. 图片/扫描页由dsh同模型转写，复用原PDF渲染/插入与OCR提示；GIF首帧和七类上传，数字文档保留原解析。
5. 原MD与目录直接渲染，隐藏编号、原位保存关联，集中错误、手动编辑和草稿保护。
6. 页面请求、写工具回执与跨进程文件锁；项目业务文件和执行会话位于当前data，图片复用宿主附件库 `DSH_HOME/attachments/v1`，与官方模型适配器读取位置一致。

安装版灵燕只作为既有成果和交互的只读参考，不导入其数据库、凭证或修改文件。自动回归仅请求本机确定性模型夹具；赣州真实解读与未验证范围见 [最终工程验收](evidence/runtime-fix-acceptance.json)，不审查生成内容质量。

2026-10-12取消此前`vendor/dsh-scope`的createScope依赖继承修改和包覆盖，删除该目录。2026-10-15 为接入原生 Chat，业务改为复用宿主官方会话与执行服务，技能、工具保留预设作用域。官方包按正常依赖安装；历史排查证据保留在`docs/evidence`，项目绑定一个客户主会话；目录／正文与OCR的既有子任务保留，客户不选择内部执行模式。

审查技能来源说明：灵燕上游 `de909f12572b4c469864b12255e26cc185ada7ec` 没有独立的整标审核技能。本平台复用其解析技能、大纲、分段精读及证据纪律，再增加页面报告契约，不能宣称新增编排是灵燕原生审核技能。
