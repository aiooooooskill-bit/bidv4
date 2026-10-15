# 0.1.3 完整插件修订版验收

日期：2026-10-15。修复 0.1.2 发布后在桌面客户端清理重装时发现的运行依赖缺失：autoInstallPeers=false 的宿主 profile 不会安装仅声明为 peer 的包。Agent 预设、React 和 React DOM 现明确声明为固定版本的运行依赖。

本次包含上下文压缩修复与 Windows 适配；计划文档及其他任务尚未定稿的资料库改动不提交。源码对应 v0.1.3，完整 TGZ 与 ZIP 使用相同文件集合。

**Windows 实机尚未验证，Linux 也未进行实机验收。** 已按用户要求先发布修复包。macOS 上，合并实现全量 Node 145 项、Python 544 项、官方安装生命周期23项通过，见0.1.2对应日志；本次依赖修订后类型检查、平台/交付10项与真实TGZ的全新环境安装再次通过。实际包在中文和空格路径中准备、构建、自检、创建中文项目、读取28个工具均成功，见[压缩包安装报告](evidence/cross-platform-package.json)。

完整包包含 DSH Agent 预设、原生 Chat、页面及前后端、PDF/图表资源、Python业务工具、技能、角色、模板、固定依赖和安装脚本。排除用户数据、凭证、缓存、备份、本机 Node/Python 环境。模型相关回归采用本机确定性夹具。

客户端选择“压缩包”安装源：

```text
https://github.com/aiooooooskill-bit/bidv4/releases/download/v0.1.3/ooo-bidpliot-0.1.3.tgz
```

要求 Node.js24+、Python3.12+、uv 和 DSH0.2.0-rc.2。宿主内置 pnpm11.7.0 的 URL 缓存和任务不退出问题仍按0.1.1历史记录处理，插件升级不保证修复宿主安装器。
