# 0.1.1 发布与桌面客户端安装验收

验收日期：2026-10-15（上海时间）。发布源码提交 `eb77c8314b4994f3825b1b595aa5170517c9fff0`，标签 `v0.1.1`。代码、中文版本说明与完整安装包均已发布到 [GitHub Release](https://github.com/aiooooooskill-bit/bidv4/releases/tag/v0.1.1)。工程计划文档不提交，既有计划文件取消跟踪并保留本地副本，远端删除根目录 PLAN.md 的改动已保留。

## 发布文件

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| ooo-bidpliot-0.1.1.tgz | 5,445,833 | `6864aa1a6afe0e27e1467e3868565cca706ec1433d8bf327f01590b6963c632e` |
| ooo-bidpliot-0.1.1.zip | 5,698,052 | `a58e974f66a0d01a25fbf957c67b8e8decd619aac03629002ae6a8cae69be2ca` |

另附 SHA256SUMS.txt。发布后通过命令行从 GitHub 重新下载三个附件，均与本地逐字节一致，且摘要匹配 GitHub 的资产 digest。见 [GitHub 附件校验](evidence/release-0.1.1-github.json)。

TGZ 与 ZIP 的 593 个文件逐字节一致，包含清单自身及 592 个交付文件：DSH Agent 预设和原生对话、工作台前后端、自动流程与工具、已构建页面／图表／PDF 全部资源、Python 工具及依赖锁、技能和引用、角色、Word 模板、说明和测试。排除了用户数据、凭证、备份、缓存、node_modules 和虚拟环境。见 [安装包核对](evidence/release-0.1.1-package.json)。

## 工程检查

- 类型检查与完整构建通过，构建在隔离目录中执行，未重建或重启正式 3080 宿主。
- Node 全量回归 **142/142** 通过，无失败或跳过；[日志](evidence/release-0.1.1-node.log)。首次高并发运行有两项超时，单独重跑均通过，随后限制并发的完整运行也全部通过。
- Python **543/543** 通过；[日志](evidence/release-0.1.1-python.log)。
- 官方隔离目录的安装、更新、重启、卸载重装、数据保留、缺失依赖拒绝等 **23/23** 项通过；[报告](evidence/release-0.1.1-delivery.json)。安装脚本调整后重新完成了这 23 项验证。
- TGZ 另经官方包管理器实际安装；安装脚本成功准备 Python 环境，自检、页面 API HTTP 200 和公开 Agent 预设通过。

模型相关自动回归只使用本机确定性模型夹具，不证明实际模型生成内容质量、整标制作耗时或其他平台兼容性。

## 本机桌面客户端

使用 `/Applications/DeepSeek Harness.app`，先通过客户端卸载原有唯一第三方插件 ooo-bidpliot，确认第三方已安装列表清空。内置官方功能、既有项目与宿主会话、模型配置均保留。见 [清空后的截图](evidence/release-0.1.1/desktop-clean.png)。

本次实际安装地址始终为发布附件：

```text
https://github.com/aiooooooskill-bit/bidv4/releases/download/v0.1.1/ooo-bidpliot-0.1.1.tgz
```

客户端内置 pnpm 11.7.0 的初次 URL 安装遇到 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`。检查表明本地存储中存在该 URL 的不完整缓存记录；这与 [DeepSeek 官方仓库的同类报告](https://github.com/deepseek-ai/deepseek-harness/discussions/8294) 一致。将该单一缓存记录备份后清理，重新下载后依赖和 Python 环境安装成功，但内置进程在输出 Done 后仍未退出。

因此取消卡住的安装，完整退出客户端，通过 DSH 官方包管理函数 `runPlugin('desktop', ...)`、系统 pnpm **11.25.0** 和同一个 GitHub TGZ 地址完成安装，随后重开客户端。普通 CLI 入口拒绝直接管理保留的 desktop profile，因此此次恢复调用的是已安装 DSH 官方实现中的包管理函数；没有修改客户端源码、关闭完整性校验、调整模型或改成本地 link 安装。该处理记录是本机恢复过程，不代表 pnpm 11.7.0 的桌面界面一键安装缺陷已经修复。

最终结果：

- 桌面 profile 的依赖精确指向上述 GitHub URL，启用的第三方 bundle 只有 ooo-bidpliot。
- 客户端详情显示 **v0.1.1、已启用、1 个组件运行中**；[版本截图](evidence/release-0.1.1/desktop-version.png)。
- 安装目录自检全部通过；592 个交付文件与 GitHub 发布包逐字节一致。
- 实际打开工作台，智能解读上传页与公司资料库正常加载，新安装的项目列表为空；[页面截图](evidence/release-0.1.1/desktop-page.png)。
- 新建会话可选择唯一公开预设 **ooo-bidpliot**；[Agent 截图](evidence/release-0.1.1/desktop-agent.png)。未在桌面客户端发起真实模型生成，业务全链路的执行验证来自前述隔离自动测试。

URL 安装的业务数据位于宿主管理的插件安装目录，未来卸载或更换版本前须备份 data；宿主原生会话和附件也需一并备份。ZIP 固定目录安装和原位更新继续按 README 操作。
