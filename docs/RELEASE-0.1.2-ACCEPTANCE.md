# 0.1.2 合并发布与验收

发行日期：2026-10-15。源码与安装包使用同一 `v0.1.2` 标签。本次合并已完成的上下文压缩修复与 Windows 适配；其他任务仍在编辑的资料库改动未纳入。计划文档不提交。

## 验证边界

**Windows 实机尚未验证，Linux 也未进行实机验收。** 按用户选择先发布修复包。本次所有执行验证都来自 macOS arm64、Node.js 24.15.0、Python 3.13.13、DSH 0.2.0-rc.2。

同事截图仅显示包管理器退出码 1、依赖提示及部分输出，未包含最终错误行，不能据此确定该次安装失败的唯一原因。代码审查确认旧版使用 Unix 专用 fcntl 文件锁、固定 .venv/bin/python 路径及 Windows 受限的目录符号链接；这些问题已修复。宿主 pnpm 的 URL 完整性缓存和安装任务不退出问题仍按 0.1.1 验收记录处理，不承诺此次插件更新能修复宿主缺陷。

## 合并内容

- 正式 Agent 预设挂载官方上下文压缩和工具回执裁剪，覆盖长会话自动摘要、超限重试、子 Agent、隔离和冷恢复。
- Windows 使用 .venv/Scripts/python.exe，业务进程强制 UTF-8；文件锁采用 filelock 原生跨平台锁；技能目录使用 Windows junction。
- 目录准备支持 npm.cmd；测试与打包脚本使用跨平台路径；交付清单统一使用正斜杠，TGZ 与 ZIP 不携带本机环境或符号链接。
- 完整包包含 DSH Agent 预设、原生对话、已构建工作台、图表/PDF资源、后端、28 个业务工具、技能、角色、Word模板及锁定依赖。

## 本地结果

- 类型检查和构建通过。
- Node 全量回归 145/145 通过，包含正式 Web 预设上下文压缩测试；[日志](evidence/release-0.1.2-node.log)。安装准备脚本最终调整后，平台与交付测试 10/10 再次通过。
- Python 回归 544/544 通过，含跨进程锁竞争与进程终止后释放；[日志](evidence/release-0.1.2-python.log)。
- 官方隔离安装、页面/Agent业务、更新、卸载重装、数据保留与缺失环境拒绝共 23/23 项通过；[报告](evidence/release-0.1.2-delivery.json)。
- 真实 TGZ 解压到含中文和空格的新目录，从空依赖环境准备、构建并自检成功，可创建中文项目并读取28个工具；[报告](evidence/cross-platform-package.json)。报告 platform=darwin，不代表 Windows 实机通过。

安装地址：

```text
https://github.com/aiooooooskill-bit/bidv4/releases/download/v0.1.2/ooo-bidpliot-0.1.2.tgz
```

客户端安装源选择“压缩包”。完整 ZIP 与 SHA256SUMS.txt 在同一发布页。模型测试使用本机确定性夹具，不证明真实模型生成质量。
