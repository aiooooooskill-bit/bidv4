# 0.1.4 合并发布与安装包验收

日期：2026-10-15。将本次资料库完整改动与0.1.3已发布实现合并，保留Windows适配、完整运行依赖和上下文压缩修复。源代码、中文修改说明和完整插件包统一使用v0.1.4。工程计划文档不提交。

## 本次改动

- 公司资料、写作素材与Word版式统一分步上传及真实传输进度；写作素材取消大小限制，公司资料和Word版式继续各自限制。
- 上传原件与可用素材在左侧统一展示，清楚标明待选章节、待核对和失败；素材默认文件名，名称及用途置顶，支持目录全选。
- 点击章节标题定位并高亮DOCX原文；通过解析坐标和Word书签区分同名章节，勾选与定位独立。
- 授权代表独立维护、全库共用，在项目确认时选择；统一资料库提示、未保存保护、冲突提示和表单对齐。
- 保留Windows Python路径、UTF-8、filelock、junction与npm.cmd准备支持；保留0.1.3补齐的Agent预设、React、React DOM运行依赖。

## 数据与平台边界

**授权代表表结构改变，旧数据库不自动迁移。** 从0.1.3或更早版本升级，应保留旧插件和data备份，在新数据目录安装0.1.4；不可将旧app.db直接复制到本版本。正式环境的数据处理记录属于此前资料库任务，本次打包不操作现有用户数据库。

**Windows实机尚未验证，Linux也未实机验收。** 执行验证环境为macOS arm64、Node.js24.15.0、Python3.13.13、DSH0.2.0-rc.2。模型相关回归只使用本机确定性夹具。

## 完整交付

TGZ和ZIP包含相同的完整文件集合：DSH Agent预设、原生Chat、工作台页面及前后端、图表/PDF资源、28个业务工具、技能、角色、Word基础模板、固定依赖与准备脚本。排除用户业务数据、凭证、缓存、备份、node_modules、本机Python环境和计划文档。

客户端安装源选择“压缩包”，使用：

```text
https://github.com/aiooooooskill-bit/bidv4/releases/download/v0.1.4/ooo-bidpliot-0.1.4.tgz
```

另提供ZIP和SHA256SUMS.txt。GitHub自动生成的Source code压缩包不包含dist，不作为完整安装包。

## 执行结果

- 类型检查与完整构建通过。
- Node全量165/165通过，无失败或跳过；[日志](evidence/release-0.1.4-node.log)。
- Python549/549通过；[日志](evidence/release-0.1.4-python.log)。
- 官方隔离安装、页面/Agent业务、更新、重启、卸载重装、数据保留与缺失环境拒绝23/23项通过；[报告](evidence/release-0.1.4-delivery.json)。
- 最终TGZ在含中文和空格的新目录准备、构建、自检、创建项目与加载28个工具通过；[报告](evidence/release-0.1.4-package-installation.json)。该报告platform=darwin，不能代替Windows实机验证。
- TGZ/ZIP均606个文件、逐字节一致、无符号链接，已核对Agent预设、新上传/章节预览代码及构建资源；[包校验](evidence/release-0.1.4-package.json)。
